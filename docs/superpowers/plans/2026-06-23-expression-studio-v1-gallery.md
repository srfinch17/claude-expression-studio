# Expression Studio v1 (Gallery + Desk Sim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, web-only Expression Studio Gallery that shows the entire animation library — canned + saved + firmware simulations — animating with the real bloom renderer, grouped by rotation with orphans flagged, plus a shared desk-companion component, all on one shared render core that the landing page also consumes.

**Architecture:** Extract the bloom renderer + expression logic out of `site/index.html` into a `shared/` ES-module core. A Node build step emits a static `studio/gallery-data.json` manifest (canned from the compiled MCP module + saved JSON files + a firmware-sim registry). `studio/index.html` renders the manifest into a grouped grid using the shared core; `site/index.html` is refactored to import the same core. Seven firmware animations are ported to JS `(frame)→pixels` steppers. No backend, no bundler, no framework.

**Tech Stack:** Vanilla ES modules (browser-native `import`), HTML5 Canvas, Node 18+ (`node:test`, `node:fs`) for build + unit tests, the existing compiled `mcp_server/dist/expressions.js` for canned data. Served locally with `python -m http.server` from the repo root.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-23-expression-studio-design.md`. Every task implicitly includes these.
- **No native modules, no new runtime dependencies.** Built-in Node + browser APIs only. (Protects the clean `.mcpb`.)
- **No bundler / no framework.** Native ES modules with relative imports.
- **One render core.** Neither `site/` nor `studio/` may contain a private copy of the bloom renderer — both import from `shared/`. Success is grep-verified (Task 14).
- **v1 is web-only.** No file under `esp32_matrix_webserver/`, `mcp_server/*.ts` tool code, or `claude-hooks/` may change. (The build script may *read* `mcp_server/dist` and `mcp_server/expressions/`.)
- **Bloom fidelity is the signature** and must not regress: substrate `#060608` + faint unlit dots; lit pixels drawn additively (`globalCompositeOperation='lighter'`) as a radial halo (stops `.85 / .34@0.45 / 0`) + a hot core (channel `+90` clamp, radius `0.34·cell`); per-frame average lit color × `1.1` pushed to a CSS `--glow` var on the device element. Respect `prefers-reduced-motion` (draw one frame, no loop).
- **Orphan truth:** given current wiring, the orphan set is exactly `{claude-idle, idea}`. A test must assert this and fail if it drifts.
- **Firmware ports are copy-not-move:** read the named `anim_*.ino` as the source of truth; never modify it.
- **Colors:** mascot orange `#ff5008`. Render at full brightness (previews are full-strength; board brightness is not simulated).
- Commit after each task with a `feat:`/`test:`/`chore:` message.

---

## File Structure

```
shared/
  package.json        # {"type":"module"} so Node treats shared/*.js as ESM
  expressions.js      # PURE: hexRGB, resolveFrame, resolveExpression
  expressions.test.js # node:test
  catalog.js          # PURE: classifyExpression, buildCatalog (rotation/orphan map)
  catalog.test.js     # node:test (asserts orphans == {claude-idle, idea})
  render.js           # Panel: bloom canvas renderer (frames | stepper | generator)
  firmware-sims.js    # FIRMWARE_SIMS registry: claudesweep, frostbite, fire,
                      #   matrix_rain, snow, fireworks, dancefloor → (frame)→pixels
  firmware-sims.test.js # node:test (in-bounds frame-shape for every sim)
studio/
  index.html          # Gallery screen (imports ../shared/*)
  gallery.js          # builds grouped grid from gallery-data.json, drives render loop
  gallery-data.json   # GENERATED — do not hand-edit (gitignored or committed; see Task 11)
site/
  index.html          # MODIFIED — imports ../shared/*, adds "Open Studio →" CTA
scripts/
  build-gallery-data.mjs       # emits studio/gallery-data.json
  build-gallery-data.test.js   # node:test (manifest shape)
```

Delete `site/_preview-library.html` (scratch) in Task 14.

**Panel source model (used across tasks):** `shared/render.js` `Panel` accepts three content kinds, exactly one active at a time:
- `setFrames(frames, frameMs)` — `frames` is `Array<Frame>`, `Frame = Array<{x,y,r,g,b}>` (baked/canned/saved expressions).
- `setStepper(stepFn, frameMs)` — `stepFn()` returns one `Frame` and advances internal state (firmware sims).
- `setGenerator(genFn)` — `genFn(nowMs)` returns one `Frame` (time-based data-viz; used by `site/` only).

---

## Task 1: Shared pure expression logic (`shared/expressions.js`)

**Files:**
- Create: `shared/package.json`
- Create: `shared/expressions.js`
- Test: `shared/expressions.test.js`

**Interfaces:**
- Produces:
  - `hexRGB(hex: string) → [number, number, number]`
  - `resolveFrame(rows: string[], colors: Record<string,string>) → Array<{x:number,y:number,r:number,g:number,b:number}>`
  - `resolveExpression(json: {frames: string[][], colors: Record<string,string>, frame_ms?: number, loop?: number, description?: string}) → {frame_ms:number, loop:number, description:string, frames: Array<Array<{x,y,r,g,b}>>}`

- [ ] **Step 1: Write `shared/package.json`**

```json
{ "type": "module" }
```

- [ ] **Step 2: Write the failing test** — `shared/expressions.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { hexRGB, resolveFrame, resolveExpression } from "./expressions.js";

test("hexRGB parses #rrggbb to [r,g,b]", () => {
  assert.deepEqual(hexRGB("#ff5008"), [255, 80, 8]);
  assert.deepEqual(hexRGB("000000"), [0, 0, 0]);
});

test("resolveFrame skips '.' and unmapped chars, emits lit pixels with coords", () => {
  const rows = [
    "R.......",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    ".......X", // X not in colors → skipped
  ];
  const px = resolveFrame(rows, { R: "#ff5008" });
  assert.equal(px.length, 1);
  assert.deepEqual(px[0], { x: 0, y: 0, r: 255, g: 80, b: 8 });
});

test("resolveExpression resolves every frame and defaults frame_ms/loop", () => {
  const e = resolveExpression({
    frames: [["R.......","........","........","........","........","........","........","........"]],
    colors: { R: "#ffffff" },
  });
  assert.equal(e.frame_ms, 150);
  assert.equal(e.loop, 0);
  assert.equal(e.frames.length, 1);
  assert.deepEqual(e.frames[0][0], { x: 0, y: 0, r: 255, g: 255, b: 255 });
});
```

- [ ] **Step 3: Run it, expect FAIL**

Run: `node --test shared/expressions.test.js`
Expected: FAIL — `Cannot find module './expressions.js'` / export missing.

- [ ] **Step 4: Implement `shared/expressions.js`**

```js
// Pure expression resolution — char-art frames → flat lit-pixel arrays.
// No DOM. Shared by the canvas renderer, the gallery, and Node tests.

export function hexRGB(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// rows: array of 8 strings (8 chars each). colors: {char: "#rrggbb"}.
// '.' = off. A char with no color entry is skipped (treated as off).
export function resolveFrame(rows, colors) {
  const px = [];
  for (let y = 0; y < 8; y++) {
    const row = rows[y] || "";
    for (let x = 0; x < 8; x++) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      const c = colors[ch];
      if (!c) continue;
      const [r, g, b] = hexRGB(c);
      px.push({ x, y, r, g, b });
    }
  }
  return px;
}

export function resolveExpression(json) {
  const colors = json.colors || {};
  return {
    frame_ms: json.frame_ms || 150,
    loop: json.loop ?? 0,
    description: json.description || "",
    frames: (json.frames || []).map((rows) => resolveFrame(rows, colors)),
  };
}
```

- [ ] **Step 5: Run it, expect PASS**

Run: `node --test shared/expressions.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/package.json shared/expressions.js shared/expressions.test.js
git commit -m "feat(studio): shared pure expression resolve core"
```

---

## Task 2: Rotation/orphan catalog (`shared/catalog.js`)

**Files:**
- Create: `shared/catalog.js`
- Test: `shared/catalog.test.js`

**Interfaces:**
- Produces:
  - `WAIT_PREFIX = "wait-"`, `ASK_PREFIX = "ask-"`
  - `classifyExpression(name: string, ctx: {waitNames: Set<string>, boredNames: Set<string>}) → "wait"|"ask"|"bored"|"orphan"`
  - `buildCatalog(names: string[], ctx) → {wait:string[], ask:string[], bored:string[], orphan:string[]}`

**Context for the implementer:** the orphan audit found exactly two saved expressions wired into no rotation: `claude-idle` and `idea`. Classification rules, in order: name starts with `ask-` → `ask`; name starts with `wait-` OR is in `ctx.waitNames` → `wait`; name in `ctx.boredNames` → `bored`; else `orphan`. `ctx.waitNames` is the set of names from `mcp_server/wait-weights.json` keys plus the built-ins `working` and `claudesweep`. `ctx.boredNames` is the basenames (no `.json`) in `claude-hooks/bored_animations/`.

- [ ] **Step 1: Write the failing test** — `shared/catalog.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExpression, buildCatalog } from "./catalog.js";

const ctx = {
  waitNames: new Set(["working", "claudesweep", "wait-claude", "wait-rainbow"]),
  boredNames: new Set(["bored-eyes", "bounce", "dizzy", "pacman", "shooting-star", "wink", "yawn"]),
};

test("classifyExpression routes by prefix then membership", () => {
  assert.equal(classifyExpression("ask-question", ctx), "ask");
  assert.equal(classifyExpression("wait-rainbow", ctx), "wait");
  assert.equal(classifyExpression("dizzy", ctx), "bored");
  assert.equal(classifyExpression("claude-idle", ctx), "orphan");
  assert.equal(classifyExpression("idea", ctx), "orphan");
});

test("buildCatalog groups names and isolates the two known orphans", () => {
  const names = [
    "ask-question", "wait-claude", "wait-rainbow", "dizzy", "pacman",
    "claude-idle", "idea",
  ];
  const cat = buildCatalog(names, ctx);
  assert.deepEqual(cat.orphan.sort(), ["claude-idle", "idea"]);
  assert.ok(cat.wait.includes("wait-claude"));
  assert.ok(cat.bored.includes("dizzy"));
  assert.ok(cat.ask.includes("ask-question"));
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test shared/catalog.test.js`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `shared/catalog.js`**

```js
// Maps an expression name to the auto-rotation that owns it (or "orphan").
// Pure + data-driven so it stays honest: feed it the real wait/bored name sets.

export const WAIT_PREFIX = "wait-";
export const ASK_PREFIX = "ask-";

export function classifyExpression(name, ctx) {
  if (name.startsWith(ASK_PREFIX)) return "ask";
  if (name.startsWith(WAIT_PREFIX) || ctx.waitNames.has(name)) return "wait";
  if (ctx.boredNames.has(name)) return "bored";
  return "orphan";
}

export function buildCatalog(names, ctx) {
  const cat = { wait: [], ask: [], bored: [], orphan: [] };
  for (const name of names) cat[classifyExpression(name, ctx)].push(name);
  return cat;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test shared/catalog.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/catalog.js shared/catalog.test.js
git commit -m "feat(studio): rotation/orphan classification core"
```

---

## Task 3: Bloom canvas renderer (`shared/render.js`)

**Files:**
- Create: `shared/render.js`

**Interfaces:**
- Consumes: nothing from `shared/` (operates on already-resolved `Frame` arrays).
- Produces: `class Panel`
  - `new Panel(canvas: HTMLCanvasElement, opts?: {device?: HTMLElement})`
  - `setFrames(frames: Array<Frame>, frameMs: number): void`
  - `setStepper(stepFn: () => Frame, frameMs: number): void`
  - `setGenerator(genFn: (nowMs:number) => Frame): void`
  - `tick(dtMs: number, nowMs: number): void` — advances the active source and redraws when the frame changes (frames/stepper) or every call (generator)
  - `draw(nowMs: number): void`
  - where `Frame = Array<{x,y,r,g,b}>`

**Context:** this is the bloom engine lifted verbatim (behavior-identical) from `site/index.html` (the `Panel` class, lines ~498-546), generalized to the three source kinds. Do not change the visual math (see Global Constraints bloom block).

- [ ] **Step 1: Implement `shared/render.js`**

```js
// Bloom canvas renderer. Draws a Frame (array of {x,y,r,g,b}) onto a 1:1 canvas
// as an additive halo + hot core over a dark substrate, and bleeds the average
// lit color onto an optional device element via the CSS --glow var.
// Visual math is identical to the original site/index.html Panel.

export class Panel {
  constructor(canvas, { device } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.device = device || null;
    this.S = canvas.width;
    this.cell = this.S / 8;
    this.acc = 0;
    this.fi = 0;
    this.frames = null;   // Array<Frame>
    this.frameMs = 150;
    this.stepFn = null;   // () => Frame
    this.genFn = null;    // (now) => Frame
    this._cur = [];       // current Frame for stepper mode
    this._dirty = true;
  }

  _reset() {
    this.frames = null; this.stepFn = null; this.genFn = null;
    this.fi = 0; this.acc = 0; this._cur = []; this._dirty = true;
  }

  setFrames(frames, frameMs) {
    this._reset();
    this.frames = frames; this.frameMs = frameMs || 150;
    this.draw(0);
  }

  setStepper(stepFn, frameMs) {
    this._reset();
    this.stepFn = stepFn; this.frameMs = frameMs || 150;
    this._cur = stepFn();
    this.draw(0);
  }

  setGenerator(genFn) {
    this._reset();
    this.genFn = genFn;
    this.draw(0);
  }

  tick(dt, now) {
    if (this.genFn) { this.draw(now); return; }
    if (this.frames) {
      this.acc += dt;
      while (this.acc >= this.frameMs) {
        this.acc -= this.frameMs;
        this.fi = (this.fi + 1) % this.frames.length;
        this._dirty = true;
      }
    } else if (this.stepFn) {
      this.acc += dt;
      while (this.acc >= this.frameMs) {
        this.acc -= this.frameMs;
        this._cur = this.stepFn();
        this._dirty = true;
      }
    }
    if (this._dirty) { this._dirty = false; this.draw(now); }
  }

  pixels(now) {
    if (this.genFn) return this.genFn(now);
    if (this.stepFn) return this._cur;
    if (this.frames) return this.frames[this.fi] || [];
    return [];
  }

  draw(now) {
    const ctx = this.ctx, S = this.S, c = this.cell, px = this.pixels(now);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#060608"; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "rgba(255,255,255,.022)";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.beginPath(); ctx.arc(x * c + c / 2, y * c + c / 2, c * 0.13, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    let R = 0, G = 0, B = 0, n = 0;
    for (const p of px) {
      const cx = p.x * c + c / 2, cy = p.y * c + c / 2;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.92);
      halo.addColorStop(0, `rgba(${p.r},${p.g},${p.b},.85)`);
      halo.addColorStop(.45, `rgba(${p.r},${p.g},${p.b},.34)`);
      halo.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
      ctx.fillStyle = halo; ctx.fillRect(cx - c, cy - c, c * 2, c * 2);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.34);
      core.addColorStop(0, `rgba(${Math.min(255, p.r + 90)},${Math.min(255, p.g + 90)},${Math.min(255, p.b + 90)},1)`);
      core.addColorStop(1, `rgba(${p.r},${p.g},${p.b},.15)`);
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, c * 0.34, 0, 7); ctx.fill();
      R += p.r; G += p.g; B += p.b; n++;
    }
    ctx.globalCompositeOperation = "source-over";
    if (this.device && n) {
      const k = 1.1;
      this.device.style.setProperty("--glow",
        `rgba(${Math.min(255, 0 | R / n * k)},${Math.min(255, 0 | G / n * k)},${Math.min(255, 0 | B / n * k)},.55)`);
    }
  }
}
```

- [ ] **Step 2: Controller smoke-check (no automated DOM test in v1)**

This is canvas/DOM code; it is verified by the Gallery smoke check in Task 12 (load page, zero console errors, non-blank canvases). No unit test here — do not fabricate one. Note in the commit that render.js is covered by Task 12's smoke check.

- [ ] **Step 3: Commit**

```bash
git add shared/render.js
git commit -m "feat(studio): shared bloom canvas renderer (Panel)"
```

---

## Task 4: Firmware-sim registry + `claudesweep` port (exemplar)

**Files:**
- Create: `shared/firmware-sims.js`
- Test: `shared/firmware-sims.test.js`

**Interfaces:**
- Produces:
  - `FIRMWARE_SIMS: Record<string, (opts?:object) => Sim>` where `Sim = { frame_ms:number, frame(): Frame }` and `Frame = Array<{x,y,r,g,b}>`.
  - Each factory returns a fresh stateful sim; `frame()` advances one frame and returns lit pixels (in-bounds 0..7).
  - This task creates the registry with **only** `claudesweep`; Tasks 5-10 add the others to the same object.

**Source of truth:** `esp32_matrix_webserver/anim_claudesweep.ino` (read-only). Behavior: 28-pixel clockwise perimeter ring, per-pixel brightness decays ×(200/256) each frame toward a floor of 88, head advances 1 step/frame and is set to 255; ring color = amber `#ffb000` default scaled by brightness (never below floor). Mascot (orange `#ff5008`) drawn in the 6×6 interior (cols 1-6, rows 1-6) with a 1px bob toggling every 14 frames and an eye-blink (eyes closed) for 3 of every 40 frames. `frame_ms` ≈ 90.

- [ ] **Step 1: Write the failing test** — `shared/firmware-sims.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRMWARE_SIMS } from "./firmware-sims.js";

function assertInBounds(px) {
  for (const p of px) {
    assert.ok(p.x >= 0 && p.x < 8 && p.y >= 0 && p.y < 8, `pixel in bounds: ${JSON.stringify(p)}`);
    for (const ch of ["r", "g", "b"]) assert.ok(p[ch] >= 0 && p[ch] <= 255, `${ch} 0..255`);
  }
}

test("claudesweep sim yields in-bounds frames across a full cycle", () => {
  const sim = FIRMWARE_SIMS.claudesweep();
  assert.equal(typeof sim.frame_ms, "number");
  for (let i = 0; i < 60; i++) assertInBounds(sim.frame());
});

test("claudesweep ring is always lit (>= ~28 perimeter pixels)", () => {
  const sim = FIRMWARE_SIMS.claudesweep();
  const px = sim.frame();
  assert.ok(px.length >= 28, "ring + mascot pixels present");
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test shared/firmware-sims.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `shared/firmware-sims.js` with `claudesweep`**

```js
// JS simulations of the board's generative firmware animations. Each is a
// faithful port of the matching esp32_matrix_webserver/anim_*.ino (read-only
// source of truth). A factory returns a stateful sim: frame() advances one
// frame and returns lit pixels. Validated by eye against the board.

const scale8 = (v, s) => (v * s) >> 8;
const nscale8 = ([r, g, b], s) => [scale8(r, s), scale8(g, s), scale8(b, s)];

// ---- claudesweep (port of anim_claudesweep.ino) ----
const SWEEP_PERIM = [
  [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],
  [7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[7,7],
  [6,7],[5,7],[4,7],[3,7],[2,7],[1,7],[0,7],
  [0,6],[0,5],[0,4],[0,3],[0,2],[0,1],
];
const SWEEP_FLOOR = 88;
const SWEEP_DECAY = 200;
const CLAUDE_ORANGE = [255, 80, 8];
const CLAUDE6_OPEN  = [".####.","######","#.##.#","######",".#..#."];
const CLAUDE6_BLINK = [".####.","######","######","######",".#..#."];

function makeClaudeSweep(opts = {}) {
  const ring = (opts.color ? hexToRGB(opts.color) : [255, 176, 0]); // #ffb000 amber
  const bri = new Array(28).fill(SWEEP_FLOOR);
  let head = 0, fc = 0;
  return {
    frame_ms: opts.frame_ms || 90,
    frame() {
      const px = [];
      for (let i = 0; i < 28; i++) bri[i] = scale8(bri[i], SWEEP_DECAY);
      head = (head + 1) % 28;
      bri[head] = 255;
      for (let i = 0; i < 28; i++) {
        const b = bri[i] > SWEEP_FLOOR ? bri[i] : SWEEP_FLOOR;
        const [r, g, bl] = nscale8(ring, b);
        px.push({ x: SWEEP_PERIM[i][0], y: SWEEP_PERIM[i][1], r, g, b: bl });
      }
      const bob = Math.floor(fc / 14) % 2;
      const blink = (fc % 40) < 3;
      const spr = blink ? CLAUDE6_BLINK : CLAUDE6_OPEN;
      for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 6; sx++) {
        if (spr[sy][sx] === "#") {
          px.push({ x: sx + 1, y: sy + 1 + bob, r: CLAUDE_ORANGE[0], g: CLAUDE_ORANGE[1], b: CLAUDE_ORANGE[2] });
        }
      }
      fc++;
      return px;
    },
  };
}

function hexToRGB(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

export const FIRMWARE_SIMS = {
  claudesweep: makeClaudeSweep,
};
```

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test shared/firmware-sims.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Controller visual check.** Wire `claudesweep` into a throwaway `studio/index.html` panel later (Task 12) and eyeball against the board's real `claudesweep`. For now the automated gate is the in-bounds test.

- [ ] **Step 6: Commit**

```bash
git add shared/firmware-sims.js shared/firmware-sims.test.js
git commit -m "feat(studio): firmware-sim registry + claudesweep port"
```

---

## Task 5: `frostbite` port (exemplar #2)

**Files:**
- Modify: `shared/firmware-sims.js` (add `frostbite` to `FIRMWARE_SIMS`)
- Modify: `shared/firmware-sims.test.js` (add in-bounds case)

**Interfaces:**
- Consumes/Produces: same `Sim` shape as Task 4. Adds `FIRMWARE_SIMS.frostbite`.

**Source of truth:** `esp32_matrix_webserver/anim_frostbite.ino`. Behavior: all 64 pixels lit. Per-pixel mist brightness drifts ±1/frame between `lo = max(8, mistMax>>1)` and `mistMax` (default `mistMax = 80`), with ~3% chance/frame to flip direction; color = `#66ccff` scaled by per-pixel brightness. Up to 8 concurrent sparkles spawn at ~`sparkRate`% (default 20) chance/frame, each a sine-bell fade over 40 phases at full color. Use a seeded/`Math.random` RNG. `frame_ms` ≈ 60.

- [ ] **Step 1: Add the failing test case** to `shared/firmware-sims.test.js`

```js
test("frostbite sim yields 64 in-bounds mist pixels every frame", () => {
  const sim = FIRMWARE_SIMS.frostbite();
  for (let i = 0; i < 50; i++) {
    const px = sim.frame();
    assertInBounds(px);
    assert.ok(px.length >= 64, "all 64 mist pixels lit");
  }
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `node --test shared/firmware-sims.test.js`
Expected: FAIL — `FIRMWARE_SIMS.frostbite is not a function`.

- [ ] **Step 3: Implement `frostbite`** in `shared/firmware-sims.js` (add factory, register it). Port faithfully from the source:

```js
function makeFrostbite(opts = {}) {
  const color = opts.color ? hexToRGB(opts.color) : [102, 204, 255]; // #66ccff
  const mistMax = (opts.mist ?? 40) * 2;            // matches firmware (×2), default 80
  const sparkRate = opts.sparkle ?? 20;
  const lo = Math.max(8, mistMax >> 1);
  const bri = new Array(64), dir = new Array(64);
  for (let i = 0; i < 64; i++) { bri[i] = lo + Math.floor(Math.random() * (mistMax - lo + 1)); dir[i] = Math.random() < 0.5 ? 1 : -1; }
  const sparks = Array.from({ length: 8 }, () => ({ active: false, idx: 0, phase: 0 }));
  return {
    frame_ms: opts.frame_ms || 60,
    frame() {
      const px = [];
      for (let i = 0; i < 64; i++) {
        if (Math.floor(Math.random() * 30) === 0) dir[i] = -dir[i];
        let next = bri[i] + dir[i];
        if (next >= mistMax) { bri[i] = mistMax; dir[i] = -1; }
        else if (next <= lo) { bri[i] = lo; dir[i] = 1; }
        else bri[i] = next;
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const [r, g, b] = nscale8(color, bri[y * 8 + x]);
        px.push({ x, y, r, g, b });
      }
      if (Math.random() * 100 < sparkRate) {
        const s = sparks.find((s) => !s.active);
        if (s) { s.active = true; s.idx = Math.floor(Math.random() * 64); s.phase = 0; }
      }
      for (const s of sparks) {
        if (!s.active) continue;
        const briS = Math.round(Math.sin(s.phase * Math.PI / 39) * 255);
        if (briS > 0) {
          const [r, g, b] = nscale8(color, briS);
          px.push({ x: s.idx % 8, y: (s.idx / 8) | 0, r, g, b });
        }
        if (++s.phase >= 40) s.active = false;
      }
      return px;
    },
  };
}
```
Register: `frostbite: makeFrostbite` in `FIRMWARE_SIMS`.

- [ ] **Step 4: Run it, expect PASS**

Run: `node --test shared/firmware-sims.test.js`
Expected: PASS (3+ tests).

- [ ] **Step 5: Commit**

```bash
git add shared/firmware-sims.js shared/firmware-sims.test.js
git commit -m "feat(studio): frostbite firmware-sim port"
```

---

## Tasks 6-10: Remaining firmware ports (`fire`, `matrix_rain`, `snow`, `fireworks`, `dancefloor`)

**Each task follows the identical pattern established by Tasks 4-5:**
1. Add an in-bounds frame-shape test case to `shared/firmware-sims.test.js` (loop ≥50 frames, assert every pixel `x,y ∈ 0..7` and channels `0..255`, plus the per-anim invariant noted below).
2. Run it, expect FAIL.
3. Implement `make<Name>(opts)` in `shared/firmware-sims.js` as a faithful port of the named source file, returning `{frame_ms, frame()}`; register it in `FIRMWARE_SIMS`.
4. Run it, expect PASS.
5. **Controller visual check against the board** (these are perceptual; the unit test only guards bounds/shape — fidelity is eyeballed).
6. Commit `feat(studio): <name> firmware-sim port`.

**Use the helper utilities already in the file** (`scale8`, `nscale8`, `hexToRGB`). Add small shared helpers (e.g. an `XY` index, an HSV→RGB if a port needs it) at the top of the file, not per-factory.

### Task 6: `fire`
- **Source:** `esp32_matrix_webserver/anim_fire.ino`. **Params** (`api_handlers.ino:167-178`): `palette` ∈ {classic, blue, green, purple} (default classic), `intensity` 1-10 (default 6), `tendrils` 0-10, `sparks` 0-10. Classic = the Fire2012-style heat map (per-column heat array, cool/diffuse/ignite, map heat→palette color). `frame_ms` ≈ 30-50.
- **Invariant test:** frames are in-bounds; not all-black after 10 warm-up frames (`px.length > 0`).
- **Default opts for the gallery:** `{ palette: "classic", intensity: 6 }`.

### Task 7: `matrix_rain`
- **Source:** `esp32_matrix_webserver/anim_matrix.ino` (+ `initMatrixDrops`). **Params** (`api_handlers.ino:210-217`): `theme` ∈ {classic, blue, red, purple}. Classic: trail `rgb(0,180,20)`, head `white`. Per-column falling drops with a fading trail; drops start staggered. `frame_ms` from `speed` (default ~60).
- **Invariant test:** in-bounds; at least one lit pixel after warm-up.
- **Default opts:** `{ theme: "classic", frame_ms: 60 }`.

### Task 8: `snow`
- **Source:** `esp32_matrix_webserver/anim_snow.ino` (+ `initSnow`, `SNOW_PALETTE`). **Params** (`api_handlers.ino:219-229`): `confetti` bool (default false → single random palette hue tints flakes + a dim floor bank `rgb(210,220,255)`). Flakes fall and accumulate on a bottom floor. `frame_ms` from `speed` (default ~110). For a deterministic gallery look, pass a fixed `flakeColor` opt (e.g. `#dCE6FF`).
- **Invariant test:** in-bounds; floor bank present (bottom-row pixels lit) after accumulation frames.
- **Default opts:** `{ frame_ms: 110, flakeColor: "#dce6ff" }`.

### Task 9: `fireworks`
- **Source:** `esp32_matrix_webserver/anim_fireworks.ino`. **Params** (`api_handlers.ino:376-382`): `color1/2/3` (defaults `#ff0050`, `#00e0ff`, `#ffd000`). A shell launches up a column, explodes into a colored burst that fades. `frame_ms` from `speed`.
- **Invariant test:** in-bounds; over a 100-frame window at least one frame has ≥3 lit pixels (a burst occurs).
- **Default opts:** `{ color1: "#ff0050", color2: "#00e0ff", color3: "#ffd000" }`.

### Task 10: `dancefloor`
- **Source:** `esp32_matrix_webserver/anim_dance_floor.ino`. **Params** (`api_handlers.ino:360-364`): `palette` 0-63 (default 0), `hold`. A grid of colored tiles cycling through a palette (disco floor). `frame_ms` moderate.
- **Invariant test:** in-bounds; many pixels lit (tiled floor, `px.length >= 16`).
- **Default opts:** `{ palette: 0, hold: 6 }`.

---

## Task 11: Gallery data build (`scripts/build-gallery-data.mjs`)

**Files:**
- Create: `scripts/build-gallery-data.mjs`
- Create: `scripts/build-gallery-data.test.js`
- Generates: `studio/gallery-data.json`

**Interfaces:**
- Produces (exported for testing):
  - `loadCanned(cannedModulePath: string) → Promise<Record<string, Expression>>` — dynamic-imports the compiled MCP module and returns its `CANNED` export.
  - `buildGalleryData({canned, savedDir, waitWeightsPath, boredDir}) → {expressions: Array<Entry>, firmware: string[], groups: {...}}` where `canned` is the map from `loadCanned` and `Entry = {name:string, source:"canned"|"saved", frames:string[][], colors:object, frame_ms:number, loop:number, description:string, group:string}`.
- CLI `main()` awaits `loadCanned` then calls `buildGalleryData` and writes `studio/gallery-data.json`.

**Context:** the gallery merges expression DATA from **three** sources, de-duped by name (priority saved > canned > bored): canned = the `CANNED` default export of the **compiled** `mcp_server/dist/expressions.js` (build it first if `dist` is stale: `cd mcp_server && npx tsc --project tsconfig.json`); saved = `mcp_server/expressions/*.json`; bored = `claude-hooks/bored_animations/*.json` (the authoritative bored-pool folder — included as a source so bored-only animations like `rocket` are not dropped). `firmware` is the registry key list `["claudesweep","frostbite","fire","matrix_rain","snow","fireworks","dancefloor"]` (mirrored from `shared/firmware-sims.js` — keep in sync). Each unique name is classified by ROTATION ROLE via `shared/catalog.js` `classifyExpression(name, {waitNames, boredNames})` (priority ask > wait > bored); a canned name in no rotation becomes group `"canned"`, a non-canned (saved) name in no rotation is `"orphan"` — so the orphan gate is exactly the saved-and-unwired set `{claude-idle, idea}`, while dual-members (`working`→wait, `heart`/`party`/`smiley`→bored) land in their rotation, not their data tier. `waitNames` = keys of `mcp_server/wait-weights.json`'s `weights` ∪ `{working, claudesweep}`. `boredNames` = basenames in `claude-hooks/bored_animations/`.

- [ ] **Step 1: Write the failing test** — `scripts/build-gallery-data.test.js`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGalleryData, loadCanned } from "./build-gallery-data.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("buildGalleryData merges canned + saved, classifies, lists firmware", async () => {
  const canned = await loadCanned(join(ROOT, "mcp_server/dist/expressions.js"));
  const data = buildGalleryData({
    canned,
    savedDir: join(ROOT, "mcp_server/expressions"),
    waitWeightsPath: join(ROOT, "mcp_server/wait-weights.json"),
    boredDir: join(ROOT, "claude-hooks/bored_animations"),
  });
  const groupOf = (n) => data.expressions.find((e) => e.name === n)?.group;
  assert.ok(data.firmware.includes("claudesweep") && data.firmware.length === 7, "7 firmware sims listed");

  // The orphan gate: exactly the saved-and-unwired set.
  const orphans = data.expressions.filter((e) => e.group === "orphan").map((e) => e.name).sort();
  assert.deepEqual(orphans, ["claude-idle", "idea"], "exactly the two known orphans");

  // Rotation role wins over data-origin tier for dual-members:
  assert.equal(groupOf("done"), "canned", "pure on-demand glyph → canned");
  assert.equal(groupOf("heart"), "bored", "canned+bored → bored (rotation wins)");
  assert.equal(groupOf("working"), "wait", "canned+wait → wait (rotation wins)");
  // Completeness: a bored-only animation (no canned/saved counterpart) is not dropped.
  assert.equal(groupOf("rocket"), "bored", "bored-only animation present and grouped bored");

  // Every entry carries frames + a valid group.
  for (const e of data.expressions) {
    assert.ok(Array.isArray(e.frames) && e.frames.length > 0, `${e.name} has frames`);
    assert.ok(["wait","ask","bored","orphan","canned"].includes(e.group), `${e.name} grouped`);
  }
});
```

- [ ] **Step 2: Run it, expect FAIL** (module missing). First ensure `mcp_server/dist` exists: `cd mcp_server && npx tsc --project tsconfig.json && cd ..`

Run: `node --test scripts/build-gallery-data.test.js`
Expected: FAIL — cannot import `build-gallery-data.mjs`.

- [ ] **Step 3: Implement `scripts/build-gallery-data.mjs`**

```js
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyExpression } from "../shared/catalog.js";

const FIRMWARE = ["claudesweep","frostbite","fire","matrix_rain","snow","fireworks","dancefloor"];

// Dynamic-import the COMPILED MCP module so canned data has a single source of
// truth (never re-parse the .ts). Async; main() and tests await this first.
export async function loadCanned(cannedModulePath) {
  const mod = await import(pathToFileURL(cannedModulePath).href);
  return mod.CANNED;
}

// helper: read all *.json in a dir into [name, {source, frames, colors, frame_ms, loop, description}]
function readDir(dir, source) {
  const out = [];
  for (const fn of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(dir, fn), "utf8"));
    out.push([basename(fn, ".json"), { source, frames: j.frames, colors: j.colors,
      frame_ms: j.frame_ms || 150, loop: j.loop ?? 0, description: j.description || "" }]);
  }
  return out;
}

export function buildGalleryData({ canned, savedDir, waitWeightsPath, boredDir }) {
  const waitWeights = JSON.parse(readFileSync(waitWeightsPath, "utf8")).weights || {};
  const waitNames = new Set([...Object.keys(waitWeights), "working", "claudesweep"]);
  const boredNames = new Set(readDir(boredDir, "bored").map(([n]) => n));
  const cannedNames = new Set(Object.keys(canned));

  // Merge expression DATA from all three sources, de-duped by name. Data priority
  // when a name is in multiple sources: saved > canned > bored (set lowest first
  // so higher priority overwrites). bored_animations/ is a real data source so
  // bored-only animations (e.g. `rocket`) are not dropped.
  const byName = new Map();
  for (const [name, data] of readDir(boredDir, "bored")) byName.set(name, data);
  for (const [name, e] of Object.entries(canned)) {
    byName.set(name, { source: "canned", frames: e.frames, colors: e.colors,
      frame_ms: e.frame_ms || 150, loop: e.loop ?? 0, description: e.description || "" });
  }
  for (const [name, data] of readDir(savedDir, "saved")) byName.set(name, data);

  // Classify every unique name by ROTATION ROLE (priority: ask > wait > bored via
  // classifyExpression). A canned name in no rotation → the "canned" on-demand
  // group; a non-canned (saved) name in no rotation → "orphan". So the orphan gate
  // is exactly the saved-and-unwired set {claude-idle, idea}.
  const expressions = [];
  const groups = { wait: [], ask: [], bored: [], canned: [], orphan: [] };
  for (const [name, data] of byName) {
    let group = classifyExpression(name, { waitNames, boredNames });
    if (group === "orphan" && cannedNames.has(name)) group = "canned";
    expressions.push({ name, ...data, group });
    groups[group].push(name);
  }

  return { expressions, firmware: FIRMWARE, groups };
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const canned = await loadCanned(join(root, "mcp_server/dist/expressions.js"));
  const data = buildGalleryData({
    canned,
    savedDir: join(root, "mcp_server/expressions"),
    waitWeightsPath: join(root, "mcp_server/wait-weights.json"),
    boredDir: join(root, "claude-hooks/bored_animations"),
  });
  writeFileSync(join(root, "studio/gallery-data.json"), JSON.stringify(data, null, 2));
  console.log(`gallery-data.json: ${data.expressions.length} expressions, ${data.firmware.length} firmware sims`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

> **Implementer note:** canned data must come from the **compiled** module (`mcp_server/dist/expressions.js`), never a re-parse of the `.ts`. `loadCanned` is async (dynamic `import`); `buildGalleryData` is sync and takes the resolved `canned` map. If `mcp_server/dist` is stale or missing, run `cd mcp_server && npx tsc --project tsconfig.json` first.

- [ ] **Step 4: Implement, run, expect PASS**

Run: `node --test scripts/build-gallery-data.test.js`
Expected: PASS.

- [ ] **Step 5: Generate the manifest + add npm script**

Add to root `package.json` scripts: `"build:gallery": "node scripts/build-gallery-data.mjs"`. Run it:

```bash
npm run build:gallery
```
Expected: writes `studio/gallery-data.json`, logs the counts.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-gallery-data.mjs scripts/build-gallery-data.test.js studio/gallery-data.json package.json
git commit -m "feat(studio): gallery data build (canned + saved + firmware manifest)"
```

---

## Task 12: The Gallery screen (`studio/index.html` + `studio/gallery.js`)

**Files:**
- Create: `studio/index.html`
- Create: `studio/gallery.js`

**Interfaces:**
- Consumes: `../shared/expressions.js` (`resolveExpression`), `../shared/render.js` (`Panel`), `../shared/firmware-sims.js` (`FIRMWARE_SIMS`), and `./gallery-data.json` (fetched).
- Produces: a static page rendering all expressions + firmware sims, grouped by `group`, orphans visually flagged, one shared RAF loop.

**Context:** this productionizes the scratch `site/_preview-library.html`. Groups order: `orphan`, `wait`, `ask`, `bored`, plus a `firmware` group built from `FIRMWARE_SIMS` using each sim's default opts. Per cell: a 128×128 canvas, the name, the description, a group badge; orphan cells get an accent ring. Reuse the visual language from the scratch harness (dark room, IBM Plex Mono labels, the badge colors). Malformed entries render an in-cell error chip and never crash the grid.

- [ ] **Step 1: Implement `studio/gallery.js`**

```js
import { resolveExpression } from "../shared/expressions.js";
import { Panel } from "../shared/render.js";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";

const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;
const GROUP_ORDER = ["orphan", "canned", "wait", "ask", "bored", "firmware"];
const GROUP_TITLE = { orphan: "Orphans — no rotation", canned: "Canned glyphs (matrix_express)", wait: "Wait pool", ask: "Ask-* hooks", bored: "Bored pool", firmware: "Firmware animations" };
const FW_DEFAULTS = {
  claudesweep: {}, frostbite: { mist: 40, sparkle: 20 }, fire: { palette: "classic", intensity: 6 },
  matrix_rain: { theme: "classic", frame_ms: 60 }, snow: { frame_ms: 110, flakeColor: "#dce6ff" },
  fireworks: {}, dancefloor: { palette: 0, hold: 6 },
};

const panels = [];

function cell(grid, name, desc, group) {
  const el = document.createElement("div");
  el.className = "cell" + (group === "orphan" ? " orphan" : "");
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  el.appendChild(cv);
  const nm = document.createElement("div"); nm.className = "name"; nm.textContent = name; el.appendChild(nm);
  const ds = document.createElement("div"); ds.className = "desc"; ds.textContent = desc || ""; el.appendChild(ds);
  const bd = document.createElement("div"); bd.className = "badge " + group; bd.textContent = GROUP_TITLE[group]; el.appendChild(bd);
  grid.appendChild(el);
  return cv;
}

async function build() {
  const root = document.getElementById("root");
  let data;
  try { data = await (await fetch("./gallery-data.json")).json(); }
  catch (e) { root.innerHTML = `<p class="err">Could not load ./gallery-data.json — run <code>npm run build:gallery</code>. (${e.message})</p>`; return; }

  const byGroup = { orphan: [], canned: [], wait: [], ask: [], bored: [], firmware: [] };
  for (const e of data.expressions) (byGroup[e.group] ||= []).push(e);

  for (const group of GROUP_ORDER) {
    const items = group === "firmware" ? data.firmware.map((n) => ({ name: n, firmware: true })) : (byGroup[group] || []);
    if (!items.length) continue;
    const h2 = document.createElement("h2"); h2.innerHTML = `${GROUP_TITLE[group]} <span class="count">${items.length}</span>`; root.appendChild(h2);
    const grid = document.createElement("div"); grid.className = "grid"; root.appendChild(grid);
    for (const it of items) {
      try {
        if (it.firmware) {
          const cv = cell(grid, it.name, "generative firmware animation", "firmware");
          const sim = FIRMWARE_SIMS[it.name](FW_DEFAULTS[it.name] || {});
          const p = new Panel(cv); p.setStepper(() => sim.frame(), sim.frame_ms); panels.push(p);
        } else {
          const cv = cell(grid, it.name, it.description, group);
          const expr = resolveExpression(it);
          const p = new Panel(cv); p.setFrames(expr.frames, expr.frame_ms); panels.push(p);
        }
      } catch (e) {
        const err = document.createElement("div"); err.className = "err"; err.textContent = `${it.name}: ${e.message}`; grid.appendChild(err);
      }
    }
  }

  if (!REDUCE) {
    let last = performance.now();
    (function loop(now) { const dt = now - last; last = now; for (const p of panels) p.tick(dt, now); requestAnimationFrame(loop); })(performance.now());
  }
}
build();
```

- [ ] **Step 2: Implement `studio/index.html`**

Port the styling from `site/_preview-library.html` (dark room, `.grid`/`.cell`/`.orphan`/`.name`/`.desc`/`.badge`/`.err`, IBM Plex Mono). Add `.badge.firmware` AND `.badge.canned` colors (distinct from the existing wait/ask/bored badges). Include `<div id="root"></div>` and `<script type="module" src="./gallery.js"></script>`. Header: a short title + the orphan legend.

- [ ] **Step 3: Controller smoke-check (Playwright MCP)**

```
Start server: python -m http.server 8766  (repo root)
Navigate: http://localhost:8766/studio/index.html
Assert: 0 console errors (favicon 404 is ignorable)
Assert: canvas count == data.expressions.length + data.firmware.length
Screenshot full page → visually confirm bloom + all groups + orphan rings.
```
Fix any console error before proceeding. This step is render.js's coverage gate.

- [ ] **Step 4: Commit**

```bash
git add studio/index.html studio/gallery.js
git commit -m "feat(studio): the Gallery screen (grouped library, live bloom)"
```

---

## Task 13: Desk Sim shared component (`shared/desk-sim.js`)

**Files:**
- Create: `shared/desk-sim.js`
- Modify: `studio/index.html` (mount it) — optional mount point

**Interfaces:**
- Consumes: `./expressions.js`, `./render.js`.
- Produces: `mountDeskSim(opts: {expression: {frames,colors,frame_ms}, dismissible?: boolean}) → {el: HTMLElement, panel: Panel, destroy(): void}` — creates the floating "on your desk" companion (fixed-corner glowing panel with a label and optional dismiss button), starts it on its own RAF, returns handles.

**Context:** lift the floating companion behavior from `site/index.html` (`.companion` styles + the `comp`/`compPanel` wiring, lines ~556-559, ~386-389) into a reusable component so both `site/` and `studio/` use one implementation. The companion's glow bleed uses the Panel `device` option. Default expression: the `claude-idle` mascot (read it from `gallery-data.json` or accept it via `opts.expression`).

- [ ] **Step 1: Implement `shared/desk-sim.js`** — inject a `<div class="desk-sim">` with a canvas + label + dismiss button, instantiate a `Panel(canvas, {device: el})`, `setFrames(resolveExpression(opts.expression).frames, frame_ms)`, run a small RAF, return `{el, panel, destroy}`. Include the `.desk-sim` CSS via an injected `<style>` (so the component is self-contained), ported from the site's `.companion` rules. Respect `prefers-reduced-motion` (draw one frame, no RAF).

- [ ] **Step 2: Mount in `studio/index.html`** — a `<script type="module">` that fetches `gallery-data.json`, finds `claude-idle`, calls `mountDeskSim({expression})`.

- [ ] **Step 3: Controller smoke-check (Playwright MCP)** — navigate to the studio page, assert the `.desk-sim` element exists and its canvas has lit pixels (sample via `browser_evaluate` reading a non-black pixel), screenshot.

- [ ] **Step 4: Commit**

```bash
git add shared/desk-sim.js studio/index.html
git commit -m "feat(studio): reusable desk-companion component"
```

---

## Task 14: Refactor `site/` onto the shared core + cleanup

**Files:**
- Modify: `site/index.html`
- Delete: `site/_preview-library.html`

**Interfaces:**
- Consumes: `../shared/expressions.js`, `../shared/render.js`, `../shared/desk-sim.js`.

**Context:** `site/index.html` currently inlines its own copy of the bloom `Panel`, the `hexRGB`/resolve logic, and the `.companion` companion. Replace those inlined copies with imports from `shared/`. The site keeps its own `EXPR` curated reel data and the data-viz `GEN` (progress/spark) as a `setGenerator` source — those are site-specific and stay. Add an **"Open Studio →"** CTA linking to `../studio/index.html`. Verify the site still renders identically.

- [ ] **Step 1: Convert the site's inline `<script>` to `type="module"`** and import `Panel` from `../shared/render.js`, `resolveExpression`/`hexRGB` from `../shared/expressions.js`, `mountDeskSim` from `../shared/desk-sim.js`. Delete the now-duplicated inline class/functions. Keep `EXPR`, the hero reel, the playground, and `GEN` (wired via `setGenerator`).

- [ ] **Step 2: Replace the inline `.companion` block** with a `mountDeskSim(...)` call (reuse `EXPR.idle`/`claude-idle`).

- [ ] **Step 3: Add the "Open Studio →" CTA** in an appropriate section (near the playground), linking `../studio/index.html`.

- [ ] **Step 4: Delete the scratch harness**

```bash
git rm site/_preview-library.html
```

- [ ] **Step 5: Single-core grep gate (success criterion #4)**

```bash
grep -rn "globalCompositeOperation='lighter'\|globalCompositeOperation=\"lighter\"" site/ studio/
```
Expected: **no matches** in `site/` or `studio/` (the only copy of that bloom line now lives in `shared/render.js`). If a match remains, an inline copy survived — remove it.

- [ ] **Step 6: Controller smoke-check (Playwright MCP)** — navigate `http://localhost:8766/site/index.html`, assert 0 console errors, hero + companion animate, "Open Studio" link present and navigates to the gallery. Screenshot.

- [ ] **Step 7: Commit**

```bash
git add site/index.html
git rm --cached site/_preview-library.html 2>/dev/null; true
git commit -m "refactor(site): consume shared render core; add Open Studio CTA; drop scratch harness"
```

---

## Task 15: Integration verification + orphan regression gate

**Files:**
- Modify: root `package.json` (extend the `test` glob to include `shared/` and the new scripts test)

**Context:** wire the new tests into `npm test` and run the full suite + the success-criteria checks.

- [ ] **Step 1: Extend the root `test` script** to include the shared core and the gallery-data test:

```json
"test": "node --test \"scripts/**/*.test.js\" \"mcp_server/**/*.test.ts\" \"shared/**/*.test.js\""
```
(`scripts/**/*.test.js` already covers `build-gallery-data.test.js`.)

- [ ] **Step 2: Run the whole suite**

Run: `npm test`
Expected: PASS — including `expressions`, `catalog`, `firmware-sims` (all 7 sims), `build-gallery-data`, plus the pre-existing MCP tests.

- [ ] **Step 3: Orphan regression confirmation** — confirm `catalog.test.js` asserts `orphan == {claude-idle, idea}` (Task 2) AND `build-gallery-data.test.js` asserts the same on real data (Task 11). These together are the gate that fails if a new expression is added unwired. No new code; verify both assertions exist.

- [ ] **Step 4: Final controller smoke pass** — with the server running, screenshot `studio/index.html` and `site/index.html`; confirm: all groups present, 7 firmware sims animate, orphans ringed, desk companion glowing on both, no console errors.

- [ ] **Step 5: Regenerate the manifest** (in case expressions changed during the work): `npm run build:gallery`, commit if `studio/gallery-data.json` changed.

- [ ] **Step 6: Commit**

```bash
git add package.json studio/gallery-data.json
git commit -m "test(studio): wire shared-core tests into npm test; integration gate"
```

---

## Self-Review notes (for the implementer/controller)

- **Spec coverage:** §4.1 items 1-5 → Tasks 1-3 (core), 4-10 (sims), 11 (data), 12 (gallery), 13 (desk sim), 14 (site refactor). §4.6 error handling → Task 12 error cells + Task 11 empty-state. §4.7 testing → pure unit tests (Tasks 1,2,4-11) + Playwright smoke (Tasks 12-14). §5 success criteria → Task 14 grep (#4), Tasks 2+11 orphan gate (#5), Task 15 (#1,#2,#3,#6).
- **Deferred correctly:** no studio server, no Workshop/Console/Hook-Factory, no firmware/MCP/hook edits.
- **Task 11 canned data:** sourced from the compiled `mcp_server/dist/expressions.js` via async `loadCanned`; `buildGalleryData` takes the resolved map. Build `dist` first if stale.
- **Firmware-port fidelity:** unit tests guard bounds/shape only; visual fidelity is a controller eyeball against the board per port. This is intentional — a pixel-exact test would just re-encode the port.
```
