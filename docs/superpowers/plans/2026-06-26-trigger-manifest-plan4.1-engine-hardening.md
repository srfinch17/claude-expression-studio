# Trigger Manifest — Plan 4.1 (Engine Hardening: true board mirror + honesty fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `studio/board.html` a TRUE live mirror of the physical 8×8 panel (reflecting every render path — firmware animations, scrolling text, expressions, presence) by polling the board's existing framebuffer through a new engine proxy, with the Plan-4 SSE stream as the no-hardware fallback; plus three accuracy fixes the first real `.mcpb` run surfaced (the `matrix_studio` tool description, `VERSION` missing from the bundle, and `claudesweep` missing from the `idle_apps` doc).

**Architecture:** The board firmware already serves `GET /api/display/framebuffer` → `{px:[64 "RRGGBB" row-major]}` — an exact mirror of the real `leds[]`, every render path, no JS re-implementation (the firmware comment + `data/calendar.html`'s `pollFramebuffer()` are the proven template). `board.html` can't fetch the board directly (it's served from `127.0.0.1:<port>`; cross-origin to `esp32matrix.local` → CORS-blocked), so the **engine proxies** it: a new same-origin `GET /api/framebuffer` route fetches the board server-side. `board.html` polls that ~6×/s; on success it draws the real frame ("live"); on failure (board unreachable) it falls back to the Plan-4 SSE `/events` stream ("virtual"). This is exactly Decision D2's "mirror with or without hardware," now honored properly: *pull* from the dumb hardware that can't push, *push* the virtual renders the engine generates itself.

**Tech Stack:** TypeScript engine (`node:http`, global `fetch`), the shared bloom `Panel` (`shared/render.js`), the existing `studio/board.js` decode helpers, the existing version + bundle-staging scripts. No new dependency.

## Global Constraints

- **Privacy:** never use the maintainer's real name — refer to "the user". (verbatim from CLAUDE.md)
- **No new runtime dependency** in `mcp_server/package.json` — Node built-ins + the already-used global `fetch` only.
- **Engine binds `127.0.0.1` ONLY** — unchanged from Plan 4; the new proxy route does not alter the bind.
- **Don't hammer the single-client board:** the board's HTTP server shares its loop with rendering; the framebuffer poll MUST skip when the page is hidden (`document.hidden`) and use a sane cadence (~150ms), mirroring `data/calendar.html:181-187`.
- **Framebuffer is RAW pre-brightness color** (`api_handlers.ino:699`) — draw it at full strength (matches the project's "canvas previews render at full brightness" rule); do NOT apply the board's brightness.
- **Repo-first / bundle-fallback** for any engine asset path (mirror `engineDir()` in `mcp_server/engine.ts:34`).
- **Never break the MCP pipe / never blank the board:** the proxy route and board.html changes are additive; a board-unreachable proxy returns a clean status, never throws; engine logging stays on `stderr`.
- **Tests:** `npm test` (runs `check:manifest`, then `tsc` to build `dist/`, then `node --test` over `scripts/**`, `mcp_server/**/*.test.ts`, `shared/**`, `studio/**`). Keep it green + pristine at every commit. The engine test files import the COMPILED `dist/` (Node type-strip can't resolve engine-server's `.js`-specifier sibling imports) — follow that established pattern.
- **This is on `feat/expression-studio`** (not master); no merge in this plan.

---

## Context the implementer needs (verified facts)

- **Board endpoint** (`esp32_matrix_webserver/api_handlers.ino:701` `handleFramebuffer`): `GET /api/display/framebuffer` → `{"px":["RRGGBB", … 64]}`, row-major `index = y*8 + x`, raw pre-brightness.
- **Proven poll template:** `esp32_matrix_webserver/data/calendar.html:181-187` `pollFramebuffer()` — `if (document.hidden) return;` then `fetch('/api/display/framebuffer')` → `d.px`. (That page is served FROM the board, so its fetch is same-origin; `board.html` is served from the engine, hence the proxy.)
- **Engine server** (`mcp_server/engine-server.ts`): `startEngineServer({mcpDir, port?, manifestDir?, repoRoot?})` returns `{url, port, hub, close}`. Routes: `/`→302, `/events`→SSE, `GET|PUT /api/manifest`, else static. Add the framebuffer route here.
- **Board URL** lives in `mcp_server/index.ts:101`: `const BOARD_URL = process.env.ESP32_URL ?? "http://esp32matrix.local";`. Pass it into the engine.
- **board.js** (`studio/board.js`) exports `framesFromWire`, `applyEvent`, `connectBoard`. It already decodes the 384-char wire-frame format; the framebuffer `px` is a DIFFERENT shape (an array of 64 separate 6-char strings) → needs its own decoder.
- **board.html** currently: a canvas + `Panel` + `web-sim` + `connectBoard(new EventSource("/events"))`. The mirror loop is added here.
- **matrix_studio description** (`mcp_server/index.ts:554`) currently oversells: "live virtual board mirror the display, and to view/edit the animation library."
- **matrix_set_settings description** (`mcp_server/index.ts:535`) lists idle apps `fire, matrix_rain, clock, fireworks, frostbite, snow, dancefloor` — missing `claudesweep` (which is live in firmware + in the default `idle_apps`).
- **versionReport** (`mcp_server/index.ts:191`) reads `path.join(REPO_ROOT, "VERSION")` — absent in the packed `.mcpb` (only `mcp_server/` is packed) → reports `unknown` → every row flags DRIFT.
- **Bundle staging** (`scripts/copy-shared-runtime.mjs`): `FILES = ["manifest.json","resolver.js","firmware-names.js"]` copied into `mcp_server/shared-runtime/`; `cpSync` stages `studio/`+`shared/` into `mcp_server/studio-dist/`. Add `VERSION` staging here.

---

## File Structure

**Modified:**
- `studio/board.js` — add `framesFromPx(px)` (pure: `["RRGGBB"×64]` → one `Panel` `Frame`), reusing the same lit-pixel/row-major rules as `framesFromWire`. Add `connectMirror(...)` glue (poll + fallback orchestration) kept thin; the pure decode is the unit-tested part.
- `studio/board.html` — replace the SSE-only wiring with the mirror controller: poll `/api/framebuffer` (~150ms, `document.hidden`-guarded), draw on success ("live"), fall back to the SSE stream on failure ("virtual"), show a tiny status indicator.
- `studio/board.test.js` — add `framesFromPx` tests.
- `mcp_server/engine-server.ts` — add `boardUrl?` to opts; add `GET /api/framebuffer` proxy route (server-side fetch of `boardUrl/api/display/framebuffer`, short timeout; 200 `{px}` on success, 503 `{reachable:false}` on failure).
- `mcp_server/engine-server.test.ts` — add a proxy test (spin a fake "board" http server returning `{px}`; assert the engine proxies it; assert 503 when boardUrl is unreachable/absent).
- `mcp_server/index.ts` — pass `boardUrl: BOARD_URL` to `startEngineServer`; rewrite the `matrix_studio` description (accurate); add `claudesweep` to the `matrix_set_settings` description; make `versionReport`'s VERSION read repo-first/bundle-fallback.
- `scripts/copy-shared-runtime.mjs` — also copy repo `VERSION` into `mcp_server/shared-runtime/VERSION`.
- `scripts/copy-shared-runtime.test.js` — assert the staged `VERSION` exists.

---

## Task 1: Framebuffer decode (`studio/board.js` `framesFromPx`)

**Files:**
- Modify: `studio/board.js`
- Test: `studio/board.test.js`

**Interfaces:**
- Produces: `framesFromPx(px) → Array<{x,y,r,g,b}>` — decodes ONE framebuffer (`px` = array of 64 `"RRGGBB"` strings, row-major `i = y*8+x`) into a single `Panel` `Frame` (lit pixels only; a pixel with `r|g|b === 0` is dropped). Returns `[]` for a malformed/empty `px`.

- [ ] **Step 1: Write the failing test** (append to `studio/board.test.js`)

```js
import { framesFromPx } from "./board.js"; // add to the existing import line

test("framesFromPx decodes a 64-entry px array to lit pixels, row-major", () => {
  const px = Array.from({ length: 64 }, (_, i) => (i === 9 ? "00ff00" : "000000"));
  const frame = framesFromPx(px);
  // index 9 => x=1, y=1, green
  assert.deepEqual(frame, [{ x: 1, y: 1, r: 0, g: 255, b: 0 }]);
});

test("framesFromPx drops off pixels and tolerates a bad px", () => {
  assert.deepEqual(framesFromPx([]), []);
  assert.deepEqual(framesFromPx(null), []);
  const allOff = Array.from({ length: 64 }, () => "000000");
  assert.deepEqual(framesFromPx(allOff), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test studio/board.test.js`
Expected: FAIL — `framesFromPx is not a function` (or an import error for the new name).

- [ ] **Step 3: Write minimal implementation** (add to `studio/board.js`)

```js
// Decode a framebuffer poll (GET /api/display/framebuffer -> { px: ["RRGGBB"×64] },
// row-major i = y*8+x, raw pre-brightness) into a single Panel Frame (lit pixels only).
export function framesFromPx(px) {
  if (!Array.isArray(px) || px.length < 64) return [];
  const out = [];
  for (let i = 0; i < 64; i++) {
    const hex = px[i] || "000000";
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    if (r || g || b) out.push({ x: i % 8, y: (i / 8) | 0, r, g, b });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test studio/board.test.js`
Expected: PASS (existing board tests + the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add studio/board.js studio/board.test.js
git commit -m "feat(studio): framesFromPx — decode the board framebuffer to a Panel frame"
```

---

## Task 2: Engine framebuffer proxy (`mcp_server/engine-server.ts` `GET /api/framebuffer`)

**Files:**
- Modify: `mcp_server/engine-server.ts`
- Test: `mcp_server/engine-server.test.ts`

**Interfaces:**
- Consumes: nothing new (uses global `fetch`).
- Produces: `startEngineServer` opts gains `boardUrl?: string`. New route `GET /api/framebuffer`: server-side `fetch(boardUrl + "/api/display/framebuffer")` with a short timeout (1500ms); on a 2xx, respond `200` with the board's JSON body (`{px:[…]}`) passed through; on any failure (no `boardUrl`, fetch throws, timeout, non-2xx), respond `503 {"reachable":false}`. This is the same-origin endpoint `board.html` polls.

- [ ] **Step 1: Write the failing test** (append to `mcp_server/engine-server.test.ts`)

```ts
import http from "node:http"; // ensure imported

test("GET /api/framebuffer proxies the board's framebuffer", async () => {
  // fake "board" that returns a framebuffer
  const px = Array.from({ length: 64 }, (_, i) => (i === 0 ? " FF0000".trim() : "000000"));
  const board = http.createServer((req, res) => {
    if (req.url === "/api/display/framebuffer") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ px }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => board.listen(0, "127.0.0.1", () => r()));
  const boardUrl = `http://127.0.0.1:${(board.address() as any).port}`;

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl });
  after(() => { eng.close(); board.close(); });

  const r = await fetch(`${eng.url}/api/framebuffer`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.px.length, 64);
  assert.equal(body.px[0], "FF0000");
});

test("GET /api/framebuffer returns 503 reachable:false when the board is unreachable", async () => {
  // an unused port → connection refused
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl: "http://127.0.0.1:1" });
  after(() => eng.close());
  const r = await fetch(`${eng.url}/api/framebuffer`);
  assert.equal(r.status, 503);
  assert.equal((await r.json() as any).reachable, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp_server && npx tsc --project tsconfig.json && node --test dist/... ` — simpler: `npm test` (builds dist first).
Expected: FAIL — `/api/framebuffer` currently falls through to `serveStatic` → 404 (not 200/503), and `boardUrl` is not an accepted opt.

- [ ] **Step 3: Write minimal implementation** (`mcp_server/engine-server.ts`)

Add `boardUrl?: string` to the opts type, capture it, and add the route BEFORE the static fallback (alongside `/api/manifest`):

```ts
// opts type:
export async function startEngineServer(opts: { mcpDir: string; port?: number; manifestDir?: string; repoRoot?: string; boardUrl?: string }) {
  // ... existing setup ...
  const boardUrl = opts.boardUrl;
```

```ts
// route, placed with the other /api routes (before serveStatic):
if (url.startsWith("/api/framebuffer")) {
  if (!boardUrl) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false })); return; }
  try {
    const fb = await fetch(`${boardUrl}/api/display/framebuffer`, { signal: AbortSignal.timeout(1500) });
    if (!fb.ok) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false })); return; }
    const body = await fb.text();
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false }));
  }
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — both new framebuffer tests + the full suite green, pristine.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/engine-server.ts mcp_server/engine-server.test.ts
git commit -m "feat(engine): GET /api/framebuffer proxy (same-origin board mirror for board.html)"
```

---

## Task 3: board.html true mirror (poll + SSE fallback)

**Files:**
- Modify: `studio/board.js` (add `connectMirror`), `studio/board.html`
- Test: `studio/board.test.js` (a focused test for the source-selection rule)

**Interfaces:**
- Consumes: `framesFromPx` (Task 1), the `/api/framebuffer` route (Task 2), the existing `/events` SSE + `applyEvent`/`connectBoard`.
- Produces: `mirrorGate(boardOnline)` — a tiny PURE helper: returns whether SSE events should draw (`true` only when the board is offline). Plus `connectMirror({ panel, webSim, fetchFb, source, onStatus })` glue in `board.js` (DOM-free enough to import, exercised mainly via the manual smoke). The poll loop + `document.hidden` guard live in `board.html`.

- [ ] **Step 1: Write the failing test** (append to `studio/board.test.js`)

```js
import { mirrorGate } from "./board.js"; // add to imports

