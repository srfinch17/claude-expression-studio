# board.html Local-First Showcase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invert `studio/board.html` from mirror-first to local-first — render the JS animation library natively as the primary (smooth, board-less) experience, with the framebuffer mirror + SSE as the live special cases.

**Architecture:** One `Panel` (`shared/render.js`) driven by a precedence state machine **MIRROR > LIVE > AMBIENT** (+ a visitor PIN side-state). New behaviour is split into small **pure** functions in `studio/board.js` (unit-tested under `node --test`) and **thin glue** in `studio/board.html` (verified visually on the running server). A curated scenic playlist lives in `studio/showcase.js`. The live mirror (`/api/framebuffer` poll) and SSE (`/events`) only wire up when a one-shot probe finds an engine; on a static host the page is a pure local showcase.

**Tech Stack:** Native ES modules, no bundler, no new deps. Canvas 2D bloom renderer. `node:test` + `node:assert/strict`.

## Global Constraints

- **Branch `feat/expression-studio`. No merge** — the repo cut is the final step of the whole arc.
- **No new runtime dependencies.** Native ES modules only.
- **Reuse the one render core** (`shared/`) — no second renderer copy (grep-enforced).
- **Pure logic is unit-tested** (`node --test`); DOM/browser glue is thin and verified visually.
- **Keep existing `studio/board.js` exports** (`framesFromWire`, `framesFromPx`, `applyEvent`, `mirrorGate`, `connectBoard`, `connectMirror`) and their tests intact — this plan only ADDS.
- **No `gallery-data.json` generator input changes** → no regen. (If a later step ever touches a generator input, regenerate with `npm run build:gallery` and `git add` it in the same commit.)
- **Full suite:** `npm test` (runs `check-manifest`, `tsc`, then `node --test` across `scripts/`, `mcp_server/`, `shared/`, `studio/`). Must stay green.
- **Privacy:** never use the maintainer's real name in code/comments/docs — refer to "the user".
- **Out of scope:** the Studio editor (Plan 6), Pages deploy wiring (Plan 5), `shared/manifest.json` changes, firmware changes, the repo cut.

---

## File Structure

- **Create** `studio/showcase.js` — the curated scenic name array (`SHOWCASE`). Pure data; hand-tunable by the user (the taste gate).
- **Modify** `studio/board.js` — add pure functions: `buildPlaylists`, `arbitrate`, `nextIndex`, `isEngineResponse`, and the `DECAY_MS` constant. Keep all existing exports.
- **Modify** `studio/board.test.js` — add tests for the new pures (keep existing tests).
- **Rewrite** `studio/board.html` — local-first layout (hero panel + pin strip + status pill) and glue (ambient scheduler, engine probe, mirror poll, SSE), all calling the new pures.

Task 1 → `showcase.js` + `buildPlaylists`. Task 2 → `arbitrate` + `nextIndex` + `isEngineResponse` + `DECAY_MS`. Task 3 → the `board.html` rewrite.

---

## Task 1: Curated showcase list + `buildPlaylists`

**Files:**
- Create: `studio/showcase.js`
- Modify: `studio/board.js` (append new pure `buildPlaylists`; keep existing exports)
- Test: `studio/board.test.js` (append)

**Interfaces:**
- Consumes: `gallery-data.json` shape `{ expressions: Array<{name, frames, colors, frame_ms, loop, group, approved, description}>, firmware: string[] }`.
- Produces:
  - `SHOWCASE: string[]` (from `studio/showcase.js`) — curated scenic names (firmware + saved).
  - `buildPlaylists(galleryData, firmwareKeys, showcaseNames) -> { ambient: Item[], all: Item[] }`
    where `Item = { name: string, kind: "firmware" | "expression", entry: object | null }`.
    `all` = every renderable item (firmware first, then expressions, deduped by name, first wins).
    `ambient` = `showcaseNames` mapped through the name→item index, **unknown names skipped**, original showcase order preserved.

- [ ] **Step 1: Create `studio/showcase.js`**

