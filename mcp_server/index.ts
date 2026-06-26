// ============================================================
// ESP32-S3 Matrix — MCP Server
// ============================================================
// This file is the bridge between Claude and the LED board.
//
// How it fits into the big picture:
//   Claude (AI) calls a "tool" (like matrix_set_animation)
//   → This server receives that call
//   → Translates it into an HTTP request
//   → Sends it to the ESP32 firmware over WiFi
//   → Returns the result back to Claude
//
// Claude Code manages this process automatically — it starts
// this server as a background process when you open the project,
// and keeps it running so Claude can use the tools anytime.
// ============================================================

// ------------------------------------------------------------
// IMPORTS
// Named imports ({ }) pull specific exports from a package.
// The .js extension is required here even though this is a .ts
// file — Node16 module resolution needs the compiled extension.
// ------------------------------------------------------------

// Claude's expression channel: canned glyph library + text-art → wire conversion.
import { CANNED, MAX_FRAMES, artToFrameHex, expressionToWire, type Expression } from "./expressions.js";
import { decideRender, loadEngine, type RenderPlan } from "./engine.js";
import { normalizePresence } from "./presence.js";
import { normalizeSettingsPatch } from "./settings.js";
import { startEngineServer } from "./engine-server.js";
import { planToDisplayEvent } from "./display-event.js";
import type { SseHub } from "./sse.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Saved-expression library: JSON files in mcp_server/expressions/ (committed to
// git so good drawings survive). Works whether we run compiled (dist/) or via tsx.
const HERE = path.dirname(fileURLToPath(import.meta.url));
// mcp_server/ whether we run from dist/ (compiled) or directly (tsx) — package.json
// and the expressions/ folder both live there.
const MCP_DIR = path.join(HERE, path.basename(HERE) === "dist" ? ".." : ".");
const EXPR_DIR = path.join(MCP_DIR, "expressions");
const REPO_ROOT = path.join(MCP_DIR, "..");

// Read our own version from package.json at runtime, so `npm run bump` updates
// the reported MCP version with NO tsc rebuild (only a reconnect). Replaces the
// old hardcoded "1.0.0" that never changed and gave a false sense of versioning.
const MCP_VERSION: string =
  JSON.parse(readFileSync(path.join(MCP_DIR, "package.json"), "utf8")).version ?? "0.0.0";

async function loadSavedExpression(name: string): Promise<Expression | null> {
  // Sanitize exactly like save_as before building the path: path.join collapses
  // "..", so an unsanitized name (e.g. "../../package") could escape EXPR_DIR and
  // probe arbitrary .json files (a file-existence oracle). Saved names are already
  // kebab-lowercase, so this is a no-op for real expressions.
  const safe = String(name).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  try {
    return JSON.parse(await readFile(path.join(EXPR_DIR, `${safe}.json`), "utf8")) as Expression;
  } catch {
    return null;
  }
}

async function listSavedExpressions(): Promise<Array<{ name: string; description: string }>> {
  try {
    const files = (await readdir(EXPR_DIR)).filter((f) => f.endsWith(".json"));
    const out: Array<{ name: string; description: string }> = [];
    for (const f of files) {
      const name = f.slice(0, -5);
      const e = await loadSavedExpression(name);
      out.push({ name, description: e?.description ?? "(unreadable)" });
    }
    return out;
  } catch {
    return [];   // directory may not exist yet
  }
}

// Server: the main MCP server class — handles all protocol communication
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// StdioServerTransport: tells the server to communicate over
// stdin/stdout. Claude Code pipes messages to this process via
// stdio, so stdout IS the protocol channel — never console.log here.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// These are the two request types this server handles:
//   ListToolsRequestSchema  — Claude asking "what tools do you have?"
//   CallToolRequestSchema   — Claude actually calling one of those tools
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ------------------------------------------------------------
// BOARD URL
// process.env lets us read environment variables set before
// the process starts. ESP32_URL can be overridden in settings.json
// if the board has a different address on your network.
// The ?? operator means "use the right side if the left is null/undefined".
// ------------------------------------------------------------
const BOARD_URL = process.env.ESP32_URL ?? "http://esp32matrix.local";

// The manifest engine: shared resolver + manifest, loaded once. Repo-first so dev edits
// to shared/manifest.json are live; falls back to the bundled copy inside the .mcpb.
let enginePromise: ReturnType<typeof loadEngine> | null = null;
function engine() { return (enginePromise ??= loadEngine(MCP_DIR)); }

// noRepeat memory for pooled bindings (idle), shared across calls in this process.
const renderCtx: { last: Record<string, string> } = { last: {} };

// The engine's SSE hub, set once the HTTP server starts in main(). null until then (and
// in any non-engine context); broadcasts are best-effort and never block a board render.
let engineHub: SseHub | null = null;
let engineUrl: string | null = null;