test("mirrorGate: SSE draws only when the board is offline", () => {
  assert.equal(mirrorGate(true), false);   // board online → framebuffer is the truth, ignore SSE
  assert.equal(mirrorGate(false), true);    // board offline → SSE is the only source
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test studio/board.test.js`
Expected: FAIL — `mirrorGate is not a function`.

- [ ] **Step 3: Implement `mirrorGate` + `connectMirror`** (`studio/board.js`)

```js
// When the board is reachable, its framebuffer poll is the source of truth (it already
// reflects SSE-driven renders, since those also hit the board) — so SSE events are
// ignored. Only when the board is offline does the SSE stream become the display.
export function mirrorGate(boardOnline) { return !boardOnline; }

// Wire the SSE fallback so it only draws while offline. `state` is a shared object the
// poll loop (in board.html) flips: state.online = true on a good framebuffer poll.
export function connectMirror({ panel, webSim, source, state }) {
  source.onmessage = (m) => {
    if (!mirrorGate(state.online)) return;          // board online → framebuffer owns the panel
    try { applyEvent(JSON.parse(m.data), { panel, webSim }); } catch { /* ignore malformed */ }
  };
  return source;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test studio/board.test.js`
Expected: PASS.

- [ ] **Step 5: Rewrite `studio/board.html`'s script** to poll the framebuffer (primary) + SSE (fallback) + a status dot

```html
<canvas id="board" width="512" height="512"></canvas>
<div id="status" style="position:fixed;bottom:10px;left:12px;font:12px ui-monospace,monospace;color:#888">connecting…</div>
<script type="module">
  import { Panel } from "../shared/render.js";
  import { makeWebSimRenderer } from "../shared/renderers/web-sim.js";
  import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
  import { framesFromPx, connectMirror } from "./board.js";

  const cv = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const panel = new Panel(cv, { device: cv });
  const webSim = makeWebSimRenderer({ panel, loadExpression: () => null, firmwareSims: FIRMWARE_SIMS });

  let last = performance.now();
  (function loop(now) { panel.tick(now - last, now); last = now; requestAnimationFrame(loop); })(last);

  // shared state the poll loop flips; the SSE fallback reads it via connectMirror.
  const state = { online: false };
  connectMirror({ panel, webSim, source: new EventSource("/events"), state });

  // Primary source: poll the engine's framebuffer proxy (the real panel). Skip when
  // hidden so we don't hammer the single-client board (mirrors data/calendar.html).
  async function pollFramebuffer() {
    if (document.hidden) return;
    try {
      const r = await fetch("/api/framebuffer");
      if (r.ok) {
        const { px } = await r.json();
        state.online = true;
        panel.setFrames([framesFromPx(px)], 1000);   // single static frame; refreshed each poll
        statusEl.textContent = "● live — mirroring the board";
      } else {
        state.online = false;
        statusEl.textContent = "○ virtual — board offline (showing intents)";
      }
    } catch {
      state.online = false;
      statusEl.textContent = "○ virtual — board offline (showing intents)";
    }
  }
  setInterval(pollFramebuffer, 150);
  pollFramebuffer();
</script>
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: green, pristine (the new `mirrorGate` test runs under the `studio/**` glob).

- [ ] **Step 7: Manual browser smoke** (DEFER to the end-of-plan human validation — do not block the commit)

With the engine running and the board reachable: open `/studio/board.html`, run `matrix_set_animation` (fire), `matrix_show_text`, `matrix_express("smiley")` → the canvas mirrors ALL of them ("● live"). Then make the board unreachable (set `ESP32_URL` to a dead address or unplug) → status flips to "○ virtual", and `presence_set`/`matrix_express("wait")` still render via SSE. Note results; the subagent cannot perform this step.

- [ ] **Step 8: Commit**

```bash
git add studio/board.js studio/board.html studio/board.test.js
git commit -m "feat(studio): board.html is a true panel mirror (framebuffer poll) with SSE fallback"
```

---

## Task 4: index.ts wiring + honesty fixes

**Files:**
- Modify: `mcp_server/index.ts`

**Interfaces:**
- Consumes: `startEngineServer` now accepts `boardUrl` (Task 2).
- Produces: the engine receives `BOARD_URL` (so the proxy works live); accurate `matrix_studio` + `matrix_set_settings` descriptions.

- [ ] **Step 1: Pass `boardUrl` to the engine** — in `main()` where `startEngineServer` is called, add `boardUrl: BOARD_URL`:

```ts
const eng = await startEngineServer({ mcpDir: MCP_DIR, boardUrl: BOARD_URL });
```

- [ ] **Step 2: Rewrite the `matrix_studio` description** (`mcp_server/index.ts:554`) to match reality:

```ts
      description:
        "Get the local URL of the Expression Studio served by this engine. Open it in a browser to BROWSE the animation library (the Gallery is view-only for now — an editor is planned). The board.html page is a LIVE MIRROR of the physical panel when the board is reachable (it polls the real framebuffer), and falls back to showing fired intents when no board is present. Returns the URLs, or a note if the engine HTTP server is not running.",
```

(Keep the existing handler text strings — they already point at `/studio/index.html` and `/studio/board.html`, which remain correct.)

- [ ] **Step 3: Add `claudesweep` to the `matrix_set_settings` description** (`mcp_server/index.ts:535`) — change the app list `…, snow, dancefloor)` to `…, snow, dancefloor, claudesweep)`:

```ts
        "Change one or more board settings (persisted on the board, survives reflash). Only the fields you provide change. Fields: idle_enabled (bool), idle_apps (comma-separated app names from: fire, matrix_rain, clock, fireworks, frostbite, snow, dancefloor, claudesweep), idle_after_secs (seconds of quiet before the screensaver starts), idle_rotate_secs (seconds between screensaver changes), idle_brightness (1-255, screensaver dimness), default_brightness (0-255 on boot), boot_animation (animation type to show on power-up, or empty to resume last), timezone (POSIX TZ string for the clock), calibration_correction (bool — apply the measured LED color/brightness correction; turn off to A/B compare). Example: 'start the screensaver after 5 minutes' -> { idle_after_secs: 300 }.",
```

- [ ] **Step 4: Typecheck + full suite**

Run: `cd mcp_server && npx tsc --project tsconfig.json` (clean), then `npm test` (green, pristine).
Expected: PASS. (No new test — these are a one-line wiring change + two description-string edits; the VERSION read is Task 5, the proxy behavior is Task 2's test, and the live wiring is covered by the end-of-plan manual smoke.)

- [ ] **Step 5: Commit**

```bash
git add mcp_server/index.ts
git commit -m "feat(engine): wire BOARD_URL to the engine; correct matrix_studio + idle_apps descriptions"
```

---

## Task 5: VERSION in the bundle (fix `matrix_version` "unknown")

**Files:**
- Modify: `scripts/copy-shared-runtime.mjs`, `mcp_server/index.ts` (`versionReport`)
- Test: `scripts/copy-shared-runtime.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: repo `VERSION` staged into `mcp_server/shared-runtime/VERSION`; `versionReport` reads `REPO_ROOT/VERSION` first, then falls back to the bundled `MCP_DIR/shared-runtime/VERSION`, so the installed `.mcpb` reports the real version instead of `unknown`.

- [ ] **Step 1: Write the failing test** — add a staged-VERSION assertion to `scripts/copy-shared-runtime.test.js` (match the file's existing assertion style; it already checks `shared-runtime/manifest.json` etc.):

```js
test("copySharedRuntime stages the repo VERSION into the bundle", () => {
  copySharedRuntime();
  assert.ok(existsSync(join(REPO_ROOT, "mcp_server", "shared-runtime", "VERSION")));
});
```

(Reuse the test file's existing `REPO_ROOT`/`existsSync`/`join` imports; if it uses different local names, match them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/copy-shared-runtime.test.js`
Expected: FAIL — `shared-runtime/VERSION` does not exist (not staged yet).

- [ ] **Step 3: Stage VERSION** (`scripts/copy-shared-runtime.mjs`) — copy the repo `VERSION` into `shared-runtime/` alongside the `FILES` loop:

```js
// after the FILES copy loop, before the studio-dist staging:
copyFileSync(join(root, "VERSION"), join(dst, "VERSION"));
```

(`dst` is `mcp_server/shared-runtime`; `root` is the repo root — both already computed in the function.)

- [ ] **Step 4: Make `versionReport` read repo-first/bundle-fallback** (`mcp_server/index.ts:190-191`) — replace:

```ts
  let expected = "unknown";
  try { expected = readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim(); }
  catch { try { expected = readFileSync(path.join(MCP_DIR, "shared-runtime", "VERSION"), "utf8").trim(); } catch { /* leave unknown */ } }
```

- [ ] **Step 5: Run tests + build the bundle**

Run: `node --test scripts/copy-shared-runtime.test.js` → PASS.
Run: `npm test` → green, pristine.
Run: `npm run build:mcpb` then verify VERSION packed:
`node -e "console.log(require('child_process').execSync('tar -tf release/esp32-matrix.mcpb').toString().split('\n').filter(l=>/shared-runtime\/VERSION/.test(l)).join('\n'))"`
Expected: `shared-runtime/VERSION` listed.

- [ ] **Step 6: Commit**

```bash
git add scripts/copy-shared-runtime.mjs scripts/copy-shared-runtime.test.js mcp_server/index.ts
git commit -m "fix(engine): stage VERSION into the .mcpb so matrix_version reports current in the installed extension"
```

---

## Risks & notes

- **The mirror needs the board reachable from the engine process** (same requirement as every other MCP board call). When unreachable, the proxy returns 503 and board.html shows "○ virtual" + the SSE intents — a graceful, labeled degrade, not a blank.
- **Poll cadence (150ms) vs the single-client board:** the `document.hidden` guard means a backgrounded tab stops polling entirely (matching `calendar.html`). If two pages poll at once the board still copes (it's a cheap GET), but keep the cadence ≥150ms.
- **`matrix_version` in the bundle** now reports the staged VERSION; if a future build forgets to stage it, the fallback simply returns `unknown` again (no crash).
- **No firmware change** — `/api/display/framebuffer` already exists and is unchanged.

## Manual validation checklist (end of plan)

1. `npm run build:mcpb`, reinstall the `.mcpb` in Claude Desktop, `/mcp`-reconnect.
2. `matrix_studio` → open `board.html`. With the board reachable, fire `matrix_set_animation` (fire), `matrix_show_text`, `matrix_express("smiley")`, `presence_set` → board.html mirrors **all** of them; status shows "● live".
3. Make the board unreachable (`ESP32_URL` to a dead address, or unplug) → status flips to "○ virtual"; `presence_set` / `matrix_express("wait")` still render via SSE.
4. `matrix_version` → reports `0.12.0` across all rows, **no DRIFT**.
5. `matrix_set_settings` description lists `claudesweep`; `matrix_studio` description no longer claims "edit".

---

## Self-Review

**Requirement coverage (the dev-run findings this plan owns):**
- §2 board.html not a true mirror → Tasks 1+2+3 (framebuffer decode + proxy + poll/fallback). ✓
- P1 `matrix_studio` description inaccurate → Task 4. ✓
- P1/P2 `matrix_version` "unknown"/DRIFT → Task 5. ✓
- P3 `idle_apps` schema drift (`claudesweep`) → Task 4. ✓
- §3 Studio editor → explicitly OUT (next plan, Plan 6); not in scope here. ✓
- Weather cache / UV=0 / chip-temp → OUT (pre-existing firmware, separate backlog). ✓

**Placeholder scan:** no TBD / "handle errors" / "similar to"; every code step has complete code; every run step states the expected result. ✓

**Type/name consistency:** `framesFromPx` (Task 1) is consumed in Task 3's board.html; `mirrorGate`/`connectMirror` defined and used consistently (Task 3); `boardUrl` opt added in Task 2 and passed in Task 4; the proxy returns `{px}`/`{reachable:false}` consumed by board.html's poll. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-trigger-manifest-plan4.1-engine-hardening.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, Opus final whole-plan review. (Implementers: HAIKU for the transcription tasks T1/T4/T5, SONNET for T2/T3; SONNET reviewers; OPUS final.)

**2. Inline Execution** — execute in this session via executing-plans with checkpoints.

**Which approach?**
