# Trigger Manifest — Plan 2: Renderer Interface + 3 Reference Renderers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the renderer plugin layer — a registry + a `fire()` dispatcher over the Plan 1
resolver, plus three reference renderers (`esp32-8x8`, `web-sim`, `card`) — all unit-testable in
isolation, with nothing wired into the live MCP/hook yet (that is Plan 3).

**Architecture:** A renderer is a tiny object `{ id, render(value) }`. The Plan 1 resolver does all
the thinking (moment→intent→fallback→pool pick); `fire()` resolves per active renderer and hands
each the leaf binding value. Each renderer is produced by a **dependency-injected factory** so its
I/O (board HTTP, the canvas `Panel`, the DOM) is supplied by the caller and faked in tests. This
keeps every renderer fully node-`--test`-able; the real canvas/DOM/HTTP wiring is the engine's job
(Plan 4) and is already exercised by `shared/render.js` + the studio Playwright smoke.

**Tech Stack:** Node.js ESM (`node --test`), plain `shared/*.js` modules, the Plan 1 resolver, the
existing `shared/render.js` (`Panel`), `shared/expressions.js` (`resolveExpression`), and
`shared/firmware-sims.js` (`FIRMWARE_SIMS`).

## Global Constraints

- **No new runtime dependencies.** Plain ESM JS in `shared/`; node stdlib in tests.
- **Renderers do no I/O directly** — every side effect (HTTP POST, canvas draw, DOM write) arrives
  through an injected dependency, so renderers are pure-logic + delegation and unit-testable with fakes.
- **The resolver (`shared/resolver.js`) and manifest are NOT modified** by this plan — Plan 2 consumes
  them read-only. (`resolve`, `effectiveBindings` signatures are fixed by Plan 1.)
- **A renderer's `render(value)` receives that renderer's own binding shape** — `esp32-8x8` and
  `web-sim` get an animation-name string; `card` gets a `{ glyph, text, color }` object.
- **Firmware-animation names** (`fire`, `dancefloor`, `fireworks`, `clock`, `frostbite`,
  `matrix_rain`, `snow`, `claudesweep`) are valid binding values that are NOT frame-expressions:
  `esp32-8x8` sends them via `/api/display/animation`; `web-sim` plays their JS port from
  `shared/firmware-sims.js`. The injected `isFirmware(name)` predicate decides.
- **Wire format** (board frames POST): `{ frames: string[], frame_ms, loop }` where each frame is a
  384-char hex string = 64 cells × `RRGGBB` row-major, `"000000"` for an off cell.
- **Privacy:** never use the maintainer's real name — say "the user".
- **Branch** `feat/expression-studio`. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Carry-forward from Plan 1's final review:** this plan's `esp32-8x8`/`web-sim` renderers MUST
  implement "a pool entry naming a missing animation → skip it and re-pick" at the call site — the
  pure resolver cannot (it has no disk knowledge). Implemented here via `fire()` retrying resolution
  with the missing name excluded (Task 1, Step on re-pick).

## File Structure

| File | Responsibility |
|---|---|
| `shared/wire.js` (create) | `artToHex(rows, colors)` + `expressionToWire(json)` — char-art → board hex wire. |
| `shared/registry.js` (create) | `createRegistry()` → register/get/active/all; `fire(manifest, opts, registry, ctx)` dispatcher (incl. missing-animation re-pick). |
| `shared/renderers/esp32.js` (create) | `makeEsp32Renderer(deps)` → posts frames or a firmware animation to the board. |
| `shared/renderers/web-sim.js` (create) | `makeWebSimRenderer(deps)` → drives a `Panel` (frames or a firmware sim stepper). |
| `shared/renderers/card.js` (create) | `makeCardRenderer(deps)` → writes `{glyph,text,color}` to a DOM-ish element. |
| `shared/*.test.js` (create per task) | node `--test` unit tests with injected fakes. |

**Interfaces produced by this plan (later plans rely on these exact signatures):**
- `createRegistry() -> { register(r), get(id), all(): Renderer[], active(): Renderer[] }`
  where a `Renderer` is `{ id: string, render(value): void|Promise<void> }`.
