# Studio Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `studio/editor.html` — a dedicated intent-centric editor that reweights / recategorizes / assigns animations over the manifest's `esp32-8x8` bindings, saved through the engine's existing validated `PUT /api/manifest`.

**Architecture:** Pure manifest-edit operations in `studio/editor.js` (unit-tested, no DOM, every op returns a new manifest and preserves untouched fields losslessly) + thin browser glue in `studio/editor.html` (load via `GET /api/manifest`, render intents-as-pools + a library tray, drag/slider edits calling the pures, validated Save via `PUT`, client-side test-fire). The engine's manifest API and validator already exist (Plan 4) and are unchanged.

**Tech Stack:** Native ES modules, no bundler, no new deps. Canvas bloom `Panel`. `node:test` + `node:assert/strict`. HTML5 drag-and-drop.

## Global Constraints

- **Branch `feat/expression-studio`. No merge** — the repo cut is the final step of the whole arc.
- **No new runtime dependencies.** Native ES modules only.
- **Reuse the one render core** (`shared/`) — no second renderer copy.
- **Edit `renderers.esp32-8x8` bindings ONLY** (web-sim inherits it; the `card` renderer is out of scope).
- **Lossless round-trip:** every edit op preserves all manifest fields it doesn't manage — `intents`, `harnesses`, other renderers, untouched bindings, and per-entry `params`/`label` — byte-for-byte. Ops MUST NOT mutate their input manifest (return a new object).
- **Pure logic is unit-tested** (`node --test`); DOM/browser glue is thin and verified visually on the engine-served Studio.
- **Save is the existing validated path:** `PUT /api/manifest` → `{ok:true}` (200) or `{ok:false, errors:string[]}` (400). The editor never writes the file directly; it can never persist a manifest that fails `npm run check:manifest`.
- **Engine-gated** like board.html: `GET /api/manifest` succeeds (served by the engine) → full edit + Save; it 404s (static `:8766` host) → load `../shared/manifest.json` as a static file, keep the UI explorable in-memory, but **disable Save** and show a banner.
- **Privacy:** never the maintainer's real name; refer to "the user".
- **Full suite:** `npm test`. Must stay green. `studio/gallery-data.json` is not a generator input here — no regen.

---

## File Structure

- **Modify** `shared/catalog.js` — add `export` to the existing `bindingNames` function (one keyword; no behavior change) so the editor can reuse it for orphan computation instead of duplicating it.
- **Create** `studio/editor.js` — pure manifest binding-edit operations + read helpers. No DOM, no I/O.
- **Create** `studio/editor.test.js` — unit tests for every `editor.js` export.
- **Create** `studio/editor.html` — the editor UI (browser glue).

Task 1 → `editor.js` read helpers + `bindingNames` export. Task 2 → `editor.js` mutation ops. Task 3 → `editor.html`.

---

## Task 1: `editor.js` read helpers + export `bindingNames`

**Files:**
- Modify: `shared/catalog.js` (export `bindingNames`)
- Create: `studio/editor.js`
- Test: `studio/editor.test.js`

**Interfaces:**
- Consumes: `effectiveBindings` (`../shared/resolver.js`), `bindingNames` (`../shared/catalog.js`).
- Produces (pure, no mutation):
  - `ownBindings(manifest, rendererId="esp32-8x8") -> object` — the renderer's own `bindings` (the editable object) or `{}`.
  - `isPool(binding) -> boolean` — true iff `binding` is an object with a `pool`.
  - `entryWeight(v) -> number` — `number | {weight} | other → 1`.
  - `bindingEntries(binding) -> Array<{name, weight}>` — `null→[]`, `string→[{name,weight:1}]`, pool→members.
  - `poolPercentages(binding) -> {name: percent}` — weight/sum rounded; single→`{name:100}`; null→`{}`.
  - `computeOrphans(manifest, rendererId, allNames) -> string[]` — names in `allNames` referenced by no effective binding.

- [ ] **Step 1: Export `bindingNames` from `shared/catalog.js`**

Change the existing declaration (around `shared/catalog.js:15`) from `function bindingNames(binding) {` to:

```javascript
export function bindingNames(binding) {
```

(Leave the body unchanged. `catalog.js` already uses it internally — adding `export` is behavior-neutral and its existing tests still pass.)

