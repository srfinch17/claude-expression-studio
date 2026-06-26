# Complete the JS Animation Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 8 remaining decorative C++ animations into `shared/firmware-sims.js` as JS sims so the full library renders natively on every web surface.

**Architecture:** Each animation becomes a `make<Name>(opts)` factory returning `{ frame_ms, frame() }`, registered in `FIRMWARE_SIMS`. The sim emits per-cell RGB; the bloom Panel renderer adds the web beauty (fidelity decision C). The Studio Gallery's firmware list is changed to derive from the registry so new sims appear automatically. A board-free render tool gives the animator/critic loop eyes on generative (continuous-color) sims.

**Tech Stack:** Node ES modules (`shared/*.js`, `node --test`), the existing Python contact-sheet renderer (PIL), the Studio Gallery (browser).

## Global Constraints

- **Sim contract:** `make<Name>(opts = {})` → `{ frame_ms, frame() }`. `frame()` returns an array of lit-pixel objects `{ x, y, r, g, b }` where `x,y ∈ [0,8)` and `r,g,b ∈ [0,255]`. State is closure-captured. Defaults (no opts) must look good — the Gallery and board.html call with none.
- **Fidelity = decision C:** port the C++ `anim_<name>.ino` *logic* faithfully (motion, color intent, timing). The sim emits per-cell RGB and does NOT diverge or fork per surface; the renderer's bloom supplies web richness.
- **Reuse helpers** already in `shared/firmware-sims.js` (`hexToRGB`, `scale8`, `nscale8`, palette tables). Add a new helper next to them only when a port needs one not present (e.g. an HSV→RGB `chsv8`, a `beatsin8` sine).
- **No changes** to: the firmware, the MCP server, the manifest, `shared/firmware-names.js`, the Python hook, `studio/board.html`. (All 8 names already exist in `shared/firmware-names.js`.)
- **`studio/gallery-data.json` is generated** by `npm run build:gallery` — never hand-edit it.
- **Tests:** `node --test` per file; full suite via `npm test` (runs `check-manifest`, `tsc`, then the test globs). Full suite must stay green.
- **`liquid` substitutes the IMU:** the C++ reads the accelerometer; the JS port drives gravity with a slow auto-rotating synthetic vector so it animates autonomously (the fluid physics ports faithfully).
- **Port body is a creative deliverable, not transcription.** For each sim task the port is produced and iterated via the animator-subagent + critic render/critique loop ([[feedback_subagent_visual_loop]]). The C++ reference, the contract, and the complete test code below fully constrain it; the actual port JS is what the loop produces and the user signs off. (Tasks 1–2 are mechanical and carry complete code.)

---

### Task 1: Gallery auto-extension + registry-coverage test

Make the Gallery's firmware list derive from the registry so every future sim appears automatically, and add a test that every registered sim produces a valid stepping frame. (Do this first so sims built in later tasks auto-appear.)

**Files:**
- Modify: `scripts/build-gallery-data.mjs:6`
- Test: `shared/firmware-sims.test.js`

**Interfaces:**
- Consumes: `FIRMWARE_SIMS` (the `Record<string, (opts?) => { frame_ms, frame() }>` map exported from `shared/firmware-sims.js`).
- Produces: nothing new for later tasks (infra). After this task, registering a name in `FIRMWARE_SIMS` is the only step needed for Gallery inclusion.

- [ ] **Step 1: Write the failing test** — append to `shared/firmware-sims.test.js`:

```js
test("every FIRMWARE_SIMS entry is a factory that produces in-bounds frames", () => {
  for (const [name, make] of Object.entries(FIRMWARE_SIMS)) {
    const sim = make();
    assert.equal(typeof sim.frame_ms, "number", `${name}: frame_ms is a number`);
    assert.ok(sim.frame_ms > 0, `${name}: frame_ms > 0`);
    for (let i = 0; i < 30; i++) assertInBounds(sim.frame());
  }
});
```

