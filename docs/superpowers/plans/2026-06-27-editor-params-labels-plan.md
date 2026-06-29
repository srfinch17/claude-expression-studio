# Studio Editor — Params & Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Studio Editor edit each firmware pool entry's board-consumed `params` (schema-driven typed widgets + a raw-JSON escape hatch) and any pool entry's `label`.

**Architecture:** A hand-authored firmware param schema (`studio/firmware-params.js`) + four pure, lossless manifest ops in `studio/editor.js` (TDD) + an inline "⚙ params" expander in `studio/editor.html` that wires typed widgets / a label field / a raw-JSON box to those ops. Param/label edits use a no-re-render "quiet apply" so the open expander keeps its state.

**Tech Stack:** Native ES modules, no bundler, no new deps. `node:test` + `node:assert/strict`.

## Global Constraints

- **Branch `feat/expression-studio`. No merge** — the repo cut is the final step of the whole arc.
- **No new runtime dependencies.** Native ES modules only. Reuse `../shared/` — no second renderer copy.
- **Edit `renderers.esp32-8x8` bindings ONLY.** Params/label live on **pool entry** objects `{weight, params, label}` — a single string binding has no entry object (out of scope; convert via the existing → pool).
- **Lossless + no input mutation:** ops return a new manifest and preserve weight/label/other-params and the rest of the manifest. A bare-number entry is converted to `{weight, …}` only when something is being added.
- **Params are board-consumed:** the schema reflects the ESP32 firmware's param vocabulary (parsed in `api_handlers.ino`), NOT the JS sim's. The board tolerates unknown/absent params (uses defaults) → value validation is light; the raw-JSON box is parse-guarded.
- **Pure logic is unit-tested** (`node --test`); `editor.html` glue is verified visually on the engine-served Studio.
- **Privacy:** never the maintainer's real name; "the user".
- **Full suite:** `npm test` must stay green. `studio/gallery-data.json` is not a generator input — no regen.

---

## File Structure

- **Create** `studio/firmware-params.js` — `FIRMWARE_PARAMS` schema (firmware → {param: spec}).
- **Modify** `studio/editor.js` — 4 pure ops (`setEntryParam`, `removeEntryParam`, `setEntryParamsRaw`, `setLabel`) + a private `asEntryObject` helper.
- **Modify** `studio/editor.test.js` — tests per op.
- **Modify** `studio/editor.html` — the ⚙ expander (widgets + label + raw-JSON), `applyQuiet`, CSS.

Task 1 → schema + ops. Task 2 → editor.html.

---

## Task 1: Param schema + lossless entry-edit ops

**Files:**
- Create: `studio/firmware-params.js`
- Modify: `studio/editor.js` (append the 4 ops + `asEntryObject`)
- Test: `studio/editor.test.js` (append)

**Interfaces:**
- Produces: `FIRMWARE_PARAMS` (schema); and the ops (each `(manifest, rendererId="esp32-8x8", intent, name, …) -> manifest`, new object, no input mutation, no-op when the binding isn't a pool or `name` isn't in it):
  - `setEntryParam(…, key, value)` — set one param (converts a bare-number entry to object).
  - `removeEntryParam(…, key)` — delete a param; drop empty `params`. Bare-number entry → no-op.
  - `setEntryParamsRaw(…, paramsObj)` — replace the whole `params`; empty/`{}` drops it (bare-number + empty → no-op).
  - `setLabel(…, label)` — set `label`; empty/`null` drops it (bare-number + clear → no-op).

- [ ] **Step 1: Create `studio/firmware-params.js`**