- [ ] **Step 2: Write the failing tests** (`studio/editor.test.js`)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownBindings, isPool, entryWeight, bindingEntries, poolPercentages, computeOrphans } from "./editor.js";

const M = {
  intents: { working: {}, idle: {} },
  renderers: {
    "esp32-8x8": { bindings: {
      info: "smiley",
      working: { pool: { "wait-claude": 40, "rainbow": 30 } },
      idle: { pool: { fire: { weight: 2, params: { speed: 50 }, label: "🔥" }, snow: 1 }, noRepeat: true, brightness: 5 },
    } },
    "web-sim": { inherits: "esp32-8x8" },
  },
};

test("ownBindings returns the renderer's bindings, {} when absent", () => {
  assert.equal(ownBindings(M)["info"], "smiley");
  assert.deepEqual(ownBindings({ renderers: {} }, "x"), {});
});

test("isPool / entryWeight", () => {
  assert.equal(isPool(M.renderers["esp32-8x8"].bindings.working), true);
  assert.equal(isPool("smiley"), false);
  assert.equal(entryWeight(40), 40);
  assert.equal(entryWeight({ weight: 2, params: {} }), 2);
  assert.equal(entryWeight({ params: {} }), 1);
});

test("bindingEntries normalizes string, pool, null", () => {
  assert.deepEqual(bindingEntries("smiley"), [{ name: "smiley", weight: 1 }]);
  assert.deepEqual(bindingEntries(null), []);
  assert.deepEqual(bindingEntries(M.renderers["esp32-8x8"].bindings.idle),
    [{ name: "fire", weight: 2 }, { name: "snow", weight: 1 }]);
});

test("poolPercentages: weight share rounded; single -> 100", () => {
  assert.deepEqual(poolPercentages(M.renderers["esp32-8x8"].bindings.working), { "wait-claude": 57, rainbow: 43 });
  assert.deepEqual(poolPercentages("smiley"), { smiley: 100 });
});