- [ ] **Step 2: Run it to verify it passes for the current 7** (it documents the contract; it will fail later only if a new sim violates bounds):

Run: `node --test shared/firmware-sims.test.js`
Expected: PASS (7 sims today).

- [ ] **Step 3: Make the Gallery firmware list derive from the registry** — in `scripts/build-gallery-data.mjs`, replace line 6:

```js
const FIRMWARE = ["claudesweep","frostbite","fire","matrix_rain","snow","fireworks","dancefloor"];
```

with (add the import near the other imports at the top of the file):

```js
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
// ...
const FIRMWARE = Object.keys(FIRMWARE_SIMS);
```

- [ ] **Step 4: Regenerate + verify the Gallery data is unchanged for now:**

Run: `npm run build:gallery`
Expected: prints `... 7 firmware sims` (unchanged — only the 7 exist yet); `gallery-data.json` still lists the same 7.

- [ ] **Step 5: Run the full suite:**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-gallery-data.mjs shared/firmware-sims.test.js
git commit -m "feat(gallery): derive firmware list from FIRMWARE_SIMS + registry-coverage test"
```

---

### Task 2: Board-free render tooling for generative sims

The animator/critic loop needs to *see* a sim board-free. `scripts/render-contact-sheet.py` renders limited-palette char-art frames (`frames: [["8 chars" ×8], ...]` + a `colors` map) — it cannot render a continuous-color sim. Add a raw-RGB path to it, plus a JS dumper that steps a sim into that format.

**Files:**
- Create: `scripts/dump-sim-frames.mjs`
- Create: `scripts/dump-sim-frames.test.js`
- Modify: `scripts/render-contact-sheet.py` (add a raw-RGB frame branch)

**Interfaces:**
- Consumes: `FIRMWARE_SIMS` from `shared/firmware-sims.js`.
- Produces: `dump-sim-frames.mjs` writes JSON `{ "frames": ["<384 hex>", ...], "frame_ms": <n>, "raw": true }` where each frame string is 64 `RRGGBB` cells concatenated in row-major order (`i = y*8 + x`), unlit = `"000000"`. `render-contact-sheet.py` renders a frame when it is such a 384-char hex string (no `colors` map needed).

- [ ] **Step 1: Write the failing test** — `scripts/dump-sim-frames.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { dumpSim } from "./dump-sim-frames.mjs";

test("dumpSim produces N raw frames of 64 RRGGBB cells each", () => {
  const out = dumpSim("fire", 5);
  assert.equal(out.raw, true);
  assert.equal(out.frames.length, 5);
  assert.equal(typeof out.frame_ms, "number");
  for (const f of out.frames) {
    assert.equal(typeof f, "string");
    assert.equal(f.length, 64 * 6, "64 cells × 6 hex chars");
    assert.match(f, /^[0-9a-f]+$/i);
  }
});