```javascript
// studio/showcase.js — the curated AMBIENT showcase: the kinetic-art pieces that
// play when nobody is driving the face. Firmware sims + scenic saved animations.
// Communicative glyphs (done/alert/smiley/cross/wait-*/ask-*/idea/task-complete,
// the mascot claude-idle) are deliberately OUT — they only show when Claude actually
// drives the panel, but stay reachable via the click-to-pin strip.
// Hand-tunable: add or remove a name to change the resting face. Names that don't
// resolve to a real animation are silently skipped (see buildPlaylists).

export const SHOWCASE = [
  // firmware sims (all 15 are kinetic art)
  "claudesweep", "frostbite", "fire", "matrix_rain", "snow", "fireworks",
  "dancefloor", "rainbow", "breathe", "wave", "comet", "spiral", "starfield",
  "sun", "liquid",
  // scenic saved animations
  "atom", "bloom", "bomb", "butterfly", "compactor", "crystal-ball",
  "double-slit", "dusk", "fireflies", "goldfish", "hourglass", "inchworm",
  "jack-o-lantern", "jellyfish", "jupiter", "lava-lamp", "lightning", "meteor",
  "mushroom-cloud", "newtons-cradle", "potion", "rain", "reticle",
  "ringed-planet", "soundwave", "spinning-coin", "sunrise", "tornado", "ufo",
  "volcano", "warp-portal", "warrocket",
  // scenic anims that happen to be wired to other moments
  "aurora", "black-hole", "galaxy", "skull", "swarm-merge",
];
```

- [ ] **Step 2: Write the failing test** (append to `studio/board.test.js`)

```javascript
import { buildPlaylists } from "./board.js";

const fakeGallery = {
  expressions: [
    { name: "galaxy", frames: [["........", "........", "........", "........", "........", "........", "........", "........"]], colors: {}, frame_ms: 120 },
    { name: "smiley", frames: [["........"]], colors: {}, frame_ms: 150 },
  ],
  firmware: ["fire", "snow"],
};

test("buildPlaylists: ambient follows showcase order, skips unknown names, tags kinds", () => {
  const { ambient, all } = buildPlaylists(fakeGallery, ["fire", "snow"], ["fire", "galaxy", "nope"]);
  assert.deepEqual(ambient.map((i) => i.name), ["fire", "galaxy"]); // "nope" skipped
  assert.equal(ambient[0].kind, "firmware");
  assert.equal(ambient[1].kind, "expression");
  assert.equal(ambient[1].entry.name, "galaxy");
  assert.equal(ambient[0].entry, null);
  // all = every renderable: firmware first, then expressions
  assert.deepEqual(all.map((i) => i.name), ["fire", "snow", "galaxy", "smiley"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test studio/board.test.js`
Expected: FAIL — `buildPlaylists` is not exported.

- [ ] **Step 4: Implement `buildPlaylists`** (append to `studio/board.js`)

```javascript
// Build the renderable library from gallery-data + firmware sim names, and the
// curated ambient playlist. Item = { name, kind: "firmware"|"expression", entry }.
// entry is the gallery expression object (with frames/colors) or null for firmware.
export function buildPlaylists(galleryData, firmwareKeys, showcaseNames) {
  const byName = new Map();
  for (const name of firmwareKeys || []) {
    if (!byName.has(name)) byName.set(name, { name, kind: "firmware", entry: null });
  }
  for (const e of (galleryData && galleryData.expressions) || []) {
    if (!byName.has(e.name)) byName.set(e.name, { name: e.name, kind: "expression", entry: e });
  }
  const all = [...byName.values()];
  const ambient = [];
  for (const name of showcaseNames || []) {
    const it = byName.get(name);
    if (it) ambient.push(it);
  }
  return { ambient, all };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test studio/board.test.js`
Expected: PASS (existing board.js tests + the new one).

- [ ] **Step 6: Commit**

```bash
git add studio/showcase.js studio/board.js studio/board.test.js
git commit -m "feat(board): curated showcase list + buildPlaylists pure"
```

---

## Task 2: The state machine — `arbitrate`, `nextIndex`, `isEngineResponse`, `DECAY_MS`

**Files:**
- Modify: `studio/board.js` (append; keep existing exports)
- Test: `studio/board.test.js` (append)