```javascript
// studio/firmware-params.js — hand-authored param schema for the editor's typed widgets.
// These params are consumed by the ESP32 firmware (the esp32-8x8 renderer forwards a pool
// entry's params to POST /api/display/animation), so names/ranges mirror api_handlers.ino,
// NOT the JS sims. Firmwares/params NOT listed here fall back to the editor's raw-JSON box.
// type: number {min,max,step,default} | enum {options,default} | color {default} | bool {default}.

export const FIRMWARE_PARAMS = {
  fire: {
    intensity: { type: "number", min: 1, max: 10, step: 1, default: 6 },
    palette:   { type: "enum", options: ["classic", "blue", "green", "purple"], default: "classic" },
    sparks:    { type: "number", min: 0, max: 10, step: 1, default: 0 },
    tendrils:  { type: "number", min: 0, max: 10, step: 1, default: 0 },
    speed:     { type: "number", min: 10, max: 10000, step: 1, default: 66 },
  },
  matrix_rain: {
    theme: { type: "enum", options: ["classic", "blue", "red", "purple"], default: "classic" },
    speed: { type: "number", min: 10, max: 10000, step: 1, default: 66 },
  },
  frostbite: {
    color:   { type: "color", default: "#66ccff" },
    sparkle: { type: "number", min: 0, max: 10, step: 1, default: 5 },
    mist:    { type: "number", min: 0, max: 10, step: 1, default: 4 },
  },
  fireworks: {
    color1: { type: "color", default: "#ff0050" },
    color2: { type: "color", default: "#00e0ff" },
    color3: { type: "color", default: "#ffd000" },
  },
  snow: {
    speed:    { type: "number", min: 10, max: 10000, step: 1, default: 110 },
    confetti: { type: "bool", default: false },
    color:    { type: "color", default: "#dce6ff" },
  },
  dancefloor: {
    palette: { type: "number", min: 0, max: 7, step: 1, default: 0 },
    hold:    { type: "number", min: 1, max: 30, step: 1, default: 6 },
  },
  clock: {
    color1: { type: "color", default: "#00ff88" },
    color2: { type: "color", default: "#0088ff" },
    color3: { type: "color", default: "#ff4040" },
  },
  claudesweep: {
    color: { type: "color", default: "#ff5008" },
  },
};
```

- [ ] **Step 2: Write the failing tests** (append to `studio/editor.test.js`)

```javascript
import { setEntryParam, removeEntryParam, setEntryParamsRaw, setLabel } from "./editor.js";

test("setEntryParam converts a bare-number entry to object, preserving weight", () => {
  const m = setEntryParam(fresh(), "esp32-8x8", "working", "wait-claude", "intensity", 6);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], { weight: 40, params: { intensity: 6 } });
});

test("setEntryParam on an object entry preserves weight/label/other params", () => {
  const m = setEntryParam(fresh(), "esp32-8x8", "idle", "fire", "intensity", 7);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire,
    { weight: 2, params: { speed: 50, intensity: 7 }, label: "🔥" });
});

test("setEntryParam does not mutate the input manifest", () => {
  const m = fresh(); const snap = JSON.stringify(m);
  setEntryParam(m, "esp32-8x8", "idle", "fire", "intensity", 7);
  assert.equal(JSON.stringify(m), snap);
});

test("removeEntryParam deletes a param and drops emptied params; bare-number is a no-op", () => {
  let m = removeEntryParam(fresh(), "esp32-8x8", "idle", "fire", "speed");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, label: "🔥" });
  m = removeEntryParam(fresh(), "esp32-8x8", "working", "wait-claude", "x"); // bare number -> unchanged
  assert.equal(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], 40);
});

test("setEntryParamsRaw replaces params; empty object drops the params key", () => {
  let m = setEntryParamsRaw(fresh(), "esp32-8x8", "idle", "fire", { color: "#fff" });
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, params: { color: "#fff" }, label: "🔥" });
  m = setEntryParamsRaw(m, "esp32-8x8", "idle", "fire", {});
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, label: "🔥" });
});

test("setLabel sets and clears a label; clearing a bare-number entry is a no-op", () => {
  let m = setLabel(fresh(), "esp32-8x8", "working", "wait-claude", "my wait");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], { weight: 40, label: "my wait" });
  m = setLabel(fresh(), "esp32-8x8", "idle", "fire", "");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, params: { speed: 50 } });
  m = setLabel(fresh(), "esp32-8x8", "working", "wait-claude", ""); // bare number, clear -> no-op
  assert.equal(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], 40);
});

test("entry-edit ops no-op on a string (single) binding", () => {
  const m = setEntryParam(fresh(), "esp32-8x8", "info", "smiley", "x", 1);
  assert.equal(m.renderers["esp32-8x8"].bindings.info, "smiley");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test studio/editor.test.js`
Expected: FAIL — the 4 ops are not exported.

- [ ] **Step 4: Implement the ops** (append to `studio/editor.js`, after the existing mutation ops)