- `fire(manifest, { harness?, moment?, intent?, renderers? }, registry, ctx?) -> Promise<Array<{renderer, intent, value}|null>>`
- `artToHex(rows: string[], colors: Record<string,string>) -> string` (384 hex chars)
- `expressionToWire(json) -> { frames: string[], frame_ms: number, loop: number }`
- `makeEsp32Renderer({ loadExpression, postFrames, postAnimation, isFirmware }) -> Renderer`
- `makeWebSimRenderer({ panel, loadExpression, firmwareSims }) -> Renderer`
- `makeCardRenderer({ el }) -> Renderer`

---

### Task 1: Wire helpers + registry + `fire()` dispatcher

**Files:**
- Create: `shared/wire.js`, `shared/registry.js`
- Test: `shared/wire.test.js`, `shared/registry.test.js`

**Interfaces:**
- Consumes: `resolve`, `pickWeighted`, `effectiveBindings` from `shared/resolver.js`.
- Produces: `artToHex`, `expressionToWire`, `createRegistry`, `fire` (signatures above).

- [ ] **Step 1: Write the failing wire test**

Create `shared/wire.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { artToHex, expressionToWire } from "./wire.js";

test("artToHex maps lit cells to RRGGBB and off cells to 000000, row-major", () => {
  const rows = ["A.......", "........", "........", "........", "........", "........", "........", ".......B"];
  const hex = artToHex(rows, { A: "#ff0000", B: "#00ff00" });
  assert.equal(hex.length, 384);                 // 64 cells * 6
  assert.equal(hex.slice(0, 6), "ff0000");        // (0,0) = A
  assert.equal(hex.slice(6, 12), "000000");       // (1,0) = off
  assert.equal(hex.slice(63 * 6), "00ff00");      // (7,7) = B
});

test("expressionToWire converts all frames + carries frame_ms/loop", () => {
  const json = { frames: [["A.......", "", "", "", "", "", "", ""]], colors: { A: "#010203" }, frame_ms: 90, loop: 2 };
  const wire = expressionToWire(json);
  assert.equal(wire.frames.length, 1);
  assert.equal(wire.frames[0].slice(0, 6), "010203");
  assert.equal(wire.frame_ms, 90);
  assert.equal(wire.loop, 2);
});

test("expressionToWire defaults frame_ms=150 loop=0", () => {
  const wire = expressionToWire({ frames: [["........","","","","","","",""]], colors: {} });
  assert.equal(wire.frame_ms, 150);
  assert.equal(wire.loop, 0);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/wire.test.js`
Expected: FAIL — `Cannot find module './wire.js'`.

- [ ] **Step 3: Implement `shared/wire.js`**

```js
// shared/wire.js — char-art expression → the board's /api/display/frames wire format.
// Each frame is 64 cells (row-major) × "RRGGBB"; an off cell ('.', unknown, or
// unmapped char) is "000000". Mirrors matrix_signal.py art_to_hex + the MCP's
// expressionToWire so all senders agree on the bytes.

export function artToHex(rows, colors) {
  let out = "";
  for (let y = 0; y < 8; y++) {
    const row = rows[y] || "";
    for (let x = 0; x < 8; x++) {
      const ch = row[x];
      const hex = ch && ch !== "." && colors[ch] ? colors[ch].replace("#", "") : "000000";
      out += hex.toLowerCase();
    }
  }
  return out;
}

export function expressionToWire(json) {
  const colors = json.colors || {};
  return {
    frames: (json.frames || []).map((rows) => artToHex(rows, colors)),
    frame_ms: json.frame_ms || 150,
    loop: json.loop ?? 0,
  };
}
```

- [ ] **Step 4: Run the wire test, verify it passes**

Run: `node --test shared/wire.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing registry test**

Create `shared/registry.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, fire } from "./registry.js";

// Minimal manifest: Stop -> done; renderer r1 binds done->"a-done";
// renderer rp binds idle as a pool where "missing" doesn't exist on disk.
const manifest = {
  intents: { done: { fallback: null, root: true }, idle: { fallback: null, root: true } },
  harnesses: { h: { moments: [{ on: "hook:Stop", intent: "done" }] } },
  renderers: {
    r1: { bindings: { done: "a-done", idle: "a-idle" } },
    rp: { bindings: { done: "a-done", idle: { pool: { missing: 5, real: 1 } } } },
  },
};