**Interfaces:**
- Produces:
  - `DECAY_MS: number` — ms of SSE silence before LIVE decays to AMBIENT (25000).
  - `arbitrate({ mirrorOk, lastSseAt, now, pinned }) -> "mirror" | "live" | "pin" | "ambient"`.
    Precedence: mirror (board reachable) > live (an SSE event within `DECAY_MS`) > pin (visitor pinned) > ambient.
  - `nextIndex(cur, length, rng = Math.random) -> number` — next ambient index in `[0,length)`, never equal to `cur` when `length > 1`; returns `0` when `length <= 1`.
  - `isEngineResponse(status) -> boolean` — true for our engine routes (HTTP 200 board-live, or 503 board-unreachable); false otherwise (e.g. 404 on a static host). Used by the startup probe to decide whether to wire mirror+SSE at all.

- [ ] **Step 1: Write the failing tests** (append to `studio/board.test.js`)

```javascript
import { arbitrate, nextIndex, isEngineResponse, DECAY_MS } from "./board.js";

test("arbitrate: mirror wins over everything", () => {
  assert.equal(arbitrate({ mirrorOk: true, lastSseAt: 1000, now: 1000, pinned: true }), "mirror");
});

test("arbitrate: live while an SSE event is within DECAY_MS, not mirror", () => {
  const now = 100000;
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: now - 1000, now, pinned: true }), "live");
  // stale SSE -> not live
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: now - DECAY_MS - 1, now, pinned: false }), "ambient");
  // never any SSE -> not live
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: null, now, pinned: false }), "ambient");
});

test("arbitrate: pin when nothing live/mirror and a pin is held", () => {
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: null, now: 5, pinned: true }), "pin");
});

test("nextIndex: never repeats the current index when length > 1", () => {
  // length 1 -> always 0
  assert.equal(nextIndex(0, 1, () => 0.9), 0);
  // rng 0 from cur 0, length 3 -> 0 maps to slot, skips cur -> 1
  assert.equal(nextIndex(0, 3, () => 0), 1);
  // rng ~1 from cur 0, length 3 -> last other slot -> 2
  assert.equal(nextIndex(0, 3, () => 0.999), 2);
  // rng 0 from cur 2, length 3 -> 0 (< cur, no skip)
  assert.equal(nextIndex(2, 3, () => 0), 0);
  // exhaustive: result is always in range and never equals cur
  for (let cur = 0; cur < 4; cur++) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const n = nextIndex(cur, 4, () => r);
      assert.ok(n >= 0 && n < 4 && n !== cur, `cur=${cur} r=${r} -> ${n}`);
    }
  }
});

test("isEngineResponse: true for our routes (200/503), false otherwise", () => {
  assert.equal(isEngineResponse(200), true);
  assert.equal(isEngineResponse(503), true);
  assert.equal(isEngineResponse(404), false);
  assert.equal(isEngineResponse(0), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test studio/board.test.js`
Expected: FAIL — `arbitrate`/`nextIndex`/`isEngineResponse`/`DECAY_MS` not exported.

- [ ] **Step 3: Implement** (append to `studio/board.js`)

```javascript
// How long (ms) a live SSE-driven expression latches before decaying to ambient.
export const DECAY_MS = 25000;

// The precedence state machine. A reachable board (mirror) is ground truth and never
// decays; a live Claude session latches the face for DECAY_MS after the last intent;
// a visitor pin holds otherwise; ambient is the resting floor.
export function arbitrate({ mirrorOk, lastSseAt, now, pinned }) {
  if (mirrorOk) return "mirror";
  if (lastSseAt != null && now - lastSseAt < DECAY_MS) return "live";
  if (pinned) return "pin";
  return "ambient";
}

// Pick the next ambient index, never repeating the current one (unless there's only
// one item). Uniform over the other length-1 slots; rng is injectable for tests.
export function nextIndex(cur, length, rng = Math.random) {
  if (length <= 1) return 0;
  let n = Math.floor(rng() * (length - 1));
  if (n >= cur) n++; // skip the current slot
  return n;
}

// Does this HTTP status come from our engine routes? 200 = board live, 503 = engine
// up but board unreachable. Anything else (e.g. 404 from a static host) means no
// engine — the page runs as a pure local showcase (no mirror poll, no SSE).
export function isEngineResponse(status) {
  return status === 200 || status === 503;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test studio/board.test.js`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add studio/board.js studio/board.test.js