```javascript
// Ensure pool[name] is an entry object {weight,...} so params/label can hang off it; a bare
// number `w` becomes {weight:w}. Only call when ADDING params/label (never for clear/no-op).
function asEntryObject(pool, name) {
  const v = pool[name];
  if (v && typeof v === "object") return v;
  pool[name] = { weight: typeof v === "number" ? v : 1 };
  return pool[name];
}

export function setEntryParam(manifest, rendererId = "esp32-8x8", intent, name, key, value) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur) || !(name in cur.pool)) return;
    const e = asEntryObject(cur.pool, name);
    e.params = e.params || {};
    e.params[key] = value;
  });
}

export function removeEntryParam(manifest, rendererId = "esp32-8x8", intent, name, key) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur) || !(name in cur.pool)) return;
    const e = cur.pool[name];
    if (!e || typeof e !== "object" || !e.params) return; // bare number / no params -> no-op
    delete e.params[key];
    if (Object.keys(e.params).length === 0) delete e.params;
  });
}

export function setEntryParamsRaw(manifest, rendererId = "esp32-8x8", intent, name, paramsObj) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur) || !(name in cur.pool)) return;
    const nonEmpty = paramsObj && typeof paramsObj === "object" && Object.keys(paramsObj).length > 0;
    if (nonEmpty) { asEntryObject(cur.pool, name).params = paramsObj; }
    else { const e = cur.pool[name]; if (e && typeof e === "object") delete e.params; } // bare number -> no-op
  });
}

export function setLabel(manifest, rendererId = "esp32-8x8", intent, name, label) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur) || !(name in cur.pool)) return;
    if (label == null || label === "") { const e = cur.pool[name]; if (e && typeof e === "object") delete e.label; } // bare number -> no-op
    else { asEntryObject(cur.pool, name).label = label; }
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test studio/editor.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/firmware-params.js studio/editor.js studio/editor.test.js
git commit -m "feat(editor): param schema + lossless entry param/label ops"
```

---

## Task 2: `editor.html` — the ⚙ params/label expander

**Files:**
- Modify: `studio/editor.html`

**Interfaces:**
- Consumes (new): `FIRMWARE_PARAMS` (`./firmware-params.js`); `setEntryParam`, `removeEntryParam`, `setEntryParamsRaw`, `setLabel` (`./editor.js`).
- Produces: the expander UI (no exports).

**Note:** browser glue — no unit test. These are TARGETED edits to the existing `studio/editor.html`; apply each exactly. Param/label edits use a new `applyQuiet` (updates the manifest + marks dirty WITHOUT re-rendering) so the open expander keeps its state and focus.

- [ ] **Step 1: Edit the imports** — add `FIRMWARE_PARAMS` and the 4 ops.

Find:
```javascript
    import { ownBindings, isPool, bindingEntries, poolPercentages, assignmentCounts,
             assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption } from "./editor.js";
    import { INTENT_FIRES } from "./intent-info.js";
```
Replace with:
```javascript
    import { ownBindings, isPool, bindingEntries, poolPercentages, assignmentCounts,
             assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption,
             setEntryParam, removeEntryParam, setEntryParamsRaw, setLabel } from "./editor.js";
    import { INTENT_FIRES } from "./intent-info.js";
    import { FIRMWARE_PARAMS } from "./firmware-params.js";
```

- [ ] **Step 2: Add `applyQuiet`** next to `apply`.

Find:
```javascript
    function apply(fn) { manifest = fn(manifest); setDirty(true); render(); }
```
Replace with:
```javascript
    function apply(fn) { manifest = fn(manifest); setDirty(true); render(); }
    // For param/label edits that don't change tile layout (% / counts / membership): update the
    // manifest + mark dirty WITHOUT re-rendering, so the open ⚙ expander keeps its DOM state.
    function applyQuiet(fn) { manifest = fn(manifest); setDirty(true); }
```

- [ ] **Step 3: Add the widget builders** — insert `widgetFor` and `buildEntryEditor` immediately after the `applyQuiet` line you just added (module-scope `function` declarations; order-independent).

