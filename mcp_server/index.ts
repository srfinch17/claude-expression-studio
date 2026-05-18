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

// ------------------------------------------------------------
// HTTP HELPERS
// Two small async functions so every tool handler doesn't have
// to repeat the same fetch boilerplate.
// ------------------------------------------------------------

// GET — for read-only requests (sensor data, status)
async function get(path: string) {
  const res = await fetch(`${BOARD_URL}${path}`);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// POST — for commands that change board state (animations, brightness, etc.)
// body defaults to {} so callers don't have to pass anything for simple commands.
async function post(path: string, body: object = {}) {
  const res = await fetch(`${BOARD_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),   // convert JS object → JSON string for the wire
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

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
    version: "1.0.0",
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
      // This description is long because it's Claude's rulebook for all 14 animation types.
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
- clock: live 12-hour clock synced via NTP. params: timezone (UTC offset as integer, e.g. -7 for Arizona), color (hex background color)
- matrix_rain: digital rain / matrix screensaver with falling character drops. Also called "matrix screensaver" or "digital rain". params: theme (classic/blue/red/purple), speed (1-5)

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
              "clock", "matrix_rain",
            ],
            description: "The animation type to start.",
          },
          // All remaining params are optional and animation-specific.
          // Claude reads the descriptions above to know which ones apply to each type.
          palette:     { type: "string",  description: "Fire palette: classic, blue, green, or purple." },
          intensity:   { type: "number",  description: "Fire intensity 1-10. Default 6. Use 3 for low, 6 for medium, 9 for high." },
          tendrils:    { type: "number",  description: "Fire tendrils 0-10. 0 = off, 5 = medium wisps, 10 = very wispy. Default 0." },
          sparks:      { type: "number",  description: "Fire spark rate 0-10. 0 = off, 5 = medium, 10 = many sparks. Default 0." },
          color:       { type: "string",  description: "Color hex for solid fill or clock background." },
          color1:      { type: "string",  description: "Primary color hex." },
          color2:      { type: "string",  description: "Secondary color hex." },
          color3:      { type: "string",  description: "Tertiary color hex." },
          viscosity:   { type: "number",  description: "Liquid viscosity 0-10. Higher is thicker." },
          zipcode:     { type: "string",  description: "US zip code for weather data." },
          units:       { type: "string",  description: "Temperature units: F or C." },
          data_mode:   { type: "string",  description: "Weather data to display: temp, humidity, uv, pressure, or cycle." },
          icon_source: { type: "string",  description: "Weather icon source: animated or remote." },
          duration:    { type: "number",  description: "Timer duration in seconds." },
          timezone:    { type: "number",  description: "UTC offset in hours, e.g. -7 for Arizona (no DST)." },
          theme:       { type: "string",  description: "Matrix rain color theme: classic, blue, red, or purple." },
          speed:       { type: "number",  description: "Animation speed 1-5. 1 = slow, 3 = normal, 5 = fast. Applies to all animations." },
        },
        required: ["type"],
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

      case "matrix_set_brightness": {
        const r = await post("/api/brightness", { level: args.level });
        return { content: [{ type: "text", text: r.ok ? `Brightness set to ${args.level}.` : `Error ${r.status}: ${r.body}` }] };
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
        if (payload.speed !== undefined) {
          const spd = Number(payload.speed);
          if (spd >= 1 && spd <= 5) {
            const msMap: Record<number, number> = { 1: 150, 2: 100, 3: 66, 4: 40, 5: 20 };
            payload.speed = msMap[Math.round(spd)] ?? 66;
          }
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
  console.error("ESP32 Matrix MCP server running. Board:", BOARD_URL);
}

main();