git commit -m "feat(board): arbitrate state machine + nextIndex + engine probe pures"
```

---

## Task 3: Rewrite `studio/board.html` as the local-first face

**Files:**
- Rewrite: `studio/board.html`

**Interfaces:**
- Consumes: `Panel` (`../shared/render.js`), `makeWebSimRenderer` (`../shared/renderers/web-sim.js`), `FIRMWARE_SIMS` (`../shared/firmware-sims.js`), `resolveExpression` (`../shared/expressions.js`), and from `./board.js`: `framesFromPx`, `applyEvent`, `buildPlaylists`, `arbitrate`, `nextIndex`, `isEngineResponse`, `DECAY_MS`; `SHOWCASE` (`./showcase.js`); `./gallery-data.json` (fetched).
- Produces: the rendered page (no module exports).

**Note:** This is browser glue — no unit test. Verified visually on the running local server (Step 3). The complete file is given below; write it verbatim.

- [ ] **Step 1: Write the new `studio/board.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Claude's Face — Expression Studio</title>
  <style>
    :root { --orange:#ff5008; --cyan:#22ddff; --bg:#060608; --dim:#8a8a96; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:#e8e8ef;
      font-family: ui-monospace, "IBM Plex Mono", monospace;
      min-height:100vh; display:flex; flex-direction:column; align-items:center;
      justify-content:center; gap:18px; padding:24px; }
    #stage { display:flex; flex-direction:column; align-items:center; gap:12px; }
    canvas { width:min(82vmin,720px); height:min(82vmin,720px); border-radius:16px;
      box-shadow:0 0 80px var(--glow, rgba(255,80,8,.35)); image-rendering:pixelated;
      background:var(--bg); }
    #status { font-size:13px; color:var(--dim); letter-spacing:.04em; min-height:1.2em; }
    #status b { color:#e8e8ef; font-weight:500; }
    #pins { display:flex; flex-wrap:wrap; gap:6px; justify-content:center;
      max-width:min(82vmin,720px); max-height:124px; overflow-y:auto; padding:4px; }
    #pins button { font:11px ui-monospace,monospace; color:var(--dim);
      background:#111118; border:1px solid #22222c; border-radius:7px;
      padding:4px 8px; cursor:pointer; transition:border-color .15s,color .15s; }
    #pins button:hover { color:#e8e8ef; border-color:#33333f; }
    #pins button.active { color:var(--orange); border-color:var(--orange); }
    #pins button.resume { color:var(--cyan); border-color:#1c4a55; }
  </style>