test("computeOrphans: names referenced by no binding (effective, inheritance-aware)", () => {
  const all = ["smiley", "wait-claude", "rainbow", "fire", "snow", "galaxy", "atom"];
  assert.deepEqual(computeOrphans(M, "esp32-8x8", all), ["galaxy", "atom"]);
  // web-sim inherits esp32-8x8, so the same names are bound for it
  assert.deepEqual(computeOrphans(M, "web-sim", all), ["galaxy", "atom"]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test studio/editor.test.js`
Expected: FAIL — `./editor.js` does not exist / exports missing.

- [ ] **Step 4: Implement the read helpers** (`studio/editor.js`)

```javascript
// studio/editor.js — PURE manifest binding-edit operations for the Studio Editor.
// No DOM, no I/O. Every mutation op returns a NEW manifest (deep JSON clone) and edits
// only renderers[rendererId].bindings — preserving all other fields (intents, harnesses,
// other renderers, untouched bindings, per-entry params/label) byte-for-byte. Default
// renderer is "esp32-8x8" (web-sim inherits it; the card renderer is out of scope).
import { effectiveBindings } from "../shared/resolver.js";
import { bindingNames } from "../shared/catalog.js";

// --- read helpers ---

// The renderer's own (editable) bindings object, or {}.
export function ownBindings(manifest, rendererId = "esp32-8x8") {
  const r = manifest && manifest.renderers && manifest.renderers[rendererId];
  return (r && r.bindings) || {};
}

export function isPool(binding) {
  return !!(binding && typeof binding === "object" && binding.pool);
}

// Weight of a pool entry value: number | {weight} | anything else -> 1.
export function entryWeight(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.weight === "number") return v.weight;
  return 1;
}

// Normalize a binding to [{name, weight}]. string -> single (weight 1); pool -> members; null -> [].
export function bindingEntries(binding) {
  if (binding == null) return [];
  if (typeof binding === "string") return [{ name: binding, weight: 1 }];
  if (isPool(binding)) return Object.entries(binding.pool).map(([name, v]) => ({ name, weight: entryWeight(v) }));
  return [];
}

// {name: percent-of-pool} by weight, rounded. single -> {name:100}; null -> {}.
export function poolPercentages(binding) {
  const entries = bindingEntries(binding);
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  const out = {};
  for (const e of entries) out[e.name] = total > 0 ? Math.round((Math.max(0, e.weight) / total) * 100) : 0;
  return out;
}

// Names in allNames referenced by NO effective binding of the renderer (= orphans).
export function computeOrphans(manifest, rendererId, allNames) {
  const bound = new Set();
  for (const b of Object.values(effectiveBindings(manifest, rendererId))) {
    for (const n of bindingNames(b)) bound.add(n);
  }
  return allNames.filter((n) => !bound.has(n));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test studio/editor.test.js`
Expected: PASS.

- [ ] **Step 6: Run the focused catalog tests (export is behavior-neutral)**

Run: `node --test shared/catalog.test.js`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add shared/catalog.js studio/editor.js studio/editor.test.js
git commit -m "feat(editor): pure read helpers + export bindingNames"
```

---

## Task 2: `editor.js` mutation operations

**Files:**
- Modify: `studio/editor.js` (append the mutation ops + the private `clone`/`withBindings` helpers)
- Test: `studio/editor.test.js` (append)

**Interfaces:**
- Produces (each returns a NEW manifest; never mutates input; default `rendererId="esp32-8x8"`):
  - `assign(manifest, rendererId, intent, name, weight=1)` — empty→string single; string→pool`{old:1,new:weight}`; pool→add `name:weight`.
  - `remove(manifest, rendererId, intent, name)` — pool: delete key (empties→delete binding); string===name→delete binding.
  - `reweight(manifest, rendererId, intent, name, weight)` — pool only; preserves an object entry's `params`/`label`.
  - `move(manifest, rendererId, fromIntent, toIntent, name)` — relocate, preserving the entry value; destination becomes/stays a pool.
  - `singleToPool(manifest, rendererId, intent)` — string → `{pool:{name:1}}`.
  - `poolToSingle(manifest, rendererId, intent)` — 1-member pool → string name.
  - `setPoolOption(manifest, rendererId, intent, key, value)` — `key ∈ {noRepeat, brightness}`; set on the `{pool}` object; `null`/`false` deletes the key.

- [ ] **Step 1: Write the failing tests** (append to `studio/editor.test.js`)

```javascript
import { assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption } from "./editor.js";

function fresh() {
  return {
    intents: { info: {}, working: {}, idle: {}, fail: {} },
    renderers: {
      "esp32-8x8": { bindings: {
        info: "smiley",
        working: { pool: { "wait-claude": 40, rainbow: 30 } },
        idle: { pool: { fire: { weight: 2, params: { speed: 50 }, label: "🔥" }, snow: 1 }, noRepeat: true, brightness: 5 },
      } },
      card: { bindings: { info: { glyph: "•", text: "Info" } } },
    },
  };
}

test("assign: empty->single, single->pool, pool->add", () => {
  let m = fresh();
  m = assign(m, "esp32-8x8", "fail", "skull");
  assert.equal(m.renderers["esp32-8x8"].bindings.fail, "skull");
  m = assign(m, "esp32-8x8", "fail", "cross");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.fail, { pool: { skull: 1, cross: 1 } });
  m = assign(m, "esp32-8x8", "working", "galaxy", 5);
  assert.equal(m.renderers["esp32-8x8"].bindings.working.pool.galaxy, 5);
});

test("assign does not mutate the input manifest", () => {
  const m = fresh();
  const snapshot = JSON.stringify(m);
  assign(m, "esp32-8x8", "fail", "skull");
  assert.equal(JSON.stringify(m), snapshot);
});

test("remove: pool delete; emptying deletes the binding; string match deletes", () => {
  let m = fresh();
  m = remove(m, "esp32-8x8", "working", "rainbow");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.working, { pool: { "wait-claude": 40 } });
  m = remove(m, "esp32-8x8", "working", "wait-claude");
  assert.equal("working" in m.renderers["esp32-8x8"].bindings, false);
  m = remove(m, "esp32-8x8", "info", "smiley");
  assert.equal("info" in m.renderers["esp32-8x8"].bindings, false);
});

test("reweight preserves an object entry's params/label", () => {
  const m = reweight(fresh(), "esp32-8x8", "idle", "fire", 9);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 9, params: { speed: 50 }, label: "🔥" });
});

test("move carries the entry value (weight+params+label) to the destination pool", () => {
  const m = move(fresh(), "esp32-8x8", "idle", "fail", "fire");
  assert.equal("fire" in m.renderers["esp32-8x8"].bindings.idle.pool, false);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.fail, { pool: { fire: { weight: 2, params: { speed: 50 }, label: "🔥" } } });
});

test("singleToPool / poolToSingle round-trip a single binding", () => {
  let m = singleToPool(fresh(), "esp32-8x8", "info");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.info, { pool: { smiley: 1 } });
  m = poolToSingle(m, "esp32-8x8", "info");
  assert.equal(m.renderers["esp32-8x8"].bindings.info, "smiley");
});

test("setPoolOption sets/deletes pool-level options", () => {
  let m = setPoolOption(fresh(), "esp32-8x8", "working", "noRepeat", true);
  assert.equal(m.renderers["esp32-8x8"].bindings.working.noRepeat, true);
  m = setPoolOption(m, "esp32-8x8", "idle", "brightness", null);
  assert.equal("brightness" in m.renderers["esp32-8x8"].bindings.idle, false);
});

test("edits preserve untouched intents-vocab and the card renderer (lossless)", () => {
  const m = reweight(fresh(), "esp32-8x8", "working", "rainbow", 99);
  assert.deepEqual(m.intents, fresh().intents);
  assert.deepEqual(m.renderers.card, fresh().renderers.card);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle, fresh().renderers["esp32-8x8"].bindings.idle);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test studio/editor.test.js`
Expected: FAIL — mutation ops not exported.

- [ ] **Step 3: Implement the mutation ops** (append to `studio/editor.js`)

```javascript
// --- mutation ops (each returns a new manifest; never mutates input) ---

const clone = (m) => JSON.parse(JSON.stringify(m));

// clone the manifest, ensure renderers[rid].bindings exists, run fn on it, return the clone.
function withBindings(manifest, rendererId, fn) {
  const m = clone(manifest);
  m.renderers = m.renderers || {};
  m.renderers[rendererId] = m.renderers[rendererId] || {};
  m.renderers[rendererId].bindings = m.renderers[rendererId].bindings || {};
  fn(m.renderers[rendererId].bindings);
  return m;
}

export function assign(manifest, rendererId = "esp32-8x8", intent, name, weight = 1) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (cur == null) { b[intent] = name; return; }
    if (typeof cur === "string") { if (cur !== name) b[intent] = { pool: { [cur]: 1, [name]: weight } }; return; }
    if (isPool(cur)) cur.pool[name] = weight;
  });
}

export function remove(manifest, rendererId = "esp32-8x8", intent, name) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (typeof cur === "string") { if (cur === name) delete b[intent]; return; }
    if (isPool(cur)) {
      delete cur.pool[name];
      if (Object.keys(cur.pool).length === 0) delete b[intent];
    }
  });
}

export function reweight(manifest, rendererId = "esp32-8x8", intent, name, weight) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur) || !(name in cur.pool)) return;
    const v = cur.pool[name];
    if (v && typeof v === "object") v.weight = weight; // keep params/label
    else cur.pool[name] = weight;
  });
}

export function move(manifest, rendererId = "esp32-8x8", fromIntent, toIntent, name) {
  return withBindings(manifest, rendererId, (b) => {
    if (fromIntent === toIntent) return;
    const src = b[fromIntent];
    let val = 1;
    if (typeof src === "string" && src === name) { delete b[fromIntent]; }
    else if (isPool(src) && name in src.pool) {
      val = src.pool[name];
      delete src.pool[name];
      if (Object.keys(src.pool).length === 0) delete b[fromIntent];
    } else return; // name not in source -> no-op
    const dst = b[toIntent];
    if (dst == null) b[toIntent] = { pool: { [name]: val } };
    else if (typeof dst === "string") b[toIntent] = { pool: { [dst]: 1, [name]: val } };
    else if (isPool(dst)) dst.pool[name] = val;
  });
}

export function singleToPool(manifest, rendererId = "esp32-8x8", intent) {
  return withBindings(manifest, rendererId, (b) => {
    if (typeof b[intent] === "string") b[intent] = { pool: { [b[intent]]: 1 } };
  });
}

export function poolToSingle(manifest, rendererId = "esp32-8x8", intent) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (isPool(cur)) {
      const names = Object.keys(cur.pool);
      if (names.length === 1) b[intent] = names[0];
    }
  });
}

export function setPoolOption(manifest, rendererId = "esp32-8x8", intent, key, value) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur)) return;
    if (value == null || value === false) delete cur[key];
    else cur[key] = value;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test studio/editor.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — `manifest OK`, `tsc` clean, all `node --test` green.

- [ ] **Step 6: Commit**

```bash
git add studio/editor.js studio/editor.test.js
git commit -m "feat(editor): pure manifest mutation ops (lossless round-trip)"
```

---

## Task 3: `studio/editor.html` — the editor UI

**Files:**
- Create: `studio/editor.html`

**Interfaces:**
- Consumes: `Panel` (`../shared/render.js`), `FIRMWARE_SIMS` (`../shared/firmware-sims.js`), `resolveExpression` (`../shared/expressions.js`), `pickWeighted` (`../shared/resolver.js`), `buildPlaylists` (`./board.js`), and from `./editor.js`: `ownBindings`, `isPool`, `bindingEntries`, `poolPercentages`, `computeOrphans`, `assign`, `remove`, `reweight`, `move`, `singleToPool`, `poolToSingle`, `setPoolOption`; `./gallery-data.json` (fetched).
- Produces: the rendered editor page (no exports).

**Note:** browser glue — no unit test. The complete file is below; write it verbatim. Verified visually (Step 3). The library index is built by reusing `buildPlaylists(data, Object.keys(FIRMWARE_SIMS), [])` whose `.all` is every renderable `{name, kind, entry}`.

- [ ] **Step 1: Write `studio/editor.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Editor — Expression Studio</title>
  <style>
    :root { --bg:#0a0a0e; --panel:#111118; --sub:#15151b; --text:#e8e8ef; --dim:#9a9aa8;
      --faint:#5a5a68; --orange:#ff5008; --cyan:#22ddff; --green:#16a34a; --red:#ff6464;
      --mono:'IBM Plex Mono',ui-monospace,monospace; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px var(--mono); padding:0 0 40px; }
    header { position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid #1e1e26;
      display:flex; align-items:center; gap:12px; padding:12px 18px; }
    header h1 { font-size:1rem; margin:0; flex:0 0 auto; }
    #banner { color:var(--orange); font-size:.78rem; flex:1; }
    button { font:inherit; font-size:.8rem; color:var(--text); background:var(--sub);
      border:1px solid #2a2a34; border-radius:7px; padding:5px 11px; cursor:pointer; }
    button:disabled { opacity:.4; cursor:not-allowed; }
    button.save { border-color:var(--green); color:#9affc8; }
    #status { font-size:.76rem; color:var(--dim); min-width:14ch; }
    main { display:grid; grid-template-columns:1fr 240px; gap:18px; padding:18px; align-items:start; }
    .intent { background:var(--panel); border:1px solid #1c1c24; border-radius:12px; padding:12px; margin-bottom:12px; }
    .intent.drop { border-color:var(--cyan); box-shadow:0 0 0 1px var(--cyan); }
    .intent h2 { font-size:.82rem; margin:0 0 2px; }
    .intent .meta { font-size:.68rem; color:var(--faint); margin-bottom:8px; }
    .pool { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-start; }
    .tile { width:104px; background:var(--sub); border:1px solid #22222c; border-radius:9px; padding:7px; position:relative; }
    .tile canvas { width:90px; height:90px; border-radius:6px; background:#060608; display:block; }
    .tile .nm { font-size:.66rem; margin-top:5px; word-break:break-all; color:var(--text); }
    .tile .pct { font-size:.62rem; color:var(--cyan); }
    .tile input[type=range] { width:90px; margin:3px 0 0; }
    .tile .x { position:absolute; top:4px; right:4px; width:16px; height:16px; line-height:14px;
      text-align:center; border-radius:50%; background:#000a; border:1px solid #333; cursor:pointer; font-size:.7rem; }
    .empty { font-size:.7rem; color:var(--faint); padding:14px; border:1px dashed #2a2a34; border-radius:8px; }
    .opts { margin-top:8px; font-size:.7rem; color:var(--dim); display:flex; gap:14px; align-items:center; }
    .opts input[type=number] { width:52px; font:inherit; background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; }
    .fire { margin-top:8px; display:flex; gap:8px; align-items:center; }
    .fire canvas { width:46px; height:46px; border-radius:5px; background:#060608; }
    aside { position:sticky; top:64px; background:var(--panel); border:1px solid #1c1c24; border-radius:12px; padding:12px; }
    aside h2 { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); margin:0 0 10px; }
    .tray { display:flex; flex-wrap:wrap; gap:7px; max-height:78vh; overflow-y:auto; }
    .chip { font-size:.66rem; color:var(--dim); background:var(--sub); border:1px solid #22222c;
      border-radius:6px; padding:4px 7px; cursor:grab; }
    .chip.orphan { color:var(--orange); border-color:var(--orange); background:rgba(255,80,8,.08); }
  </style>
</head>
<body>
  <header>
    <h1>Studio Editor</h1>
    <span id="banner"></span>
    <span id="status"></span>
    <button id="revert">Revert</button>
    <button id="save" class="save">Save</button>
  </header>
  <main>
    <div id="intents"></div>
    <aside>
      <h2>Library <span id="orphanCount" style="color:var(--orange)"></span></h2>
      <div id="tray" class="tray"></div>
    </aside>
  </main>

  <script type="module">
    import { Panel } from "../shared/render.js";
    import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
    import { resolveExpression } from "../shared/expressions.js";
    import { pickWeighted } from "../shared/resolver.js";
    import { buildPlaylists } from "./board.js";
    import { ownBindings, isPool, bindingEntries, poolPercentages, computeOrphans,
             assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption } from "./editor.js";

    const RID = "esp32-8x8";
    const FW_DEFAULTS = { frostbite:{mist:40,sparkle:20}, fire:{palette:"classic",intensity:6},
      matrix_rain:{theme:"classic",frame_ms:60}, snow:{frame_ms:110,flakeColor:"#dce6ff"}, dancefloor:{palette:0,hold:6} };
    const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;

    const intentsEl = document.getElementById("intents");
    const trayEl = document.getElementById("tray");
    const statusEl = document.getElementById("status");
    const bannerEl = document.getElementById("banner");
    const orphanCountEl = document.getElementById("orphanCount");
    const saveBtn = document.getElementById("save");
    const revertBtn = document.getElementById("revert");

    let manifest = null, readOnly = false, byName = new Map(), allItems = [], dirty = false;
    let panels = [];   // live Panels to tick each frame (rebuilt on render)

    // Drive an existing Panel to play a library item (firmware sim OR frame-expression).
    function drive(panel, name) {
      const it = byName.get(name);
      if (it && it.kind === "firmware") { const sim = FIRMWARE_SIMS[name](FW_DEFAULTS[name] || {}); panel.setStepper(() => sim.frame(), sim.frame_ms); }
      else if (it) { const ex = resolveExpression(it.entry); panel.setFrames(ex.frames, ex.frame_ms); }
      else { panel.setFrames([[]], 1e9); } // unknown name -> blank
    }
    function makePanel(cv, name) { const p = new Panel(cv); drive(p, name); return p; }

    function setDirty(d) { dirty = d; statusEl.textContent = readOnly ? "read-only (no engine)" : d ? "unsaved changes" : "saved"; saveBtn.disabled = readOnly || !d; }

    // --- one rAF loop ticks all live tile Panels ---
    if (!REDUCE) { let last = performance.now(); (function loop(now){ for (const p of panels) p.tick(now-last, now); last=now; requestAnimationFrame(loop); })(last); }

    function apply(fn) { manifest = fn(manifest); setDirty(true); render(); }

    function render() {
      panels = [];
      intentsEl.innerHTML = "";
      const bindings = ownBindings(manifest, RID);
      for (const intent of Object.keys(manifest.intents || {})) {
        const binding = bindings[intent];
        const sec = document.createElement("div");
        sec.className = "intent";
        const def = manifest.intents[intent] || {};
        const fb = binding == null && def.fallback ? ` — falls back to ${def.fallback}` : "";
        sec.innerHTML = `<h2>${intent}</h2><div class="meta">${(def.doc||"")}${fb}</div>`;

        if (binding == null) {
          const e = document.createElement("div"); e.className = "empty"; e.textContent = "drop an animation here to bind"; sec.appendChild(e);
        } else {
          const pool = document.createElement("div"); pool.className = "pool";
          const pcts = poolPercentages(binding);
          const poolMode = isPool(binding);
          for (const { name, weight } of bindingEntries(binding)) {
            const tile = document.createElement("div"); tile.className = "tile"; tile.draggable = true;
            tile.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ name, from: intent })));
            const cv = document.createElement("canvas"); cv.width = 90; cv.height = 90; tile.appendChild(cv);
            panels.push(makePanel(cv, name));
            const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = name; tile.appendChild(nm);
            if (!readOnly) { const x = document.createElement("div"); x.className = "x"; x.textContent = "×";
              x.onclick = () => apply((m) => remove(m, RID, intent, name)); tile.appendChild(x); }
            if (poolMode) {
              const pct = document.createElement("div"); pct.className = "pct"; pct.textContent = `${pcts[name]}% · w${weight}`; tile.appendChild(pct);
              if (!readOnly) { const sl = document.createElement("input"); sl.type = "range"; sl.min = 0; sl.max = 100; sl.value = weight;
                sl.addEventListener("change", () => apply((m) => reweight(m, RID, intent, name, Number(sl.value)))); tile.appendChild(sl); }
            }
            pool.appendChild(tile);
          }
          sec.appendChild(pool);
          if (!readOnly) {
            const opts = document.createElement("div"); opts.className = "opts";
            if (poolMode) {
              const nr = document.createElement("label"); nr.innerHTML = `<input type="checkbox" ${binding.noRepeat?"checked":""}> noRepeat`;
              nr.querySelector("input").onchange = (e) => apply((m) => setPoolOption(m, RID, intent, "noRepeat", e.target.checked)); opts.appendChild(nr);
              const br = document.createElement("label"); br.innerHTML = `brightness <input type="number" min="0" max="255" value="${binding.brightness ?? ""}">`;
              br.querySelector("input").onchange = (e) => apply((m) => setPoolOption(m, RID, intent, "brightness", e.target.value === "" ? null : Number(e.target.value))); opts.appendChild(br);
              if (bindingEntries(binding).length === 1) { const c = document.createElement("button"); c.textContent = "→ single"; c.onclick = () => apply((m) => poolToSingle(m, RID, intent)); opts.appendChild(c); }
            } else { const c = document.createElement("button"); c.textContent = "→ pool"; c.onclick = () => apply((m) => singleToPool(m, RID, intent)); opts.appendChild(c); }
            sec.appendChild(opts);
          }
        }

        // test-fire: one preview Panel per intent; ▶ re-drives it with a fresh weighted pick.
        const fire = document.createElement("div"); fire.className = "fire";
        const btn = document.createElement("button"); btn.textContent = "▶ test";
        const pv = document.createElement("canvas"); pv.width = 46; pv.height = 46;
        const pvPanel = new Panel(pv); panels.push(pvPanel);
        btn.onclick = () => {
          const b = ownBindings(manifest, RID)[intent];
          const pick = isPool(b) ? pickWeighted(b.pool) : (typeof b === "string" ? b : null);
          if (pick) drive(pvPanel, pick);
        };
        fire.appendChild(btn); fire.appendChild(pv); sec.appendChild(fire);

        // drop target: assign (from tray) or move (from another intent)
        sec.addEventListener("dragover", (ev) => { if (!readOnly) { ev.preventDefault(); sec.classList.add("drop"); } });
        sec.addEventListener("dragleave", () => sec.classList.remove("drop"));
        sec.addEventListener("drop", (ev) => {
          sec.classList.remove("drop"); if (readOnly) return; ev.preventDefault();
          let d; try { d = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
          if (d.from == null) apply((m) => assign(m, RID, intent, d.name));
          else if (d.from !== intent) apply((m) => move(m, RID, d.from, intent, d.name));
        });
        intentsEl.appendChild(sec);
      }
      renderTray();
    }

    function renderTray() {
      trayEl.innerHTML = "";
      const orphans = new Set(computeOrphans(manifest, RID, allItems.map((i) => i.name)));
      orphanCountEl.textContent = orphans.size ? `(${orphans.size} orphan)` : "";
      for (const it of allItems) {
        const chip = document.createElement("div"); chip.className = "chip" + (orphans.has(it.name) ? " orphan" : "");
        chip.textContent = it.name; chip.draggable = true;
        chip.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ name: it.name, from: null })));
        trayEl.appendChild(chip);
      }
    }

    async function loadManifest() {
      try {
        const r = await fetch("/api/manifest");
        if (r.ok) { manifest = await r.json(); readOnly = false; bannerEl.textContent = ""; return; }
        throw new Error("no engine");
      } catch {
        manifest = await (await fetch("../shared/manifest.json")).json();
        readOnly = true;
        bannerEl.textContent = "Editing needs the live engine — launch the Studio via matrix_studio. (Exploring read-only; Save disabled.)";
      }
    }

    saveBtn.onclick = async () => {
      saveBtn.disabled = true; statusEl.textContent = "saving…";
      try {
        const r = await fetch("/api/manifest", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(manifest) });
        const res = await r.json();
        if (res.ok) { setDirty(false); statusEl.textContent = "saved — behavior is live"; }
        else { statusEl.textContent = "validation failed: " + (res.errors || []).join("; "); setDirty(true); }
      } catch (e) { statusEl.textContent = "save error: " + e.message; setDirty(true); }
    };
    revertBtn.onclick = async () => { await loadManifest(); setDirty(false); render(); };

    // --- boot ---
    const data = await (await fetch("./gallery-data.json")).json();
    allItems = buildPlaylists(data, Object.keys(FIRMWARE_SIMS), []).all;
    byName = new Map(allItems.map((it) => [it.name, it]));
    await loadManifest();
    setDirty(false);
    render();
  </script>
</body>
</html>
```

- [ ] **Step 2: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS — board.js/editor.js pures unaffected; the new HTML isn't covered but nothing else broke.

- [ ] **Step 3: Visual verification**

The controller performs this against (a) the static server at `:8766` for the explore/edit UI, and (b) a running engine for the Save round-trip. Confirm:
1. `http://localhost:8766/studio/editor.html` loads, shows the **read-only banner** ("needs the live engine"), Save disabled, and renders every intent with its pool tiles animating + weight % + the library tray with orphans orange-flagged.
2. Drag a tray chip onto an intent → it binds (tile appears); drag a pool tile to another intent → it moves; a slider change updates the % ; × removes; `→ pool` / `→ single` toggles; noRepeat/brightness controls work — all in-memory (status shows "unsaved changes").
3. `▶ test` on a pooled intent plays a weighted pick in the small preview canvas.
4. Against a running engine (open the URL `matrix_studio` returns): Save persists (status "saved — behavior is live"), a re-GET (Revert) shows the change; a deliberately-invalid manifest (e.g. a binding to a non-existent animation, forced via the console) surfaces the validator `errors`.

Use the available browser tooling to screenshot for the critic review. Do NOT attempt this in the implementer; the controller does it.

- [ ] **Step 4: Commit**

```bash
git add studio/editor.html
git commit -m "feat(editor): intent-centric manifest editor UI (drag, reweight, save, test-fire)"
```

---

## Definition of Done / Visual Review

- `npm test` green; all `editor.js` ops unit-tested incl. losslessness + no-input-mutation.
- The editor renders the live manifest as intent pools, edits in-memory via the tested pures, persists through the validated `PUT` (behavior live, no rebuild), surfaces validator errors, and degrades to explore-only on a static host.
- **User taste gate:** the user reviews the running editor (the layout, the drag/reweight feel, test-fire) and signs off.

---

## Self-Review (done at write time)

- **Spec coverage:** §3 edit model → Task 1 (read helpers) + Task 2 (ops) + Task 3 (UI). §4 persistence/degradation → Task 3 (loadManifest gate, Save via PUT, Revert, read-only banner). §5 test-fire → Task 3 (▶ + pickWeighted). §6 architecture/pure-ops surface → Tasks 1–2 signatures; reuse list in Task 3 imports. §7 scope (esp32-8x8 only, lossless) → Global Constraints + Task 2 losslessness tests.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** op signatures `(manifest, rendererId, …)` identical between Task 2 definitions and Task 3 call sites; `Item={name,kind,entry}` from `buildPlaylists` (board.js, Task already shipped) consumed by `playInto`/tray; `pickWeighted(pool, rng?)` and `effectiveBindings` used per their real resolver.js signatures.