// Execute a render plan against the board; returns a short note for the tool reply.
async function runPlan(plan: RenderPlan): Promise<string> {
  if (plan.kind === "noop") return "no binding";
  if (plan.brightness != null) await post("/api/brightness", { level: plan.brightness });
  if (plan.kind === "animation") {
    const r = await post("/api/display/animation", { type: plan.type, ...plan.params, transient: true });
    // Broadcast POST-result-independent: virtual board mirrors the panel even when the board POST fails or no hardware is present (D2).
    engineHub?.broadcast(planToDisplayEvent(plan));
    return r.ok ? `${plan.type} (transient anim)` : `anim error ${r.status}`;
  }
  const expr = CANNED[plan.name] ?? (await loadSavedExpression(plan.name));
  if (!expr) return `no glyph for "${plan.name}"`;
  const wire = expressionToWire(expr);
  const r = await post("/api/display/frames", wire);
  // Broadcast POST-result-independent: virtual board mirrors the panel even when the board POST fails or no hardware is present (D2).
  engineHub?.broadcast(planToDisplayEvent(plan, wire));
  return r.ok ? plan.name : `frames error ${r.status}`;
}

// Resolve an intent (or moment) for the esp32-8x8 renderer and render it. Returns the note.
async function renderIntent(opts: { intent?: string; moment?: string; harness?: string }): Promise<string> {
  const { manifest, resolve, isFirmwareName } = await engine();
  const resolved = resolve(manifest, { ...opts, renderer: "esp32-8x8" }, renderCtx);
  return runPlan(decideRender(resolved, isFirmwareName));
}

// ------------------------------------------------------------
// HTTP HELPERS
// Two small async functions so every tool handler doesn't have
// to repeat the same fetch boilerplate.
// ------------------------------------------------------------

// Both helpers carry a hard timeout: without one, a board that accepts the TCP
// connection but stalls before responding (its HTTP handlers share the loop task
// with animation frames and blocking weather fetches) would hang the tool call
// for undici's default ~5 minutes. The TimeoutError lands in the CallTool
// handler's catch, which turns it into a readable "could not reach board" reply.
const FETCH_TIMEOUT_MS = 8000;