</head>
<body>
  <div id="stage">
    <canvas id="board" width="720" height="720"></canvas>
    <div id="status">starting…</div>
  </div>
  <div id="pins"></div>

  <script type="module">
    import { Panel } from "../shared/render.js";
    import { makeWebSimRenderer } from "../shared/renderers/web-sim.js";
    import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
    import { resolveExpression } from "../shared/expressions.js";
    import { framesFromPx, applyEvent, buildPlaylists, arbitrate, nextIndex, isEngineResponse, DECAY_MS } from "./board.js";
    import { SHOWCASE } from "./showcase.js";

    // Default params for the few firmware sims that take them (others -> {}).
    const FW_DEFAULTS = {
      frostbite:   { mist: 40, sparkle: 20 },
      fire:        { palette: "classic", intensity: 6 },
      matrix_rain: { theme: "classic", frame_ms: 60 },
      snow:        { frame_ms: 110, flakeColor: "#dce6ff" },
      dancefloor:  { palette: 0, hold: 6 },
    };
    const DWELL_MS = 7000;                 // ambient time per item
    const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;

    const cv = document.getElementById("board");
    const statusEl = document.getElementById("status");
    const pinsEl = document.getElementById("pins");
    const panel = new Panel(cv, { device: cv });
    const webSim = makeWebSimRenderer({ panel, loadExpression: () => null, firmwareSims: FIRMWARE_SIMS });

    // shared runtime state
    let ambItems = [], byName = new Map();
    let ambIdx = 0, ambNextAt = 0, curToken = null;
    let pinned = null, lastSseAt = null, mirrorOk = false;

    function setStatus(html) { statusEl.innerHTML = html; }

    function playItem(item) {
      if (!item) return;
      if (item.kind === "firmware") {
        const sim = FIRMWARE_SIMS[item.name](FW_DEFAULTS[item.name] || {});
        panel.setStepper(() => sim.frame(), sim.frame_ms);
      } else {
        const ex = resolveExpression(item.entry);
        panel.setFrames(ex.frames, ex.frame_ms);
      }
    }

    // Decide what should own the panel each frame and (for ambient/pin) feed it.
    // Mirror + live feed themselves from the poll loop / SSE handler.
    function control(now) {
      const src = arbitrate({ mirrorOk, lastSseAt, now, pinned: !!pinned });
      if (src === "mirror") { curToken = "mirror"; setStatus("● <b>live · board</b> — mirroring the panel"); return; }
      if (src === "live")   { curToken = "live";   setStatus("● <b>live</b> — Claude is driving"); return; }
      if (src === "pin") {
        const want = "pin:" + pinned.name;
        if (curToken !== want) { playItem(pinned); curToken = want; ambNextAt = 0; }
        setStatus("◉ <b>pinned</b> · " + pinned.name);
        return;
      }
      // ambient
      const inAmbient = curToken && curToken.startsWith("amb:");
      if (inAmbient && now < ambNextAt) return;              // keep showing current item
      if (inAmbient) ambIdx = nextIndex(ambIdx, ambItems.length); // dwell elapsed -> advance
      const it = ambItems[ambIdx];
      if (it) { playItem(it); curToken = "amb:" + it.name; ambNextAt = now + DWELL_MS; setStatus("○ <b>ambient</b> · " + it.name); }
      else setStatus("○ <b>ambient</b> — no library");
    }

    // --- build library + pin strip ---
    try {
      const data = await (await fetch("./gallery-data.json")).json();
      const built = buildPlaylists(data, Object.keys(FIRMWARE_SIMS), SHOWCASE);
      ambItems = built.ambient;
      byName = new Map(built.all.map((it) => [it.name, it]));
      // resume button + one button per renderable item
      const resume = document.createElement("button");
      resume.className = "resume"; resume.textContent = "↻ resume cycle";
      resume.onclick = () => { pinned = null; curToken = null; renderPins(); };
      function renderPins() {
        pinsEl.innerHTML = "";
        pinsEl.appendChild(resume);
        for (const it of built.all) {
          const b = document.createElement("button");
          b.textContent = it.name;
          if (pinned && pinned.name === it.name) b.className = "active";
          b.onclick = () => { pinned = it; curToken = null; renderPins(); };
          pinsEl.appendChild(b);
        }
      }
      renderPins();
    } catch (e) {
      setStatus("○ could not load library (" + e.message + ")");
    }

    // --- reduced motion: show one static frame, no cycling, no engine wiring ---
    if (REDUCE) {
      const it = ambItems[0];
      if (it && it.kind === "expression") { const ex = resolveExpression(it.entry); panel.setFrames(ex.frames.slice(0, 1), 1e9); }
      else if (it) { const sim = FIRMWARE_SIMS[it.name](FW_DEFAULTS[it.name] || {}); panel.setFrames([sim.frame()], 1e9); }
      setStatus("○ <b>ambient</b> · " + (it ? it.name : "—") + " (motion reduced)");
    } else {
      // main render + control loop
      let last = performance.now();
      (function loop(now) { panel.tick(now - last, now); last = now; control(now); requestAnimationFrame(loop); })(last);

      // mirror + SSE wire up ONLY when an engine answers (static host -> pure showcase)
      (async function detectEngineThenWire() {
        let engine = false;
        try { const r = await fetch("/api/framebuffer"); engine = isEngineResponse(r.status); } catch { engine = false; }
        if (!engine) return;  // no engine: stay local-first, no polling, no SSE

        const src = new EventSource("/events");
        src.onmessage = (m) => {
          lastSseAt = performance.now();
          if (arbitrate({ mirrorOk, lastSseAt, now: lastSseAt, pinned: !!pinned }) === "live") {
            try { applyEvent(JSON.parse(m.data), { panel, webSim }); } catch { /* ignore malformed */ }
          }
        };

        async function pollFramebuffer() {
          if (document.hidden) return;
          try {
            const r = await fetch("/api/framebuffer");
            if (r.ok) {
              const { px } = await r.json();
              mirrorOk = true;
              if (arbitrate({ mirrorOk, lastSseAt, now: performance.now(), pinned: !!pinned }) === "mirror") {
                panel.setFrames([framesFromPx(px)], 1e9);  // static mirror frame, refreshed each poll
              }
            } else { mirrorOk = false; }
          } catch { mirrorOk = false; }
        }
        (async function pollLoop() { await pollFramebuffer(); setTimeout(pollLoop, 333); })();
      })();
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — `manifest OK`, `tsc` clean, all `node --test` files green (including the new board tests).

- [ ] **Step 3: Visual verification on the running local server**

The user has a static server running at repo root (per CLAUDE.md: `python -m http.server 8766`). Under a plain static server `/api/framebuffer` 404s, so the page runs as the pure local showcase — exactly the primary path to verify.

Load `http://localhost:8766/studio/board.html` and confirm:
1. The big hero panel renders an animation immediately with bloom (no blank/black).
2. Status reads `○ ambient · <name>`; after ~7s the name changes and a different animation plays (auto-cycle, no immediate repeat).
3. The pin strip lists the library; clicking an item pins it (button highlights, status → `◉ pinned · <name>`, panel holds it); `↻ resume cycle` returns to `○ ambient`.
4. Browser console is clean — **no repeated `/api/framebuffer` 404 spam** (the engine probe must have suppressed polling). One probe request is fine.

Use the available browser tooling (Playwright MCP / Chrome) to screenshot the panel for the critic review. Live MIRROR/SSE paths require the node engine + a board/session and are validated separately at the `.mcpb` checkpoint (not in this task).

- [ ] **Step 4: Commit**

```bash
git add studio/board.html
git commit -m "feat(board): local-first showcase — ambient cycle, pin, engine-gated mirror"
```

---

## Definition of Done / Visual Review

- `npm test` green.
- Board-less `board.html` (static server) auto-cycles the scenic showcase smoothly at full rAF rate, no poll-ceiling choppiness, no 404 spam.
- Click-to-pin reaches the whole library; resume returns to ambient.
- The MIRROR > LIVE > AMBIENT precedence + ~25s live decay are implemented (pure, unit-tested); live/mirror engage only behind the engine probe.
- **User taste gate:** the user reviews the running page (the ambient feel, dwell time, the showcase curation in `studio/showcase.js`) and signs off. Tunable knobs called out for them: `DWELL_MS` (board.html), `DECAY_MS` (board.js), and the `SHOWCASE` list (showcase.js).

---

## Self-Review (done at write time)

- **Spec coverage:** §3 state machine → Task 2 (`arbitrate`, `DECAY_MS`) + Task 3 wiring. §4 ambient playlist + curated showcase → Task 1 (`SHOWCASE`, `buildPlaylists`). §5 interaction/status → Task 3 (pin strip, status pill, reduced-motion). §6 hi-res scaling → Task 3 (720² canvas). §7 architecture/reuse/tests → Tasks 1–3 file map. The static-host engine-probe (insight in §7 wiring) is covered by `isEngineResponse` (Task 2) + the probe in Task 3.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `Item = {name, kind, entry}` used identically in Task 1 (`buildPlaylists`) and Task 3 (`playItem`, pin strip). `arbitrate`/`nextIndex`/`isEngineResponse`/`DECAY_MS` signatures match between Task 2 and Task 3 call sites. All `performance.now()` timebase, consistent.