Insert:
```javascript
    // One typed control for a schema param. cur = the entry's current value (undefined = unset →
    // ghost the schema default). All edits go through applyQuiet so the open expander survives.
    function widgetFor(intent, name, key, spec, cur) {
      const row = document.createElement("label"); row.className = "prow";
      const val = cur != null ? cur : spec.default;
      const set = (v) => applyQuiet((m) => setEntryParam(m, RID, intent, name, key, v));
      const clear = () => applyQuiet((m) => removeEntryParam(m, RID, intent, name, key));
      let ctrl;
      if (spec.type === "number") {
        ctrl = document.createElement("input"); ctrl.type = "range";
        ctrl.min = spec.min; ctrl.max = spec.max; ctrl.step = spec.step || 1; ctrl.value = val;
        const out = document.createElement("span"); out.textContent = val;
        ctrl.addEventListener("input", () => (out.textContent = ctrl.value));
        ctrl.addEventListener("change", () => set(Number(ctrl.value)));
        row.append(`${key} `, ctrl, out);
      } else if (spec.type === "enum") {
        ctrl = document.createElement("select");
        for (const o of spec.options) { const op = document.createElement("option"); op.value = o; op.textContent = o; if (o === val) op.selected = true; ctrl.appendChild(op); }
        ctrl.addEventListener("change", () => set(ctrl.value));
        row.append(`${key} `, ctrl);
      } else if (spec.type === "color") {
        ctrl = document.createElement("input"); ctrl.type = "color";
        ctrl.value = (typeof val === "string" && val[0] === "#") ? val : "#000000";
        ctrl.addEventListener("change", () => set(ctrl.value));
        row.append(`${key} `, ctrl);
      } else if (spec.type === "bool") {
        ctrl = document.createElement("input"); ctrl.type = "checkbox"; ctrl.checked = !!val;
        ctrl.addEventListener("change", () => set(ctrl.checked));
        row.append(ctrl, ` ${key}`);
      }
      if (cur != null) { const c = document.createElement("button"); c.type = "button"; c.textContent = "↺"; c.title = "reset to default"; c.onclick = clear; row.appendChild(c); }
      return row;
    }

    // The ⚙ expander for one pool entry: a label field (always) + typed param widgets and a raw-JSON
    // escape hatch (firmware entries only). Built hidden; the gear toggles .hidden.
    function buildEntryEditor(intent, name) {
      const wrap = document.createElement("div"); wrap.className = "entryed hidden";
      const entry = (ownBindings(manifest, RID)[intent].pool || {})[name];
      const params = (entry && typeof entry === "object" && entry.params) || {};
      const label = (entry && typeof entry === "object" && entry.label) || "";
      const it = byName.get(name);
      const isFw = it && it.kind === "firmware";
      const schema = isFw ? FIRMWARE_PARAMS[name] : null;

      const lab = document.createElement("label"); lab.className = "prow";
      const li = document.createElement("input"); li.type = "text"; li.value = label; li.placeholder = "label";
      li.addEventListener("change", () => applyQuiet((m) => setLabel(m, RID, intent, name, li.value)));
      lab.append("label ", li); wrap.appendChild(lab);

      if (schema) for (const [key, spec] of Object.entries(schema)) wrap.appendChild(widgetFor(intent, name, key, spec, params[key]));

      if (isFw) {
        const det = document.createElement("details"); const sum = document.createElement("summary"); sum.textContent = "advanced (raw JSON)";
        const ta = document.createElement("textarea"); ta.className = "rawjson"; ta.placeholder = '{"key": value}';
        ta.value = Object.keys(params).length ? JSON.stringify(params) : "";
        const err = document.createElement("div"); err.className = "jsonerr";
        // Re-seed from the live manifest each time the box is opened (widget edits may have changed params).
        det.addEventListener("toggle", () => {
          if (!det.open) return;
          const e2 = (ownBindings(manifest, RID)[intent].pool || {})[name];
          const p2 = (e2 && typeof e2 === "object" && e2.params) || {};
          ta.value = Object.keys(p2).length ? JSON.stringify(p2) : ""; err.textContent = "";
        });
        ta.addEventListener("change", () => {
          const t = ta.value.trim();
          if (!t) { err.textContent = ""; applyQuiet((m) => setEntryParamsRaw(m, RID, intent, name, {})); return; }
          let o; try { o = JSON.parse(t); } catch { err.textContent = "invalid JSON"; return; }
          if (o == null || typeof o !== "object" || Array.isArray(o)) { err.textContent = "must be a JSON object"; return; }
          err.textContent = ""; applyQuiet((m) => setEntryParamsRaw(m, RID, intent, name, o));
        });
        det.append(sum, ta, err); wrap.appendChild(det);
      }
      return wrap;
    }
```

- [ ] **Step 4: Add the ⚙ gear + expander to each pool tile** — wire it inside the `if (poolMode)` block.

Find:
```javascript
            if (poolMode) {
              const pct = document.createElement("div"); pct.className = "pct"; pct.textContent = `${pcts[name]}% · w${weight}`; tile.appendChild(pct);
              if (!readOnly) { const sl = document.createElement("input"); sl.type = "range"; sl.min = 0; sl.max = 100; sl.value = weight;
                sl.addEventListener("change", () => apply((m) => reweight(m, RID, intent, name, Number(sl.value)))); tile.appendChild(sl); }
            }
```
Replace with:
```javascript
            if (poolMode) {
              const pct = document.createElement("div"); pct.className = "pct"; pct.textContent = `${pcts[name]}% · w${weight}`; tile.appendChild(pct);
              if (!readOnly) { const sl = document.createElement("input"); sl.type = "range"; sl.min = 0; sl.max = 100; sl.value = weight;
                sl.addEventListener("change", () => apply((m) => reweight(m, RID, intent, name, Number(sl.value)))); tile.appendChild(sl); }
              if (!readOnly) {
                const ed = buildEntryEditor(intent, name);
                const gear = document.createElement("button"); gear.type = "button"; gear.className = "gear"; gear.textContent = "⚙ params"; gear.title = "params / label";
                gear.onclick = () => ed.classList.toggle("hidden");
                tile.appendChild(gear); tile.appendChild(ed);
              }
            }
```