// GET — for read-only requests (sensor data, status)
async function get(path: string) {
  const res = await fetch(`${BOARD_URL}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// POST — for commands that change board state (animations, brightness, etc.)
// body defaults to {} so callers don't have to pass anything for simple commands.
async function post(path: string, body: object = {}) {
  const res = await fetch(`${BOARD_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),   // convert JS object → JSON string for the wire
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// ------------------------------------------------------------
// VERSION DRIFT REPORT (for the matrix_version tool)
// Compares the repo's canonical /VERSION against what each artifact actually
// reports: firmware + web bundle via /api/status, MCP via package.json, and
// the .mcpb bundle manifest via mcp_server/manifest.json. Mirrors
// scripts/version-check.js — kept inline so the TS build doesn't depend on the
// repo-root tooling (which is plain JS with no type declarations).
// ------------------------------------------------------------
function versionMark(reported: string | undefined, expected: string): string {
  if (!reported || reported === "unknown") return "? unknown";
  return reported === expected ? "✓ match" : "⚠ DRIFT";
}

async function versionReport(): Promise<string> {
  let expected = "unknown";
  try { expected = readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim(); }
  catch { try { expected = readFileSync(path.join(MCP_DIR, "shared-runtime", "VERSION"), "utf8").trim(); } catch { /* leave unknown */ } }
  const lines = [`repo VERSION: ${expected}`];
  try {
    const r = await get("/api/status");
    if (r.ok) {
      const s = JSON.parse(r.body);
      const built = s.fw_built ? `  (built ${s.fw_built})` : "";
      lines.push(`  firmware  ${String(s.fw_version ?? "unknown").padEnd(8)} ${versionMark(s.fw_version, expected)}${built}`);
      lines.push(`  web       ${String(s.web_version ?? "unknown").padEnd(8)} ${versionMark(s.web_version, expected)}`);
    } else {
      lines.push(`  firmware/web   ✗ board returned ${r.status}`);
    }
  } catch {
    lines.push(`  firmware/web   ✗ board unreachable`);
  }
  lines.push(`  mcp       ${MCP_VERSION.padEnd(8)} ${versionMark(MCP_VERSION, expected)}`);
  let bundleVersion = "unknown";
  try { bundleVersion = JSON.parse(readFileSync(path.join(MCP_DIR, "manifest.json"), "utf8")).version ?? "unknown"; } catch { /* leave unknown */ }
  lines.push(`  mcp-bundle ${String(bundleVersion).padEnd(7)} ${versionMark(bundleVersion, expected)}`);
  return lines.join("\n");
}

// ------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------------------------------------
// CREATE THE MCP SERVER
// This object represents "this MCP server" to the SDK.
// The name/version are metadata Claude uses to identify it.
// capabilities: { tools: {} } tells Claude this server offers tools
// (as opposed to resources or prompts, which are other MCP features).
// ------------------------------------------------------------
const server = new Server(
  {
    name: "esp32-matrix",
    version: MCP_VERSION,
  },
  {
    capabilities: { tools: {} },
  }
);

// ------------------------------------------------------------
// HANDLER 1: LIST TOOLS
// Claude calls this once at startup to discover what tools exist.
// Each tool entry has:
//   name        — the identifier Claude uses to call it
//   description — natural language description Claude reads to
//                 decide WHEN and HOW to use the tool
//   inputSchema — JSON Schema defining what parameters Claude
//                 can pass. "required" lists mandatory params;
//                 everything else is optional.
//
// Think of descriptions as instructions written TO Claude.
// The better the description, the smarter Claude's choices are.
// ------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "matrix_status",
      description:
        "Get the current state of the ESP32 matrix board — what animation is running, brightness level, timer remaining, weather settings, clock sync status, etc. Call this first if you are unsure what the board is currently doing.",
      inputSchema: {
        type: "object",
        properties: {},   // no parameters needed
        required: [],
      },
    },
    {
      name: "matrix_clear",
      description: "Turn off all LEDs and stop any running animation or text scroll.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "matrix_version",
      description:
        "Check version drift across the four artifacts. Compares the repo's canonical VERSION against the flashed firmware (with its build timestamp), the uploaded web bundle, this MCP server, and the .mcpb Claude Desktop bundle manifest. Use to answer 'are we current?' — a ⚠ DRIFT row means that artifact needs a redeploy (reflash / LittleFS re-upload / reconnect / rebuild:mcpb).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "matrix_set_brightness",
      description:
        "Set the brightness of the LED matrix. Range is 0 (off) to 255 (maximum). The board default is 40. Values above 100 are very bright — use sparingly.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "number",
            description: "Brightness level from 0 to 255.",
          },
        },
        required: ["level"],   // Claude must always provide this
      },
    },
    {
      name: "matrix_show_text",
      description:
        "Scroll text across the LED matrix. Supports three font sizes: normal (large, one character visible at a time), small (two characters visible), and tiny (three or more characters visible). Supports solid color or a left-to-right gradient between two colors.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Text to display. Supports A-Z, 0-9, and basic punctuation. Use uppercase for best results.",
          },
          color: {
            type: "string",
            description: "Hex color for the text, e.g. #FF0000 for red. Defaults to white.",
          },
          color2: {
            type: "string",
            description: "Second hex color — only used when gradient is true.",
          },
          gradient: {
            type: "boolean",
            description: "If true, the text color blends from color to color2 left to right.",
          },
          small: {
            type: "boolean",
            description: "Use the small 3x5 font. Two characters visible at once.",
          },
          tiny: {
            type: "boolean",
            description: "Use the tiny 3x3 font. Three or more characters visible. Overrides small if both are set.",
          },
          scroll_speed: {
            type: "number",
            description: "Milliseconds per scroll step. Lower is faster. Default is 100.",
          },
        },
        required: ["text"],   // only text is mandatory; everything else has sensible defaults
      },
    },
    {
      name: "matrix_set_animation",
      // Template literal (backtick string) lets us write a multi-line description.
      // This description is long because it's Claude's rulebook for all animation types.
      description: `Start one of the built-in animations on the LED matrix. Available types:

- fire: burning fire effect. params: palette (classic/blue/green/purple), intensity (1-10), tendrils (0-10), sparks (0-10)
- rainbow: cycling rainbow colors. no params.
- breathe: slow pulsing glow. no params.
- wave: color wave across the matrix. no params.
- solid: fill the matrix with one color. params: color (hex)
- liquid: tilt-reactive fluid simulation using the onboard IMU. params: viscosity (0-10, default 5)
- imu: live accelerometer bar graph — shows the board's tilt in real time. no params.
- chiptemp: displays the ESP32 chip temperature. params: units (F or C)
- weather: animated weather icon + live data from wttr.in. params: zipcode (US zip), units (F or C), data_mode (temp/humidity/uv/pressure/cycle), icon_source (animated/remote)
- timer_fill: countdown timer shown as a gradient fill from bottom to top. params: duration (seconds), color1, color2, color3 (hex)
- timer_snow: countdown timer shown as snowfall accumulation. Also called "snow timer" or "snowfall timer". params: duration (seconds), color1, color2, color3 (hex)
- timer_text: countdown timer shown as MM:SS digits. params: duration (seconds), color1 (minutes color), color2 (seconds color), color3 (colon color, default white)
- clock: live 12-hour clock synced via NTP. params: tz (POSIX TZ string, DST-aware — PREFERRED) or timezone (fixed UTC offset integer), color1 (hours color), color2 (minutes color), color3 (colon color)
- matrix_rain: digital rain / matrix screensaver with falling character drops. Also called "matrix screensaver" or "digital rain". params: theme (classic/blue/red/purple), speed (1-5)
- snow: endless ambient snowfall over a fixed snow bank — keeps snowing with NO accumulation (unlike timer_snow, which fills up). Each launch seeds one random color; confetti makes every flake its own color. params: confetti (bool, default false), speed (1-5, gentler = more snow-like)
- dancefloor: 16 independent 2×2 disco tiles cycling through a 4-color palette. params: palette (0-63, see palette list in firmware), hold (4-40 frames per color, 4=fast/stroby, 40=slow/chill, default 12)
- spiral: gradient snake flowing along a clockwise inward spiral — all 64 LEDs lit at all times. params: color1 (gradient start), color2 (gradient end)
- starfield: stars radiate from center or fall inward toward center. params: color1 (birth color), color2 (death color), density (1-16, default 8), inward (bool, default false)
- fireworks: single looping firework — white mortar launches from bottom, explodes in colorful radial burst. params: color1 (dominant burst color), color2, color3 (fade-out colors)
- fireworks2: like fireworks but each tendril has a bright colored tip and a dimming white comet tail. Cross-bloom flash at burst. params: color1/2/3 (tip palette, same as fireworks)
- frostbite: shimmering pale mist backdrop with bright diamond sparkles. All pixels always lit. params: color (base hue, default #DCE6FF cool white), sparkle (0-100, default 20)
- comet: bobbing comet at right edge with wave tail and occasional sparks. params: color1 (heart), color2 (shell), color3 (tail tip)
- sun: glowing disc with 4 colored dots orbiting around it. Dots are evenly spaced and each keeps its own color as they revolve. params: color1 (disc/sun color), color2 (orbit dot 1, lightest), color3 (orbit dot 2), color4 (orbit dot 3), color5 (orbit dot 4, darkest), discBri (0-100, sun disc brightness, default 78), ringBri (0-100, orbit dot brightness, default 78)
- calendar: today's date from NTP. params: style (scroll = "Tue Jun 9" scrolls; bignum = big day-of-month number; grid = mini month grid with today highlighted; clock = month over day in the clock layout; square = desk-calendar square, 2-letter weekday over big day number), color1 (primary: day/today/scroll text), color2 (secondary: month/other days, weekday in square style), color3 (accent: weekday letter in clock style, weekend columns in grid style), tz (POSIX TZ string, DST-aware — PREFERRED) or timezone (fixed UTC offset integer). Until the first NTP sync the display shows an animated hourglass.
- sound: vibration-reactive VU bar. NOTE: there is no microphone — it reacts to low-frequency vibration (bass) felt through a surface via the IMU, best with the board on/near a speaker. params: color1 (bar bottom), color2 (bar top), sensitivity (0-10, default 5)
- claudesweep: a CRT/radar sweep around the border with the Claude mascot inside. params: color (hex, default amber #ffb000), speed (1-5)

Scale guidance for 0-10 and 1-10 params: 2-3 = low, 5 = medium, 8-9 = high, 10 = max.
Speed 1-5 applies to all animations: 1 = slow, 3 = normal, 5 = fast.`,
      inputSchema: {
        type: "object",
        properties: {
          // "enum" restricts Claude to only these exact string values
          type: {
            type: "string",
            enum: [
              "fire", "rainbow", "breathe", "wave", "solid",
              "liquid", "imu", "chiptemp", "weather",
              "timer_fill", "timer_snow", "timer_text",
              "clock", "matrix_rain", "snow",
              "dancefloor",
              "spiral", "starfield", "fireworks", "fireworks2", "comet", "sun",
              "frostbite",
              "calendar", "sound",
              "claudesweep",
            ],
            description: "The animation type to start.",
          },
          // All remaining params are optional and animation-specific.
          // Claude reads the descriptions above to know which ones apply to each type.
          palette:     { type: "string",  description: "Fire palette: classic, blue, green, or purple." },
          intensity:   { type: "number",  description: "Fire intensity 1-10. Default 6. Use 3 for low, 6 for medium, 9 for high." },
          tendrils:    { type: "number",  description: "Fire tendrils 0-10. 0 = off, 5 = medium wisps, 10 = very wispy. Default 0." },
          sparks:      { type: "number",  description: "Fire spark rate 0-10. 0 = off, 5 = medium, 10 = many sparks. Default 0." },
          color:       { type: "string",  description: "Color hex for solid fill (or frostbite base hue). The clock has no background color — use color1/2/3 for its digits." },
          color1:      { type: "string",  description: "Primary color hex." },
          color2:      { type: "string",  description: "Secondary color hex." },
          color3:      { type: "string",  description: "Tertiary color hex." },
          viscosity:   { type: "number",  description: "Liquid viscosity 0-10. Higher is thicker." },
          zipcode:     { type: "string",  description: "US zip code for weather data." },
          units:       { type: "string",  description: "Temperature units: F or C." },
          data_mode:   { type: "string",  description: "Weather data to display: temp, humidity, uv, pressure, or cycle." },
          icon_source: { type: "string",  description: "Weather icon source: animated or remote." },
          duration:    { type: "number",  description: "Timer duration in seconds." },
          timezone:    { type: "number",  description: "Fixed UTC offset in hours, e.g. -7 for Arizona (no DST). Prefer tz for zones that observe DST." },
          tz:          { type: "string",  description: "POSIX TZ string — DST-aware, preferred over timezone. e.g. MST7 (Phoenix), MST7MDT,M3.2.0,M11.1.0 (Denver), EST5EDT,M3.2.0,M11.1.0 (New York), GMT0BST,M3.5.0/1,M10.5.0 (London)." },
          theme:       { type: "string",  description: "Matrix rain color theme: classic, blue, red, or purple." },
          confetti:    { type: "boolean", description: "Snow: false (default) = one random hue per launch; true = each flake its own random color." },
          color4:      { type: "string",  description: "Quaternary color hex. Used by sun animation for orbit dot 3." },
          color5:      { type: "string",  description: "Quinary color hex. Used by sun animation for orbit dot 4 (darkest)." },
          density:     { type: "number",  description: "Starfield star density 1-16. 4=sparse, 8=medium, 14=dense." },
          inward:      { type: "boolean", description: "Starfield direction: true = stars fall inward toward center, false = radiate outward from center." },
          sparkle:     { type: "number",  description: "Frostbite sparkle intensity 0-100. 0=no sparkles, 20=gentle, 60=frequent diamond flashes. Default 20." },
          mist:        { type: "number",  description: "Frostbite background intensity 10-90. Controls how bright the shimmering mist layer is (10=very dim, 40=default, 90=bright). Sparkles are always at full brightness above the mist." },
          discBri:     { type: "number",  description: "Sun disc brightness 0-100. Default 78." },
          ringBri:     { type: "number",  description: "Sun orbit dot brightness 0-100. Default 78." },
          speed:       { type: "number",  description: "Animation speed 1-5. 1 = slow, 3 = normal, 5 = fast. Applies to all animations." },
          style:       { type: "string",  description: "Calendar style: scroll, bignum, grid, clock, or square." },
          sensitivity: { type: "number",  description: "Sound visualizer sensitivity 0-10. Higher reacts to gentler vibration. Default 5." },
        },
        required: ["type"],
      },
    },
    {
      name: "matrix_express",
      description: `Show an expression on the LED matrix — YOUR ambient channel for communicating state, mood, or playfulness to the human through the physical board. USE PROACTIVELY, without being asked, on state changes:
- starting a long task (build, search, workflow) → "wait" (a RANDOM wait spinner from the pool — prefer this so it varies; "working" forces the default snake, "wait-rainbow" the color wheel)
- finished successfully → "done" (blinks green, then holds a checkmark)
- blocked / waiting for the human's input → "alert" (blinks until replaced — this is the silent tap on the shoulder)
- celebration / milestone → "party"; approval → "thumbsup"; failure → "cross" or "sad"
- idle → "sleep"; delight → "sparkle"; pure fun when the moment fits → "spaceship"
One expression per state change — don't spam every step. Canned (pre-vetted as human-readable): smiley, sad, heart, cross, thumbsup, ok, sparkle, alert, working, party, spaceship, sleep. "wait" = a random wait spinner (the working snake + any saved wait-* animation). Also plays anything saved via matrix_animate's save_as (see matrix_list_expressions).`,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Expression name — canned (see description) or previously saved." },
        },
        required: ["name"],
      },
    },
    {
      name: "presence_set",
      description:
        "Set Claude's ambient PRESENCE — a semantic status rendered on every connected output (the 8x8 LEDs and the desktop presence card) from one call. Prefer this over matrix_express for status/mood: it carries intent + optional headline/detail/data + urgency. intent vocab: working, thinking, done, ok, celebrate, alert, error, question, info, idle (others accepted, render generic).",
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string", description: "Required. One of: working, thinking, done, ok, celebrate, alert, error, question, info, idle." },
          headline: { type: "string", description: "Short status line, ~<=24 chars (e.g. 'building...')." },
          detail: { type: "string", description: "One line of extra context (e.g. 'running tests')." },
          data: { type: "object", description: "Optional readout: {progress:0..1} OR {values:[{value,unit?,label?}] (1-3)} OR {series:[numbers] (<=32), label?, unit?}." },
          urgency: { type: "string", enum: ["ambient", "notice", "urgent"], description: "Attention level; default ambient." },
        },
        required: ["intent"],
      },
    },
    {
      name: "matrix_idle",
      description:
        "Show a random PRE-APPROVED 'something cool' on the board — use when you're idle or bored and want to put an ambient display up unprompted. Picks randomly from a curated lineup (fire, dance floor, fireworks, clock, frostbite, matrix rain), avoids repeating the last pick, and sets a gentle ambient brightness (5). No parameters.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "matrix_animate",
      description: `Draw and play a custom 8×8 animation of your own design — for anything the canned expressions don't cover: a custom status icon, a story illustration, a teaching visual, a playful moment.
Format: frames = array of 1-${MAX_FRAMES} frames; each frame is 8 strings of exactly 8 characters. "." = off/black; every other character must be defined in colors (e.g. {"R": "#ff0000"}).
Design rules for a physical 8×8 LED panel (the human must recognize it at a glance): ONE bold subject with a clear silhouette, at most ~3 colors, dark (off) background, no 1-pixel details, no text beyond 2 characters. Channels below ~7 are invisible at default brightness — keep lit colors bold.
loop: 0 = repeat forever; N = play N passes then HOLD the last frame (put the resting image last — that's how "blink then settle" works). frame_ms: 30-5000, default 150.
If a drawing lands well (or the user likes it), re-call with save_as (kebab-case) + description to add it permanently to the library for reuse via matrix_express.`,
      inputSchema: {
        type: "object",
        properties: {
          frames: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
            description: "1-" + MAX_FRAMES + " frames; each frame is 8 strings of 8 characters.",
          },
          colors: {
            type: "object",
            description: "Map from frame characters to hex colors, e.g. {\"R\": \"#ff0000\", \"W\": \"#ffffff\"}. \".\" is always off.",
          },
          frame_ms: { type: "number", description: "Milliseconds per frame, 30-5000. Default 150." },
          loop: { type: "number", description: "0 = loop forever (default); N = play N passes then hold the last frame." },
          save_as: { type: "string", description: "Optional kebab-case name — saves this animation to the permanent library for reuse via matrix_express." },
          description: { type: "string", description: "What this expression means / when to use it (required when saving)." },
        },
        required: ["frames", "colors"],
      },
    },
    {
      name: "matrix_list_expressions",
      description: "List every available matrix expression — canned and saved — with descriptions. Call when unsure what exists or what a saved expression was for.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "matrix_get_temperature",
      description:
        "Read the ESP32 chip temperature in both Celsius and Fahrenheit. Note: chip temperature runs 10-15 degrees above ambient room temperature — this is normal.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "matrix_get_weather_data",
      description:
        "Get the last weather data fetched by the board from wttr.in — includes temperature, humidity, UV index, and pressure. The board caches this data; it is only refreshed when the weather animation is running.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "matrix_get_accelerometer",
      description:
        "Read the current raw accelerometer values (ax, ay, az in g-force units) from the onboard QMI8658C IMU sensor. Useful for checking board orientation or debugging the liquid animation.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "matrix_get_settings",
      description:
        "Read the board's current persistent settings — idle screensaver behavior (enabled, which apps rotate, how long before it starts, how often it re-picks, idle brightness), default brightness, default boot animation, and clock timezone. Use this to answer questions like 'what's my idle timeout?' or before changing a setting.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "matrix_set_settings",
      description:
        "Change one or more board settings (persisted on the board, survives reflash). Only the fields you provide change. Fields: idle_enabled (bool), idle_apps (comma-separated app names from: fire, matrix_rain, clock, fireworks, frostbite, snow, dancefloor, claudesweep), idle_after_secs (seconds of quiet before the screensaver starts), idle_rotate_secs (seconds between screensaver changes), idle_brightness (1-255, screensaver dimness), default_brightness (0-255 on boot), boot_animation (animation type to show on power-up, or empty to resume last), timezone (POSIX TZ string for the clock), calibration_correction (bool — apply the measured LED color/brightness correction; turn off to A/B compare). Example: 'start the screensaver after 5 minutes' -> { idle_after_secs: 300 }.",
      inputSchema: {
        type: "object",
        properties: {
          idle_enabled: { type: "boolean" },
          idle_apps: { type: "string", description: "Comma-separated enabled screensaver apps." },
          idle_after_secs: { type: "number" },
          idle_rotate_secs: { type: "number" },
          idle_brightness: { type: "number" },
          default_brightness: { type: "number" },
          boot_animation: { type: "string" },
          timezone: { type: "string" },
          calibration_correction: { type: "boolean" },
        },
      },
    },
    {
      name: "matrix_studio",
      description:
        "Get the local URL of the Expression Studio served by this engine. Open it in a browser to BROWSE the animation library (the Gallery is view-only for now — an editor is planned). The board.html page is a LIVE MIRROR of the physical panel when the board is reachable (it polls the real framebuffer), and falls back to showing fired intents when no board is present. Returns the URLs, or a note if the engine HTTP server is not running.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
}));