test("dumpSim places a lit pixel at the right row-major index", () => {
  // claudesweep always lights its perimeter ring → frame is not all-black
  const out = dumpSim("claudesweep", 1);
  assert.notEqual(out.frames[0], "000000".repeat(64), "frame has lit pixels");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/dump-sim-frames.test.js`
Expected: FAIL (`dump-sim-frames.mjs` / `dumpSim` not found).

- [ ] **Step 3: Implement `scripts/dump-sim-frames.mjs`:**

```js
// scripts/dump-sim-frames.mjs — step a firmware sim N frames into the board wire
// format ({frames:["<384 hex>"], frame_ms, raw:true}) so render-contact-sheet.py can
// render a generative (continuous-color) sim board-free for the animator/critic loop.
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hex2 = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");

// Step a sim N frames → { frames: ["<384 hex row-major>"], frame_ms, raw:true }.
export function dumpSim(name, frames = 12, opts = {}) {
  const make = FIRMWARE_SIMS[name];
  if (!make) throw new Error(`unknown sim "${name}" — known: ${Object.keys(FIRMWARE_SIMS).join(", ")}`);
  const sim = make(opts);
  const out = [];
  for (let n = 0; n < frames; n++) {
    const cells = new Array(64).fill("000000");
    for (const p of sim.frame()) {
      if (p.x < 0 || p.x > 7 || p.y < 0 || p.y > 7) continue;
      cells[p.y * 8 + p.x] = hex2(p.r) + hex2(p.g) + hex2(p.b);
    }
    out.push(cells.join(""));
  }
  return { frames: out, frame_ms: sim.frame_ms, raw: true };
}

// CLI: node scripts/dump-sim-frames.mjs <name> [frames] [-o out.json]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , name, framesArg] = process.argv;
  const oIdx = process.argv.indexOf("-o");
  const out = oIdx > -1 ? process.argv[oIdx + 1] : `${name}.frames.json`;
  const data = dumpSim(name, framesArg ? Number(framesArg) : 12);
  writeFileSync(out, JSON.stringify(data));
  console.log(`wrote ${out} (${data.frames.length} frames @ ${data.frame_ms}ms)`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/dump-sim-frames.test.js`
Expected: PASS.

- [ ] **Step 5: Add the raw-RGB branch to `scripts/render-contact-sheet.py`.** The per-frame draw loop reads `frames[i]` as 8 rows of 8 chars and looks each char up in `colors`. Make it also accept a frame that is a single 384-char hex string: decode 64 cells directly. In `render()` (the `for i, fr in enumerate(frames):` loop), before the existing char-art handling, add:

```python
        # Raw-RGB frame: a single 384-char hex string = 64 "RRGGBB" cells, row-major.
        if isinstance(fr, str) and len(fr) == 64 * 6:
            ox, oy = panel_origin(i)
            for idx in range(64):
                h = fr[idx * 6: idx * 6 + 6]
                rgb = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
                cx, cy = idx % 8, idx // 8
                draw.rectangle(
                    [ox + cx * cell, oy + cy * cell, ox + cx * cell + cell - 1, oy + cy * cell + cell - 1],
                    fill=rgb,
                )
            continue
```

(Match the surrounding variable names — `draw`, `cell`, `panel_origin`, `ox/oy` — to whatever the file already uses; read the existing loop first. The raw branch needs no `colors` map, so also guard `validate()`/`colors` access to skip when `data.get("raw")` is set.)

- [ ] **Step 6: Verify the pipeline renders a sim** (manual eyeball — it's a dev image tool):

Run: `node scripts/dump-sim-frames.mjs fire 12 -o /tmp/fire.json && python scripts/render-contact-sheet.py /tmp/fire.json`
Expected: writes `/tmp/fire.sheet.png`; opening it shows 12 fire frames (warm flames climbing), not blank.

- [ ] **Step 7: Run the full suite:**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/dump-sim-frames.mjs scripts/dump-sim-frames.test.js scripts/render-contact-sheet.py
git commit -m "feat(tooling): raw-RGB contact sheets + dump-sim-frames for generative sims"
```

---

## Sim port tasks (3–10)

Each sim task has the same shape. **The port (Step 3) is the animator loop's creative deliverable** — produced from the C++ reference + the contract, iterated via `dump-sim-frames.mjs | render-contact-sheet.py` until it reads right, then eyeballed live in the Gallery. Steps 1–2 (the test) and 4–7 are mechanical.

Common per-task shape:
- **Step 1:** add the sim's test block to `shared/firmware-sims.test.js`.
- **Step 2:** `node --test shared/firmware-sims.test.js` → FAIL (`FIRMWARE_SIMS.<name> is not a function`).
- **Step 3:** write `make<Name>` in `shared/firmware-sims.js` (port the referenced C++), register it in `FIRMWARE_SIMS`. Render a contact sheet, critique against the C++ intent, iterate.
- **Step 4:** `node --test shared/firmware-sims.test.js` → PASS.
- **Step 5:** `npm run build:gallery` → firmware count increments; the sim appears in the Gallery.
- **Step 6:** open the Studio Gallery, confirm it animates correctly (final human eyeball / user sign-off).
- **Step 7:** `npm test` (full suite green), then commit `feat(sims): port <name> to JS`.

The test block and C++ reference for each:

---

### Task 3: `rainbow`

**Reference:** `esp32_matrix_webserver/anim_effects.ino` `runRainbowFrame()`. 8 vertical hue stripes: `hue = rainbowHue + x*32`, color = `CHSV(hue, 255, 200)`; `rainbowHue` advances each frame; every column is a solid vertical stripe of its hue. (Palette mode optional — default to the spectrum.) Needs an HSV→RGB helper (`chsv8(h,s,v)`, FastLED-style 0–255) if not already present — add it next to `hexToRGB`.

- [ ] **Step 1: test block** (append to `shared/firmware-sims.test.js`):

```js
test("rainbow: vertical hue stripes that scroll", () => {
  const sim = FIRMWARE_SIMS.rainbow();
  const a = sim.frame();
  for (let i = 0; i < 5; i++) sim.frame();
  const b = sim.frame();
  assertInBounds(a); assertInBounds(b);
  assert.equal(a.length, 64, "every cell is lit (solid stripes)");
  // A column is one solid hue → all 8 cells in column 0 share a color.
  const col0 = a.filter((p) => p.x === 0);
  assert.ok(col0.every((p) => p.r === col0[0].r && p.g === col0[0].g && p.b === col0[0].b), "column 0 is one hue");
  // Adjacent columns differ (distinct stripes).
  const c4 = a.find((p) => p.x === 4 && p.y === 0);
  assert.ok(c4.r !== col0[0].r || c4.g !== col0[0].g || c4.b !== col0[0].b, "columns differ");
  // It scrolls: column 0's color changes over time.
  const b0 = b.find((p) => p.x === 0 && p.y === 0);
  assert.ok(b0.r !== col0[0].r || b0.g !== col0[0].g || b0.b !== col0[0].b, "hue advances over frames");
});
```

(Steps 2–7 per the common shape above. Default `frame_ms` ~90.)

---

### Task 4: `breathe`

**Reference:** `esp32_matrix_webserver/anim_effects.ino` `runBreatheFrame()`. Fills a solid color, then scales every LED's brightness by a sine (`beatsin8(20, 10, 255)`) so the whole panel pulses in and out. `solidColor` is user-set on the board; for the sim, default to a pleasant color (e.g. cyan `#28c8ff` or the mascot orange `#ff5008`) overridable via `opts.color`. Needs a `beatsin8(bpm, lo, hi, t)` sine helper (add it next to the others) or a plain `Math.sin` phase.

- [ ] **Step 1: test block:**

```js
test("breathe: whole panel pulses brightness over time", () => {
  const sim = FIRMWARE_SIMS.breathe();
  let minSum = Infinity, maxSum = -Infinity;
  for (let i = 0; i < 120; i++) {
    const f = sim.frame();
    assertInBounds(f);
    const sum = f.reduce((a, p) => a + p.r + p.g + p.b, 0);
    minSum = Math.min(minSum, sum); maxSum = Math.max(maxSum, sum);
  }
  assert.ok(maxSum > 0, "panel lights up");
  assert.ok(maxSum - minSum > maxSum * 0.3, "brightness clearly oscillates (breathing)");
});
```

(Common shape; the panel is a single hue, only brightness varies. Default `frame_ms` ~50.)

---

### Task 5: `wave`

**Reference:** `esp32_matrix_webserver/anim_effects.ino` `runWaveFrame()`. Per column, a phase-shifted `beatsin8(20, 0, 7, x*32 + offset)` sets the wave height; fill from the surface row down, blending `waveColor1` (bright surface) → `waveColor2` (dim depth) by relative depth; above the surface is black. `waveOffset` advances each frame (rolling). Default colors: a water blue surface→deep (e.g. `#46c8ff`→`#0a2864`), overridable via opts.

- [ ] **Step 1: test block:**

```js
test("wave: a filled water surface that rolls and varies by column", () => {
  const sim = FIRMWARE_SIMS.wave();
  const a = sim.frame();
  assertInBounds(a);
  assert.ok(a.length > 0 && a.length < 64, "partially filled (water below a wavy surface)");
  // Different columns have different fill heights (a wave, not a flat line).
  const heightOf = (frame, x) => frame.filter((p) => p.x === x).length;
  const heights = [0,1,2,3,4,5,6,7].map((x) => heightOf(a, x));
  assert.ok(new Set(heights).size > 1, "columns have differing heights");
  // It rolls: the lit set changes over time.
  for (let i = 0; i < 4; i++) sim.frame();
  const b = sim.frame();
  assert.notDeepEqual(a.map((p)=>`${p.x},${p.y}`).sort(), b.map((p)=>`${p.x},${p.y}`).sort());
});
```

(Common shape. Default `frame_ms` ~60.)

---

### Task 6: `comet`

**Reference:** `esp32_matrix_webserver/anim_comet.ino` `runCometFrame()`. A 2×2 "heart" bobs ±2px around row 3 at the right edge (cols 6–7), following `cY = 3 + sin(phase)*2`. A tail of 4 columns (5→2) trails using a Y-history ring buffer, each dimmer and color-shifted outward. ~5% chance per frame to emit one of 6 sparks that drift left and fade. Default colors: a warm head→tail gradient (e.g. white head, orange/red tail), overridable via opts.

- [ ] **Step 1: test block:**

```js
test("comet: bright head at the right edge, bobbing, with a trailing tail", () => {
  const sim = FIRMWARE_SIMS.comet();
  const frames = [];
  for (let i = 0; i < 40; i++) { const f = sim.frame(); assertInBounds(f); frames.push(f); }
  // Head lives at the right edge (cols 6–7) and is present every frame.
  for (const f of frames) assert.ok(f.some((p) => p.x >= 6), "head at right edge");
  // There is a tail to the left of the head (cols < 6 lit at least sometimes).
  assert.ok(frames.some((f) => f.some((p) => p.x <= 5)), "tail extends left");
  // It bobs: the head's row changes across frames.
  const headRow = (f) => Math.min(...f.filter((p) => p.x === 7).map((p) => p.y));
  const rows = new Set(frames.map(headRow));
  assert.ok(rows.size > 1, "head bobs vertically");
});
```

(Common shape. Default `frame_ms` ~70. RNG via `Math.random` is fine — tests assert structure, not exact pixels.)

---

### Task 7: `spiral`

**Reference:** `esp32_matrix_webserver/anim_gradient.ino` `runSpiralFrame()` + `buildSpiralPath()`. Precompute the 64-cell clockwise-inward spiral path once. Each frame, slide a `color1`→`color2` gradient along the path: cell `i` gets `blend(c1, c2, t)` with `t = ((i + 64 - phase) % 64) * 255 / 63`; `phase` advances each frame. The whole board stays lit; the gradient chases endlessly inward. Default colors: two pleasant hues (e.g. `#ff5008`→`#1060ff`), overridable.

- [ ] **Step 1: test block:**

```js
test("spiral: whole board lit, gradient slides each frame", () => {
  const sim = FIRMWARE_SIMS.spiral();
  const a = sim.frame();
  assertInBounds(a);
  assert.equal(a.length, 64, "every cell lit");
  // The path covers all 64 distinct cells.
  assert.equal(new Set(a.map((p) => `${p.x},${p.y}`)).size, 64, "covers all cells once");
  // The gradient slides: a fixed cell's color changes frame to frame.
  for (let i = 0; i < 3; i++) sim.frame();
  const b = sim.frame();
  const at = (f, x, y) => f.find((p) => p.x === x && p.y === y);
  const pa = at(a, 0, 0), pb = at(b, 0, 0);
  assert.ok(pa.r !== pb.r || pa.g !== pb.g || pa.b !== pb.b, "gradient advances");
});
```

(Common shape. Default `frame_ms` ~80.)

---

### Task 8: `starfield`

**Reference:** `esp32_matrix_webserver/anim_gradient.ino` `runStarfieldFrame()` + `spawnStar()`. A pool of up to 16 particles. Outward mode (default): born at center (3.5,3.5) with a random angle/speed, die off-screen. Inward mode (`opts.inward`): born at a random edge pixel, head to center. Color lerps `starColor1`(birth)→`starColor2`(death) by `age/maxAge`, scaled by per-star brightness. Respawn on death/off-screen. Default colors: white→blue, `density` ~14.

- [ ] **Step 1: test block:**

```js
test("starfield: a modest set of moving star pixels that changes over time", () => {
  const sim = FIRMWARE_SIMS.starfield();
  const a = sim.frame();
  assertInBounds(a);
  assert.ok(a.length > 0 && a.length <= 16, "≤16 stars, some lit");
  for (let i = 0; i < 6; i++) sim.frame();
  const b = sim.frame();
  assert.notDeepEqual(
    a.map((p) => `${p.x},${p.y}`).sort(),
    b.map((p) => `${p.x},${p.y}`).sort(),
    "stars move/respawn over time",
  );
});
```

(Common shape. Default `frame_ms` ~80.)

---

### Task 9: `sun`

**Reference:** `esp32_matrix_webserver/anim_gradient.ino` `runSunFrame()`. A glowing 4×4 disc (rows/cols 2–5, minus the 4 corners) in `sunColor1`. 4 colored dots (`sunColor2..5`, light→dark) orbit the 8 perimeter ring positions `SUN_BX/SUN_BY = {3,6,7,6,4,1,0,1}/{0,1,3,6,7,6,4,1}`, evenly spaced every 2 slots, advancing one slot per frame. Default colors: warm yellow disc + 4 warm dots, overridable.

- [ ] **Step 1: test block:**

```js
const SUN_BX = [3, 6, 7, 6, 4, 1, 0, 1];
const SUN_BY = [0, 1, 3, 6, 7, 6, 4, 1];

test("sun: a steady central disc with dots orbiting the ring", () => {
  const sim = FIRMWARE_SIMS.sun();
  const a = sim.frame();
  assertInBounds(a);
  // Disc: the 4 inner cells (3,3)(4,3)(3,4)(4,4) are always lit.
  for (const [x, y] of [[3,3],[4,3],[3,4],[4,4]]) {
    assert.ok(a.some((p) => p.x === x && p.y === y), `disc lit at ${x},${y}`);
  }
  // Some dots sit on ring positions; the ring lights shift over frames.
  const ringLit = (f) => SUN_BX.map((bx, i) => f.some((p) => p.x === bx && p.y === SUN_BY[i])).join("");
  const r0 = ringLit(a);
  let moved = false;
  for (let i = 0; i < 8; i++) { if (ringLit(sim.frame()) !== r0) { moved = true; break; } }
  assert.ok(moved, "ring dots orbit");
});
```

(Common shape. Default `frame_ms` ~120.)

---

### Task 10: `liquid` (synthetic gravity)

**Reference:** `esp32_matrix_webserver/anim_liquid.ino` `stepLiquidFrame()`. Port the fluid physics faithfully, but **replace the IMU input with a synthetic gravity vector** so it animates with no hardware:
- Maintain a gravity `angle` that advances slowly each frame (default `angle += 0.02`); `gx = cos(angle)`, `gy = sin(angle)`, magnitude ~1 (always tilted). `opts.spin` overrides the rate; `opts.gravity = {x,y}` pins a fixed direction.
- Keep the rest verbatim in spirit: potential `p(x,y) = x*gx + y*gy`; the 32 highest-`p` cells are "below the surface"; `liquidLevel` springs toward the equilibrium threshold (`Teq` = 32nd-largest `p`) with velocity + damping (the slosh); depth-shaded color (palette or a top→bottom gradient) with froth brightening the moving surface. Result: fluid pools toward a slowly-rotating "down" and sloshes around the perimeter.
- Default ~half the board filled; default colors a water gradient (e.g. `#0a2864` deep → `#46c8ff` surface), `opts` overridable.

- [ ] **Step 1: test block:**

```js
test("liquid: roughly half-filled fluid whose region shifts as gravity rotates", () => {
  const sim = FIRMWARE_SIMS.liquid();
  let counts = [];
  const sets = [];
  for (let i = 0; i < 80; i++) {
    const f = sim.frame();
    assertInBounds(f);
    counts.push(f.length);
    if (i % 20 === 0) sets.push(new Set(f.map((p) => `${p.x},${p.y}`)));
  }
  const avg = counts.reduce((a, c) => a + c, 0) / counts.length;
  assert.ok(avg > 16 && avg < 56, `~half filled (avg ${avg.toFixed(1)})`);
  // The filled region moves as the synthetic gravity rotates.
  const same = [...sets[0]].filter((k) => sets[sets.length - 1].has(k)).length;
  assert.ok(same < sets[0].size, "filled region shifts over time");
});
```

(Common shape. Default `frame_ms` ~60. NOTE the IMU substitution in the commit message: `feat(sims): port liquid to JS with synthetic auto-rotating gravity`.)

---

## Self-Review

**Spec coverage:**
- Port the 8 (comet, liquid, rainbow, spiral, starfield, sun, wave, breathe) → Tasks 3–10. ✓
- Fidelity decision C (faithful logic, renderer adds beauty; sim emits per-cell RGB) → Global Constraints + each task's reference. ✓
- Sim contract `make<Name>(opts)→{frame_ms,frame()}`, in-bounds RGB → Global Constraints + Task 1 coverage test. ✓
- Extensibility: names already in `firmware-names.js` (no change); Gallery derives from registry → Task 1. ✓
- Unit tests per sim (in-bounds, animates, signature) + registry-coverage → Tasks 1, 3–10. ✓
- Visual review tool for generative sims → Task 2 (raw-RGB contact sheet + dumper). ✓
- Regenerate `gallery-data.json` via `npm run build:gallery` → each sim task Step 5. ✓
- Out of scope (board.html, manifest bindings, repo cut) → not present. ✓
- Success criteria (15 sims, all tested, all in Gallery, user-approved) → covered across tasks. ✓

**Placeholder scan:** Tasks 1–2 carry complete code. Tasks 3–10's Step 3 (the port body) is intentionally the animator-loop deliverable per the Global Constraints — every other step (tests, commands, expected output) is concrete. No "TBD"/"handle errors"/"similar to Task N".

**Type/name consistency:** `make<Name>` factories all register in `FIRMWARE_SIMS`; `frame()` returns `[{x,y,r,g,b}]` everywhere; `dumpSim(name, frames, opts)` signature matches its test; `assertInBounds` is the existing helper in `firmware-sims.test.js`. Helper names introduced (`chsv8`, `beatsin8`) are flagged as "add if absent," not assumed to exist.

---

## Execution Handoff

After the plan is approved, execute via **superpowers:subagent-driven-development** — but with the project's proven twist for the sim tasks: the implementer for Tasks 3–10 is an **animator subagent** that builds the port and self-critiques via `dump-sim-frames.mjs | render-contact-sheet.py`, with the main agent as the independent critic (browser eyeball of the Gallery) and the user as the final taste gate ([[feedback_subagent_visual_loop]]). Tasks 1–2 are ordinary mechanical implementer tasks. Reworks continue the same (warm) animator.