- [ ] **Step 5: Add the expander CSS** — append inside the `<style>` block, just before the closing `</style>`.

Find:
```css
    .ptile .cnt { font-size:.56rem; color:var(--orange); }
  </style>
```
Replace with:
```css
    .ptile .cnt { font-size:.56rem; color:var(--orange); }
    .tile .gear { width:100%; margin-top:4px; padding:2px; font-size:.58rem; }
    .entryed { position:absolute; top:4px; left:90px; z-index:20; width:212px; background:#0d0d12;
      border:1px solid #2a2a34; border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px;
      box-shadow:0 6px 22px #000a; }
    .entryed.hidden { display:none; }
    .prow { display:flex; align-items:center; gap:6px; font-size:.62rem; color:var(--dim); }
    .prow input[type=text] { flex:1; font:inherit; font-size:.6rem; background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; }
    .prow input[type=range] { flex:1; }
    .prow select { font:inherit; font-size:.6rem; background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; }
    .prow button { padding:1px 6px; font-size:.62rem; }
    .entryed details summary { font-size:.6rem; color:var(--faint); cursor:pointer; }
    .rawjson { width:100%; height:48px; margin-top:4px; resize:vertical; font:inherit; font-size:.58rem;
      background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; }
    .jsonerr { color:var(--orange); font-size:.58rem; min-height:.7em; }
  </style>
```

- [ ] **Step 6: Verify in the engine-served Studio** (manual; controller does this — no unit test)

The engine serves the live `studio/` tree on port 8787. With it running:
1. Open `http://localhost:8787/studio/editor.html` — confirm it loads in edit mode (no read-only banner).
2. On a **firmware** pool tile (e.g. `fire` under the `idle` intent's screensaver, or any screensaver entry), click **⚙ params** → the popover opens beside the tile with a label field + typed widgets (intensity slider, palette dropdown, …).
3. Change `intensity` → status flips to "unsaved changes" and the popover **stays open** (no full re-render).
4. Open **advanced (raw JSON)** → the box shows the live `params`; type invalid JSON → inline "invalid JSON", no apply; type `{"speed":80}` → applies.
5. Edit a **label** on any pool entry (firmware or expression) → "unsaved changes".
6. Click **Save** → "saved — behavior is live". Reload → the params/label persisted. Confirm the manifest pool entry is `{weight, params, label}` with the other fields intact.
7. **Restore** the manifest after testing: `git checkout shared/manifest.json` (Save reformats + your test edits are throwaway).

Expected: widgets edit board params, label edits work, raw-JSON is parse-guarded, lossless round-trip holds.

- [ ] **Step 7: Run the full suite + commit**

Run: `npm test`
Expected: PASS (unchanged — this task is browser glue).

```bash
git add studio/editor.html
git commit -m "feat(editor): ⚙ params + label expander with typed widgets and raw-JSON hatch"
```

---

## Self-Review (controller, after both tasks)

Against `docs/superpowers/specs/2026-06-27-editor-params-labels-design.md`:

- **§3 schema** → Task 1 `firmware-params.js` (real enum options: `fire.palette`/`matrix_rain.theme` from `api_handlers.ino`); firmwares not in schema fall through to raw-JSON ✓.
- **§4 UI** → Task 2: typed widget per param, label field on any pool entry, advanced raw-JSON toggle, clear-removes-param (↺), ghosted defaults ✓.
- **§5 ops** → Task 1: `setEntryParam`/`removeEntryParam`/`setEntryParamsRaw`/`setLabel`, lossless, bare-number→object conversion only when adding ✓.
- **§6 persistence** → existing validated PUT; raw-JSON parse-guarded; lossless round-trip ✓.
- **§8 scope** → single (string) bindings get no params (gear only inside `poolMode`); no server-side value validation; no Pages/`.mcpb`/repo-cut ✓.
- **Discriminating tests:** each op test asserts a field that the pre-change code cannot produce (the ops don't exist) → RED-proven at Step 3 of Task 1.

---

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh implementer per task (Task 1 = cheap/transcription tier: the code is fully specified; Task 2 = standard tier: DOM glue + targeted edits), task review per task, opus whole-branch review at the end.
2. **Inline Execution** — batch with checkpoints.