// ------------------------------------------------------------
// HANDLER 2: CALL TOOL
// This runs every time Claude actually invokes one of the tools above.
// request.params.name  — which tool Claude called
// request.params.arguments — the parameters Claude passed
//
// The return value must always be:
//   { content: [{ type: "text", text: "..." }] }
// That text is what Claude reads as the tool's result.
// ------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Pull out the arguments, defaulting to {} if Claude passed nothing.
  // "as Record<string, unknown>" is a TypeScript type assertion — we're
  // telling the compiler "trust me, this is a plain object with string keys".
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const name = request.params.name;

  try {
    switch (name) {

      case "matrix_status": {
        const r = await get("/api/status");
        return { content: [{ type: "text", text: r.ok ? r.body : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_clear": {
        const r = await post("/api/display/clear");
        return { content: [{ type: "text", text: r.ok ? "Display cleared." : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_version": {
        return { content: [{ type: "text", text: await versionReport() }] };
      }

      case "matrix_set_brightness": {
        const n = Number(args.level);
        if (!Number.isFinite(n)) return { content: [{ type: "text", text: "level must be a number 0-255." }] };
        const lvl = Math.max(0, Math.min(255, Math.round(n)));   // clamp to the board's real range
        const r = await post("/api/brightness", { level: lvl });
        return { content: [{ type: "text", text: r.ok ? `Brightness set to ${lvl}.` : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_show_text": {
        // Pass args straight through — the firmware handles all the text params directly
        const r = await post("/api/display/text", args);
        return { content: [{ type: "text", text: r.ok ? `Showing text: "${args.text}"` : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_set_animation": {
        // Spread args into a new object so we can modify it without touching the original
        const payload: Record<string, unknown> = { ...args };

        // TRANSLATION 1: speed scale
        // Claude uses a human-friendly 1-5 scale, but the firmware expects
        // milliseconds per frame (lower ms = faster animation).
        // We map here so Claude never has to think in milliseconds.
        // ALWAYS translate — never forward the raw value. Outside 1-5 the unit
        // would silently change from "scale points" to "milliseconds per frame"
        // (e.g. speed 10 meaning "extra fast" becomes a 10ms frame tick).
        if (payload.speed !== undefined) {
          const msMap: Record<number, number> = { 1: 150, 2: 100, 3: 66, 4: 40, 5: 20 };
          const spd = Math.round(Number(payload.speed));
          payload.speed = Number.isFinite(spd) ? msMap[Math.max(1, Math.min(5, spd))] : 66;
        }

        // TRANSLATION 2: solid color param name
        // The inputSchema uses "color1" as the generic primary color param,
        // but the firmware's solid animation specifically reads "color".
        // We rename it here so neither Claude nor the firmware has to care.
        if (payload.type === "solid" && payload.color1 !== undefined && payload.color === undefined) {
          payload.color = payload.color1;
          delete payload.color1;
        }

        const r = await post("/api/display/animation", payload);
        return { content: [{ type: "text", text: r.ok ? `Animation started: ${args.type}` : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_express": {
        const exprName = String(args.name ?? "");
        // "wait" is the busy GROUP: resolve the manifest's `working` intent (the weighted
        // pool faithful to wait-weights.json) and render the pick (frame-expr or firmware).
        if (exprName === "wait") {
          const note = await renderIntent({ intent: "working" });
          return { content: [{ type: "text", text: `Busy indicator: ${note}.` }] };
        }
        const expr = CANNED[exprName] ?? (await loadSavedExpression(exprName));
        if (!expr) {
          const saved = await listSavedExpressions();
          return { content: [{ type: "text", text:
            `No expression named "${exprName}". Canned: ${Object.keys(CANNED).join(", ")}. Saved: ${saved.map((s) => s.name).join(", ") || "(none)"}.` }] };
        }
        const wire = expressionToWire(expr);
        const r = await post("/api/display/frames", wire);
        return { content: [{ type: "text", text: r.ok
          ? `Expressing "${exprName}" on the matrix (${wire.frames.length} frame${wire.frames.length > 1 ? "s" : ""}${wire.loop ? `, ${wire.loop} pass(es) then hold` : ", looping"}).`
          : `Error ${r.status}: ${r.body}` }] };
      }

      case "presence_set": {
        let msg;
        try {
          msg = normalizePresence(args);
        } catch (e) {
          return { content: [{ type: "text", text: `Invalid presence: ${(e as Error).message}` }] };
        }

        // Always publish the full message for the card.
        const pr = await post("/api/presence", msg);
        const cardNote = pr.ok ? "card updated" : `card POST error ${pr.status}`;

        let ledNote: string;
        if (msg.data) {
          // Data present → the board renders it natively (v0.5).
          const lr = await post("/api/display/animation", { type: "presence" });
          ledNote = lr.ok ? "8x8 → data" : `8x8 data error ${lr.status}`;
        } else {
          // No data → resolve the intent's binding via the manifest and render the glyph.
          // Never blank: a missing/unbound intent falls back to `info`.
          let note = await renderIntent({ intent: msg.intent });
          if (note === "no binding" || note.startsWith("no glyph")) {
            note = await renderIntent({ intent: "info" });
          }
          ledNote = `8x8 → ${note}`;
        }

        return { content: [{ type: "text", text: `Presence "${msg.intent}" set (${cardNote}; ${ledNote}).` }] };
      }

      case "matrix_idle": {
        const { manifest, resolve, isFirmwareName } = await engine();
        const resolved = resolve(manifest, { renderer: "esp32-8x8", intent: "screensaver" }, renderCtx);
        if (!resolved) return { content: [{ type: "text", text: "No screensaver binding configured." }] };
        const note = await runPlan(decideRender(resolved, isFirmwareName));
        const label = resolved.label ?? String(resolved.value);
        return { content: [{ type: "text", text: `Idle pick: ${label} (${note}).` }] };
      }

      case "matrix_animate": {
        const expr: Expression = {
          description: String(args.description ?? "custom animation"),
          frames: args.frames as string[][],
          colors: (args.colors ?? {}) as Record<string, string>,
          frame_ms: args.frame_ms as number | undefined,
          loop: args.loop as number | undefined,
        };
        let wire;
        try {
          wire = expressionToWire(expr);   // validates shape, rows, colors
        } catch (e) {
          return { content: [{ type: "text", text: `Invalid animation: ${e instanceof Error ? e.message : String(e)}` }] };
        }
        const r = await post("/api/display/frames", wire);
        if (!r.ok) return { content: [{ type: "text", text: `Error ${r.status}: ${r.body}` }] };

        let savedNote = "";
        if (args.save_as) {
          const saveName = String(args.save_as).toLowerCase().replace(/[^a-z0-9-]/g, "-");
          await mkdir(EXPR_DIR, { recursive: true });
          await writeFile(path.join(EXPR_DIR, `${saveName}.json`), JSON.stringify(expr, null, 2), "utf8");
          savedNote = ` Saved to the library as "${saveName}" — replay anytime with matrix_express.`;
        }
        return { content: [{ type: "text", text: `Animating ${wire.frames.length} frame(s) on the matrix.${savedNote}` }] };
      }

      case "matrix_list_expressions": {
        const canned = Object.entries(CANNED).map(([n, e]) => `- ${n}: ${e.description}`);
        const saved = (await listSavedExpressions()).map((s) => `- ${s.name}: ${s.description}`);
        return { content: [{ type: "text", text:
          `Canned expressions:\n${canned.join("\n")}\n\nSaved expressions:\n${saved.length ? saved.join("\n") : "(none yet — create with matrix_animate save_as)"}` }] };
      }

      case "matrix_get_temperature": {
        const r = await get("/api/sensors/temperature");
        return { content: [{ type: "text", text: r.ok ? r.body : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_get_weather_data": {
        const r = await get("/api/sensors/weather");
        return { content: [{ type: "text", text: r.ok ? r.body : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_get_accelerometer": {
        const r = await get("/api/sensors/accelerometer");
        return { content: [{ type: "text", text: r.ok ? r.body : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_get_settings": {
        const r = await get("/api/settings");
        return { content: [{ type: "text", text: r.ok ? r.body : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_set_settings": {
        const patch = normalizeSettingsPatch(args as Record<string, unknown>);
        if (Object.keys(patch).length === 0) {
          return { content: [{ type: "text", text: "No recognized settings to change." }] };
        }
        const r = await post("/api/settings", patch);
        return { content: [{ type: "text", text: r.ok ? `Settings updated: ${r.body}` : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_studio": {
        const text = engineUrl
          ? `Expression Studio: ${engineUrl}/studio/index.html\nVirtual board (live mirror): ${engineUrl}/studio/board.html`
          : "Engine HTTP server is not running (no Studio URL).";
        return { content: [{ type: "text", text }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }

  } catch (err: unknown) {
    // fetch() throws (rather than returning a failed response) when the board
    // is completely unreachable — wrong IP, board unplugged, WiFi down, etc.
    // Without this catch the whole server process would crash.
    // We catch it and return a readable message so Claude can report it gracefully.
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Could not reach board at ${BOARD_URL}: ${message}` }] };
  }
});

// ------------------------------------------------------------
// ENTRY POINT
// Node.js has no built-in entry point like C#'s static void Main().
// The convention is to define an async function called main() and
// call it at the bottom of the file.
//
// StdioServerTransport wires the server to stdin/stdout.
// console.error goes to stderr (safe — doesn't corrupt the protocol pipe).
// ------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    const eng = await startEngineServer({ mcpDir: MCP_DIR, boardUrl: BOARD_URL });
    engineHub = eng.hub;
    engineUrl = eng.url;
    await writeFile(path.join(MCP_DIR, ".engine-url"), eng.url, "utf8").catch(() => {});
    console.error("Engine Studio on", `${eng.url}/studio/index.html`);
  } catch (e) {
    console.error("Engine HTTP server failed to start (MCP tools still work):", (e as Error).message);
  }
  console.error("ESP32 Matrix MCP server running. Board:", BOARD_URL);
}

main();