function recordingRenderer(id) {
  const calls = [];
  return { r: { id, render: (v) => { calls.push(v); } }, calls };
}

test("registry register/get/all/active", () => {
  const reg = createRegistry();
  const a = recordingRenderer("r1");
  reg.register(a.r);
  assert.equal(reg.get("r1"), a.r);
  assert.deepEqual(reg.all().map((x) => x.id), ["r1"]);
  assert.deepEqual(reg.active().map((x) => x.id), ["r1"]);
});

test("fire resolves per renderer and dispatches the leaf value", async () => {
  const reg = createRegistry();
  const a = recordingRenderer("r1");
  reg.register(a.r);
  const out = await fire(manifest, { harness: "h", moment: "hook:Stop" }, reg);
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0], "a-done");
  assert.deepEqual(out, [{ renderer: "r1", intent: "done", value: "a-done" }]);
});

test("fire skips a renderer that resolves to nothing (returns null entry)", async () => {
  const reg = createRegistry();
  const a = recordingRenderer("r1");
  reg.register(a.r);
  const out = await fire(manifest, { intent: "nonexistent", renderers: ["r1"] }, reg);
  assert.equal(a.calls.length, 0);
  assert.deepEqual(out, [null]);
});

test("fire re-picks when a pool value names a missing animation", async () => {
  const reg = createRegistry();
  const p = recordingRenderer("rp");
  reg.register(p.r);
  // exists() says "missing" is absent; rng=0 would pick "missing" first (weight 5),
  // so fire must exclude it and re-pick "real".
  const out = await fire(manifest, { intent: "idle", renderers: ["rp"] }, reg,
    { rng: () => 0, exists: (name) => name !== "missing" });
  assert.equal(p.calls[0], "real");
  assert.equal(out[0].value, "real");
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `node --test shared/registry.test.js`
Expected: FAIL — `Cannot find module './registry.js'`.

- [ ] **Step 7: Implement `shared/registry.js`**

```js
// shared/registry.js — renderer registry + the fire() dispatcher over the resolver.
// fire() resolves the intent FOR EACH active renderer (bindings differ per renderer),
// then hands each renderer its own leaf binding value. It also owns the
// "pool entry names a missing animation -> skip & re-pick" fail-safe that the pure
// resolver cannot (the renderer/engine knows what exists; the resolver does not).
import { resolve, effectiveBindings, pickWeighted } from "./resolver.js";

export function createRegistry() {
  const map = new Map();
  return {
    register(r) { map.set(r.id, r); return r; },
    get(id) { return map.get(id); },
    all() { return [...map.values()]; },
    active() { return [...map.values()]; }, // v1: all registered renderers are active
  };
}

// Resolve for one renderer, honoring ctx.exists (optional) so a pooled binding whose
// pick names a non-existent animation is excluded and re-picked. Falls back to the
// plain resolver result when no exists() predicate is given.
function resolveExisting(manifest, rendererId, opts, ctx) {
  const base = resolve(manifest, { ...opts, renderer: rendererId }, ctx);
  if (!base || !ctx || typeof ctx.exists !== "function") return base;
  if (ctx.exists(base.value)) return base;
  // The pick was a missing animation. Re-pick from the same pool excluding misses.
  const binding = effectiveBindings(manifest, rendererId)[base.intent];
  if (!binding || typeof binding !== "object" || !binding.pool) return base; // not a pool; nothing to re-pick
  const remaining = Object.fromEntries(
    Object.entries(binding.pool).filter(([name]) => ctx.exists(name)));
  if (Object.keys(remaining).length === 0) return base; // all missing; let caller no-op on it
  const value = pickWeighted(remaining, ctx.rng || Math.random);
  return { intent: base.intent, value };
}

export async function fire(manifest, opts, registry, ctx = {}) {
  const ids = opts.renderers || registry.active().map((r) => r.id);
  const out = [];
  for (const id of ids) {
    const renderer = registry.get(id);
    const res = renderer ? resolveExisting(manifest, id, opts, ctx) : null;
    if (renderer && res) { await renderer.render(res.value); out.push({ renderer: id, ...res }); }
    else out.push(null);
  }
  return out;
}
```

- [ ] **Step 8: Run both tests, verify they pass**

Run: `node --test shared/wire.test.js shared/registry.test.js`
Expected: PASS (all).

- [ ] **Step 9: Commit**

```bash
git add shared/wire.js shared/wire.test.js shared/registry.js shared/registry.test.js
git commit -m "feat(manifest): wire helpers + renderer registry + fire() dispatcher

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The `esp32-8x8` renderer

**Files:**
- Create: `shared/renderers/esp32.js`
- Test: `shared/renderers/esp32.test.js`

**Interfaces:**
- Consumes: `expressionToWire` from `shared/wire.js`.
- Produces: `makeEsp32Renderer({ loadExpression, postFrames, postAnimation, isFirmware }) -> Renderer`.
  - `loadExpression(name) -> json|null` (caller supplies; reads canned/saved on disk or via fetch)
  - `postFrames(wire) -> Promise` and `postAnimation(type) -> Promise` (caller supplies the board HTTP)
  - `isFirmware(name) -> boolean`

- [ ] **Step 1: Write the failing test**

Create `shared/renderers/esp32.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEsp32Renderer } from "./esp32.js";

function harness() {
  const posted = { frames: [], anims: [] };
  const deps = {
    isFirmware: (n) => ["fire", "claudesweep"].includes(n),
    loadExpression: (n) => n === "done"
      ? { frames: [["G.......","","","","","","",""]], colors: { G: "#00c83c" }, frame_ms: 90, loop: 1 }
      : null,
    postFrames: async (w) => { posted.frames.push(w); },
    postAnimation: async (t) => { posted.anims.push(t); },
  };
  return { deps, posted };
}

test("esp32 renderer id is esp32-8x8", () => {
  assert.equal(makeEsp32Renderer(harness().deps).id, "esp32-8x8");
});

test("a frame-expression name is loaded, wired, and posted as frames", async () => {
  const h = harness();
  await makeEsp32Renderer(h.deps).render("done");
  assert.equal(h.posted.frames.length, 1);
  assert.equal(h.posted.frames[0].frame_ms, 90);
  assert.equal(h.posted.frames[0].frames[0].slice(0, 6), "00c83c");
  assert.equal(h.posted.anims.length, 0);
});

test("a firmware-animation name is posted via the animation endpoint, not frames", async () => {
  const h = harness();
  await makeEsp32Renderer(h.deps).render("fire");
  assert.deepEqual(h.posted.anims, ["fire"]);
  assert.equal(h.posted.frames.length, 0);
});

test("an unknown frame name no-ops (never throws, never posts)", async () => {
  const h = harness();
  await makeEsp32Renderer(h.deps).render("ghost");
  assert.equal(h.posted.frames.length, 0);
  assert.equal(h.posted.anims.length, 0);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/renderers/esp32.test.js`
Expected: FAIL — `Cannot find module './esp32.js'`.

- [ ] **Step 3: Implement `shared/renderers/esp32.js`**

```js
// shared/renderers/esp32.js — the LED board renderer. render(name) either fires a
// firmware animation (transient) or loads the named frame-expression, converts it to
// the board wire format, and POSTs the frames. All I/O (load + HTTP) is injected so
// this is pure dispatch logic and unit-testable with fakes.
import { expressionToWire } from "../wire.js";

export function makeEsp32Renderer({ loadExpression, postFrames, postAnimation, isFirmware }) {
  return {
    id: "esp32-8x8",
    async render(name) {
      if (typeof name !== "string") return;          // defensive: only animation names here
      if (isFirmware(name)) { await postAnimation(name); return; }
      const json = loadExpression(name);
      if (!json) return;                              // missing expression -> no-op (never throw)
      await postFrames(expressionToWire(json));
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test shared/renderers/esp32.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/renderers/esp32.js shared/renderers/esp32.test.js
git commit -m "feat(manifest): esp32-8x8 reference renderer (frames + firmware anims)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The `web-sim` renderer

**Files:**
- Create: `shared/renderers/web-sim.js`
- Test: `shared/renderers/web-sim.test.js`

**Interfaces:**
- Consumes: `resolveExpression` from `shared/expressions.js`.
- Produces: `makeWebSimRenderer({ panel, loadExpression, firmwareSims }) -> Renderer`.
  - `panel` is a `shared/render.js` `Panel` (has `setFrames(frames, frameMs)` and `setStepper(fn, frameMs)`)
  - `loadExpression(name) -> json|null`
  - `firmwareSims` is a map `{ name: { frame_ms, frame() } }` (e.g. `shared/firmware-sims.js`'s registry)

- [ ] **Step 1: Write the failing test**

Create `shared/renderers/web-sim.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWebSimRenderer } from "./web-sim.js";

function fakePanel() {
  const calls = { frames: [], steppers: [] };
  return {
    panel: {
      setFrames: (f, ms) => calls.frames.push({ count: f.length, ms }),
      setStepper: (fn, ms) => calls.steppers.push({ ms, sample: fn() }),
    },
    calls,
  };
}

const firmwareSims = { claudesweep: { frame_ms: 90, frame: () => [{ x: 0, y: 0, r: 255, g: 176, b: 0 }] } };
const loadExpression = (n) => n === "done"
  ? { frames: [["G.......","","","","","","",""], ["........","","","","","","",""]], colors: { G: "#00c83c" }, frame_ms: 120, loop: 0 }
  : null;

test("web-sim renderer id is web-sim", () => {
  const { panel } = fakePanel();
  assert.equal(makeWebSimRenderer({ panel, loadExpression, firmwareSims }).id, "web-sim");
});

test("a frame-expression name is resolved to pixel frames and set on the panel", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims }).render("done");
  assert.equal(f.calls.frames.length, 1);
  assert.equal(f.calls.frames[0].count, 2);   // two frames resolved
  assert.equal(f.calls.frames[0].ms, 120);
  assert.equal(f.calls.steppers.length, 0);
});

test("a firmware-sim name drives the panel via setStepper", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims }).render("claudesweep");
  assert.equal(f.calls.steppers.length, 1);
  assert.equal(f.calls.steppers[0].ms, 90);
  assert.equal(f.calls.steppers[0].sample[0].r, 255);
  assert.equal(f.calls.frames.length, 0);
});

test("an unknown name no-ops (panel untouched)", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims }).render("ghost");
  assert.equal(f.calls.frames.length, 0);
  assert.equal(f.calls.steppers.length, 0);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/renderers/web-sim.test.js`
Expected: FAIL — `Cannot find module './web-sim.js'`.

- [ ] **Step 3: Implement `shared/renderers/web-sim.js`**

```js
// shared/renderers/web-sim.js — the in-browser canvas renderer. render(name) drives a
// shared/render.js Panel: a firmware-sim name plays its JS port via setStepper, a
// frame-expression name is resolved to pixel frames via setFrames. The Panel and the
// data loaders are injected so this dispatch logic is unit-testable with fakes.
import { resolveExpression } from "../expressions.js";

export function makeWebSimRenderer({ panel, loadExpression, firmwareSims }) {
  return {
    id: "web-sim",
    render(name) {
      if (typeof name !== "string") return;
      const sim = firmwareSims && firmwareSims[name];
      if (sim) { panel.setStepper(sim.frame, sim.frame_ms); return; }
      const json = loadExpression(name);
      if (!json) return;                       // unknown -> leave the panel as-is
      const resolved = resolveExpression(json);
      panel.setFrames(resolved.frames, resolved.frame_ms);
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test shared/renderers/web-sim.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/renderers/web-sim.js shared/renderers/web-sim.test.js
git commit -m "feat(manifest): web-sim reference renderer (Panel frames + firmware sims)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: The `card` renderer

**Files:**
- Create: `shared/renderers/card.js`
- Test: `shared/renderers/card.test.js`

**Interfaces:**
- Produces: `makeCardRenderer({ el }) -> Renderer`.
  - `el` is a DOM-ish element exposing `querySelector(sel) -> { textContent, style }` for
    `.glyph`, `.text` and a settable `el.style.borderColor`. (Injected; a tiny fake in tests, a real
    node in the browser — no DOM library needed.)

- [ ] **Step 1: Write the failing test**

Create `shared/renderers/card.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCardRenderer } from "./card.js";

function fakeCard() {
  const glyph = { textContent: "" };
  const text = { textContent: "" };
  const el = { style: { borderColor: "" }, querySelector: (s) => (s === ".glyph" ? glyph : text) };
  return { el, glyph, text };
}

test("card renderer id is card", () => {
  assert.equal(makeCardRenderer({ el: fakeCard().el }).id, "card");
});

test("render writes glyph, text, and color to the element", () => {
  const c = fakeCard();
  makeCardRenderer({ el: c.el }).render({ glyph: "OK", text: "Done", color: "#00c83c" });
  assert.equal(c.glyph.textContent, "OK");
  assert.equal(c.text.textContent, "Done");
  assert.equal(c.el.style.borderColor, "#00c83c");
});

test("render tolerates a partial value (missing fields left blank, never throws)", () => {
  const c = fakeCard();
  makeCardRenderer({ el: c.el }).render({ glyph: "!" });
  assert.equal(c.glyph.textContent, "!");
  assert.equal(c.text.textContent, "");
});

test("render ignores a non-object value (e.g. a stray animation name)", () => {
  const c = fakeCard();
  makeCardRenderer({ el: c.el }).render("not-a-card-value");
  assert.equal(c.glyph.textContent, "");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/renderers/card.test.js`
Expected: FAIL — `Cannot find module './card.js'`.

- [ ] **Step 3: Implement `shared/renderers/card.js`**

```js
// shared/renderers/card.js — the desktop presence-card renderer. render(value) writes a
// { glyph, text, color } binding to an injected card element (.glyph / .text text nodes +
// the element's border color). The element is injected so this is testable with a fake.
export function makeCardRenderer({ el }) {
  return {
    id: "card",
    render(value) {
      if (!value || typeof value !== "object") return;   // card bindings are objects only
      const glyph = el.querySelector(".glyph");
      const text = el.querySelector(".text");
      if (glyph) glyph.textContent = value.glyph || "";
      if (text) text.textContent = value.text || "";
      if (value.color) el.style.borderColor = value.color;
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test shared/renderers/card.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/renderers/card.js shared/renderers/card.test.js
git commit -m "feat(manifest): card reference renderer (glyph/text/color to a DOM element)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: End-to-end integration test (seed manifest → 3 renderers via `fire`)

**Files:**
- Test: `shared/renderers/integration.test.js`

**Interfaces:**
- Consumes: the real `shared/manifest.json`, `createRegistry`/`fire`, all three `make*Renderer`
  factories, `shared/firmware-sims.js` (`FIRMWARE_SIMS`).

This task proves the whole stack wires together against the REAL seed manifest, with all three
renderers registered and fakes for I/O — one moment lights up all three surfaces, each its own way.

- [ ] **Step 1: Write the integration test**

Create `shared/renderers/integration.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRegistry, fire } from "../registry.js";
import { makeEsp32Renderer } from "./esp32.js";
import { makeWebSimRenderer } from "./web-sim.js";
import { makeCardRenderer } from "./card.js";
import { FIRMWARE_SIMS } from "../firmware-sims.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "shared/manifest.json"), "utf8"));
const FIRMWARE = ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain", "snow", "claudesweep"];

// A loader that returns a trivial valid expression for ANY non-firmware name, so the
// integration focuses on dispatch wiring (Plan 3 wires the real on-disk loader).
const loadExpression = (n) => FIRMWARE.includes(n)
  ? null
  : { frames: [["A.......","","","","","","",""]], colors: { A: "#ffffff" }, frame_ms: 150, loop: 0 };

function build() {
  const board = { frames: [], anims: [] };
  const panelCalls = { frames: 0, steppers: 0 };
  const cardEl = { style: {}, querySelector: () => ({ textContent: "" }) };
  const reg = createRegistry();
  reg.register(makeEsp32Renderer({
    isFirmware: (n) => FIRMWARE.includes(n),
    loadExpression,
    postFrames: async (w) => board.frames.push(w),
    postAnimation: async (t) => board.anims.push(t),
  }));
  reg.register(makeWebSimRenderer({
    panel: { setFrames: () => panelCalls.frames++, setStepper: () => panelCalls.steppers++ },
    loadExpression, firmwareSims: FIRMWARE_SIMS,
  }));
  reg.register(makeCardRenderer({ el: cardEl }));
  return { reg, board, panelCalls };
}

test("Stop -> done lights up all three renderers, each its own way", async () => {
  const b = build();
  const out = await fire(MANIFEST, { harness: "claude-code", moment: "hook:Stop" }, b.reg);
  // esp32 posted frames (done is a frame-expression), web-sim set frames, card got its object.
  assert.equal(b.board.frames.length, 1);
  assert.equal(b.panelCalls.frames, 1);
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.intent, "done");
});

test("idle pool resolves a firmware sim on web-sim and an animation on esp32", async () => {
  const b = build();
  // Force the idle pool to pick a firmware entry deterministically by excluding others
  // is overkill here; just assert the dispatch produced SOME output on each renderer.
  const out = await fire(MANIFEST, { intent: "idle" }, b.reg, { rng: () => 0 });
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.intent, "idle");
  // esp32 idle pool is all firmware -> an animation post (not frames); web-sim -> a stepper.
  assert.equal(b.board.anims.length, 1);
  assert.equal(b.panelCalls.steppers, 1);
});
```

> Note: the seed's `idle` pool on `esp32-8x8` is `{ fire, frostbite, snow, claudesweep }` — all
> firmware — so a pick is posted as an animation and played as a sim. If a future seed edit puts a
> frame-expression in the `idle` pool, the second test's `anims`/`steppers` counts shift; adjust the
> assertion to the renderer outputs rather than hard counts if that happens.

- [ ] **Step 2: Run it, verify it passes**

Run: `node --test shared/renderers/integration.test.js`
Expected: PASS. If a count assertion fails because of the seed's current `idle`/`done` bindings,
read the actual binding in `shared/manifest.json` and align the assertion to it (do not change the
renderers to fit the test).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: `manifest OK`, then the full suite green (Plan 1's 89 + this plan's new tests).

- [ ] **Step 4: Commit**

```bash
git add shared/renderers/integration.test.js
git commit -m "test(manifest): end-to-end fire() integration across all 3 renderers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Plan 2 portion — spec §5):**
- §5.1 shared resolver used by dispatch → `fire()` calls `resolve` per renderer (Task 1) ✓
- §5.2 one-method `render(value)` contract → all three factories return `{ id, render }` (Tasks 2–4) ✓
- §5.3 registry + dispatch → `createRegistry` + `fire` (Task 1) ✓
- §5.4 three reference renderers → esp32 / web-sim / card (Tasks 2–4) ✓; binding inheritance (`web-sim
  inherits esp32-8x8`) is resolved by Plan 1's `effectiveBindings`, exercised in the integration test ✓
- §4.1 pools + firmware names → esp32 firmware branch + web-sim stepper branch + pool pick (Tasks 1–3) ✓
- Plan 1 final-review carry (missing-pool-entry skip & re-pick) → `fire()` `resolveExisting` (Task 1) ✓
- Deferred (correctly NOT here): wiring renderers into the live MCP/hook (Plan 3); the engine serving
  the Studio + the real on-disk/fetch loaders + real Panel/DOM/HTTP (Plan 4); Pages showcase (Plan 5).

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; the two notes (integration
count caveat, web-sim render-as-is) describe real behavior, not deferred work. OK.

**3. Type consistency:** `Renderer = { id, render(value) }` is uniform across all factories, the
registry, `fire`, and the tests. `fire` returns `Array<{renderer,intent,value}|null>` — matches its
test assertions. `expressionToWire` shape (`{frames,frame_ms,loop}`) matches what `esp32.render`
posts and the board expects. `loadExpression(name)->json|null` is identical across esp32, web-sim,
and the integration test. OK.

---

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-06-25-trigger-manifest-plan2-renderers.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task (implementers can be cheap-tier: the
   plan ships complete code), task review between, broad review at the end.
2. **Inline Execution** — execute the tasks in-session with checkpoints.

Which approach?
