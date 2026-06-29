# Studio Editor — Iteration 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Studio Editor's animation tray into a wide persistent palette of mini live-preview tiles (drag = copy, green=available / orange=assigned with an (N) count), give each intent a precise "fires when…" description, and compact the category layout.

**Architecture:** One new pure helper (`assignmentCounts` in `studio/editor.js`, TDD) + a static curated descriptions module (`studio/intent-info.js`) + a rework of the `studio/editor.html` glue (palette mini-tiles, legend, descriptions, layout). The intent-pool editing, validated Save, engine gate, and lossless contract are unchanged.

**Tech Stack:** Native ES modules, no bundler, no new deps. Canvas bloom `Panel`. `node:test` + `node:assert/strict`.

## Global Constraints

- **Branch `feat/expression-studio`. No merge** — the repo cut is the final step of the whole arc.
- **No new runtime dependencies.** Native ES modules only. Reuse the one render core (`../shared/`) — no second renderer copy.
- **Edit `renderers.esp32-8x8` bindings ONLY**; lossless round-trip preserved (unchanged from v1).
- **Palette = persistent, drag = copy.** The tray shows EVERY animation as a mini live-preview tile; dragging COPIES into a category (an animation can be bound to several events); the tile stays in the palette. The existing `assign` no-op-on-duplicate guard backs this.
- **Assignment legend:** green border = available (0 events), orange = assigned, with an `(N)` count of how many intents bind it. No "orphan" wording.
- **Descriptions:** each intent shows a "fires when…" string from `studio/intent-info.js` (`INTENT_FIRES`), falling back to the manifest `doc`.
- **Pure logic is unit-tested** (`node --test`); the `editor.html` glue is verified visually on the engine-served Studio.
- **Privacy:** never the maintainer's real name; "the user".
- **Full suite:** `npm test`. Must stay green. `studio/gallery-data.json` is not a generator input — no regen.

---

## File Structure

- **Modify** `studio/editor.js` — append the pure `assignmentCounts` helper (keep all existing exports + tests).
- **Modify** `studio/editor.test.js` — append tests for `assignmentCounts`.
- **Create** `studio/intent-info.js` — `export const INTENT_FIRES` (curated per-intent "fires when" strings). Static data, no test.
- **Rewrite** `studio/editor.html` — palette of mini-preview tiles + color/(N) + descriptions + wider-palette/compact-category layout.

Task 1 → `assignmentCounts` + `intent-info.js`. Task 2 → `editor.html`.

---

## Task 1: `assignmentCounts` pure helper + intent descriptions

**Files:**
- Modify: `studio/editor.js` (append `assignmentCounts`)
- Test: `studio/editor.test.js` (append)
- Create: `studio/intent-info.js`

**Interfaces:**
- Produces: `assignmentCounts(manifest, rendererId, allNames) -> {name: count}` — for each name in `allNames`, the number of distinct intents whose effective binding references it (orphans → 0). `INTENT_FIRES: {intentName: string}`.

- [ ] **Step 1: Write the failing tests** (append to `studio/editor.test.js`)

```javascript
import { assignmentCounts } from "./editor.js";

test("assignmentCounts: distinct-intent count per name; orphan -> 0", () => {
  const c = assignmentCounts(fresh(), "esp32-8x8", ["smiley", "wait-claude", "fire", "galaxy"]);
  assert.equal(c.smiley, 1);        // info: "smiley"
  assert.equal(c["wait-claude"], 1); // working pool
  assert.equal(c.fire, 1);           // idle pool
  assert.equal(c.galaxy, 0);         // bound nowhere
});

test("assignmentCounts counts a name bound to multiple intents", () => {
  let m = fresh();
  m = assign(m, "esp32-8x8", "done", "smiley"); // smiley now in info AND done
  assert.equal(assignmentCounts(m, "esp32-8x8", ["smiley"]).smiley, 2);
});

test("assignmentCounts returns 0 for names in allNames not bound anywhere, only for listed names", () => {
  const c = assignmentCounts(fresh(), "esp32-8x8", ["galaxy"]);
  assert.deepEqual(c, { galaxy: 0 });
});
```

(`fresh()` and `assign` are already imported in this test file from Task 2 of the previous plan.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test studio/editor.test.js`
Expected: FAIL — `assignmentCounts` is not exported.

- [ ] **Step 3: Implement `assignmentCounts`** (append to `studio/editor.js`, in the read-helpers area near `computeOrphans`)

```javascript
// {name: count} — how many distinct intents bind each name (effective bindings).
// Drives the palette's assigned/available color + the (N) badge. Orphans -> 0.
export function assignmentCounts(manifest, rendererId, allNames) {
  const counts = {};
  for (const n of allNames) counts[n] = 0;
  for (const b of Object.values(effectiveBindings(manifest, rendererId))) {
    for (const n of new Set(bindingNames(b))) if (n in counts) counts[n] += 1;
  }
  return counts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test studio/editor.test.js`
Expected: PASS.

- [ ] **Step 5: Create `studio/intent-info.js`** (curated "fires when" descriptions)

```javascript
// studio/intent-info.js — curated, human-readable "fires when" descriptions for each
// manifest intent, derived from the Claude Code harness moment map
// (manifest.harnesses["claude-code"].moments: hook:* -> intent) and the hook semantics.
// The editor shows INTENT_FIRES[intent], falling back to the manifest's terse `doc`.
// Hook-fired intents name their trigger; discretionary and fallback-only intents say so.

export const INTENT_FIRES = {
  info:            "Neutral status floor. Shown for general information, and whenever a more specific intent has no binding and falls back here.",
  working:         "Fires when you submit a prompt (Claude starts working) and when you answer a question or approve a plan (work resumes).",
  done:            "Fires when Claude finishes its turn — the response is complete (the Stop hook).",
  attention:       "Fires when the harness shows a permission prompt that needs your approval to continue.",
  fail:            "A setback or something wrong. Root of the error family; shown when error/fatal fall back here.",
  idle:            "Ambient / away — the quiet presence shown when nothing is happening (distinct from the screensaver rotation).",
  thinking:        "Reasoning hard. Set via presence; falls back to working if unbound.",
  heard:           "Acknowledges that your message was received. Set via presence; falls back to working.",
  compacting:      "Fires before the conversation context is compacted/summarized (the PreCompact hook).",
  "session-start": "Fires when a Claude Code session starts or resumes (the SessionStart hook).",
  "session-end":   "Fires when the session ends (the SessionEnd hook).",
  "results-merged":"Fires when a subagent (a delegated Task) finishes and reports back (the SubagentStop hook).",
  approve:         "Acknowledgement / thumbs-up. Falls back to done.",
  ok:              "Acknowledged. Falls back to approve → done.",
  question:        "Asking the human. Falls back to awaiting-input.",
  celebrate:       "Discretionary — Claude fires this on a win or milestone.",
  delight:         "A pleasant surprise. Falls back to celebrate.",
  "awaiting-input":"Fires when Claude requests a human decision — the harness pauses until you answer (AskUserQuestion, or plan approval via ExitPlanMode).",
  alert:           "Active look-here — a silent shoulder-tap. Falls back to attention.",
  error:           "An error occurred. Falls back to fail.",
  fatal:           "Discretionary — something died / crashed. Falls back to error → fail.",
  sleep:           "Resting — the quiet idle glyph. Falls back to idle.",
  screensaver:     "Discretionary — the ambient screensaver rotation of firmware apps when the board is idle. Falls back to idle.",
  greet:           "Hello. Set via presence; falls back to info.",
  affection:       "Warmth. Set via presence; falls back to info.",
  fun:             "Playful. Set via presence; falls back to info.",
};
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — `manifest OK`, `tsc` clean, all `node --test` green.

- [ ] **Step 7: Commit**

```bash
git add studio/editor.js studio/editor.test.js studio/intent-info.js
git commit -m "feat(editor): assignmentCounts pure helper + curated intent descriptions"
```

---

## Task 2: `editor.html` — palette mini-previews, legend, descriptions, layout

**Files:**
- Rewrite: `studio/editor.html`

**Interfaces:**
- Consumes (new this task): `assignmentCounts` (`./editor.js`), `INTENT_FIRES` (`./intent-info.js`). Everything else as before.
- Produces: the reworked editor page (no exports).

**Note:** browser glue — no unit test. The complete file is below; write it verbatim. Verified visually by the controller. Key changes vs the previous `editor.html`: the tray (`renderTray`) now builds mini live-preview tiles (canvas + name + green/orange border + `(N)`), the layout gives the palette ~46% width and compacts the categories, and the intent `.meta` line uses `INTENT_FIRES`.

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
      --faint:#5a5a68; --orange:#ff5008; --cyan:#22ddff; --green:#16a34a;
      --mono:'IBM Plex Mono',ui-monospace,monospace; }
    * { box-sizing: border-box; }
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
    main { display:grid; grid-template-columns:minmax(0,1fr) minmax(360px,46%); gap:16px; padding:16px; align-items:start; }
    .intent { background:var(--panel); border:1px solid #1c1c24; border-radius:10px; padding:10px; margin-bottom:10px; }
    .intent.drop { border-color:var(--cyan); box-shadow:0 0 0 1px var(--cyan); }
    .intent h2 { font-size:.82rem; margin:0 0 2px; }
    .intent .meta { font-size:.66rem; color:var(--faint); margin-bottom:7px; line-height:1.35; }
    .pool { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-start; }
    .tile { width:84px; background:var(--sub); border:1px solid #22222c; border-radius:8px; padding:6px; position:relative; }
    .tile canvas { width:72px; height:72px; border-radius:5px; background:#060608; display:block; }
    .tile .nm { font-size:.62rem; margin-top:4px; word-break:break-all; color:var(--text); line-height:1.1; }
    .tile .pct { font-size:.6rem; color:var(--cyan); }
    .tile input[type=range] { width:72px; margin:2px 0 0; }
    .tile .x { position:absolute; top:3px; right:3px; width:15px; height:15px; line-height:13px;
      text-align:center; border-radius:50%; background:#000a; border:1px solid #333; cursor:pointer; font-size:.66rem; }
    .empty { font-size:.68rem; color:var(--faint); padding:12px; border:1px dashed #2a2a34; border-radius:8px; }
    .opts { margin-top:7px; font-size:.68rem; color:var(--dim); display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
    .opts input[type=number] { width:50px; font:inherit; background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; }
    .fire { margin-top:7px; display:flex; gap:8px; align-items:center; }
    .fire canvas { width:46px; height:46px; border-radius:5px; background:#060608; }
    aside { position:sticky; top:64px; background:var(--panel); border:1px solid #1c1c24; border-radius:10px; padding:12px; }
    aside h2 { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); margin:0 0 4px; }
    .legend { font-size:.64rem; color:var(--dim); margin-bottom:10px; display:flex; gap:14px; }
    .legend .sw { display:inline-block; width:9px; height:9px; border-radius:2px; border:2px solid; margin-right:4px; vertical-align:middle; }
    .legend .av { border-color:var(--green); }
    .legend .as { border-color:var(--orange); }
    .tray { display:flex; flex-wrap:wrap; gap:8px; max-height:82vh; overflow-y:auto; align-content:flex-start; }
    .ptile { width:62px; background:var(--sub); border:2px solid var(--green); border-radius:8px; padding:4px; cursor:grab; text-align:center; }
    .ptile.assigned { border-color:var(--orange); }
    .ptile canvas { width:46px; height:46px; border-radius:5px; background:#060608; display:block; margin:0 auto; }
    .ptile .nm { font-size:.56rem; margin-top:3px; word-break:break-all; color:var(--dim); line-height:1.05; }
    .ptile .cnt { font-size:.56rem; color:var(--orange); }
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
      <h2>Animations</h2>
      <div class="legend"><span><span class="sw av"></span>available</span><span><span class="sw as"></span>assigned (N&nbsp;events)</span></div>
      <div id="tray" class="tray"></div>
    </aside>
  </main>

  <script type="module">
    import { Panel } from "../shared/render.js";
    import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
    import { resolveExpression } from "../shared/expressions.js";
    import { pickWeighted } from "../shared/resolver.js";
    import { buildPlaylists } from "./board.js";
    import { ownBindings, isPool, bindingEntries, poolPercentages, assignmentCounts,
             assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption } from "./editor.js";
    import { INTENT_FIRES } from "./intent-info.js";

    const RID = "esp32-8x8";
    const FW_DEFAULTS = { frostbite:{mist:40,sparkle:20}, fire:{palette:"classic",intensity:6},
      matrix_rain:{theme:"classic",frame_ms:60}, snow:{frame_ms:110,flakeColor:"#dce6ff"}, dancefloor:{palette:0,hold:6} };
    const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;

    const intentsEl = document.getElementById("intents");
    const trayEl = document.getElementById("tray");
    const statusEl = document.getElementById("status");
    const bannerEl = document.getElementById("banner");
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
        const desc = INTENT_FIRES[intent] || def.doc || "";
        sec.innerHTML = `<h2>${intent}</h2><div class="meta">${desc}</div>`;

        if (binding == null) {
          const e = document.createElement("div"); e.className = "empty"; e.textContent = "drop an animation here to bind"; sec.appendChild(e);
        } else {
          const pool = document.createElement("div"); pool.className = "pool";
          const pcts = poolPercentages(binding);
          const poolMode = isPool(binding);
          for (const { name, weight } of bindingEntries(binding)) {
            const tile = document.createElement("div"); tile.className = "tile"; tile.draggable = true;
            tile.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ name, from: intent })));
            const cv = document.createElement("canvas"); cv.width = 72; cv.height = 72; tile.appendChild(cv);
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

    // The palette: every animation as a mini live-preview tile, color-coded by assignment.
    function renderTray() {
      trayEl.innerHTML = "";
      const counts = assignmentCounts(manifest, RID, allItems.map((i) => i.name));
      for (const it of allItems) {
        const n = counts[it.name] || 0;
        const t = document.createElement("div"); t.className = "ptile" + (n > 0 ? " assigned" : "");
        t.draggable = true;
        t.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", JSON.stringify({ name: it.name, from: null })));
        const cv = document.createElement("canvas"); cv.width = 46; cv.height = 46; t.appendChild(cv);
        panels.push(makePanel(cv, it.name));
        const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = it.name; t.appendChild(nm);
        if (n > 0) { const c = document.createElement("div"); c.className = "cnt"; c.textContent = `(${n})`; t.appendChild(c); }
        trayEl.appendChild(t);
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
Expected: PASS — pures unaffected; the new HTML isn't covered but nothing else broke.

- [ ] **Step 3: Visual verification**

The controller performs this against (a) the static `:8766` server and (b) a running engine. Confirm:
1. The palette (right pane, now wider) shows every animation as a **mini live-preview tile** (46px canvas + name), animating; **green border** for available, **orange border + `(N)`** for assigned; the legend reads "available / assigned (N events)".
2. The category sections are more compact; each intent's `.meta` shows the precise "fires when…" description (e.g. `awaiting-input` describes the harness pause).
3. Dragging a palette tile onto a category binds it (copy) and the tile's border flips to orange with `(1)` (or increments) — and the tile stays in the palette; removing it (×) flips it back / decrements.
4. Reweight slider, noRepeat/brightness, → pool/→ single, move-between-categories, test-fire, Save (against the engine), and the static read-only banner all still work.

Use the available browser tooling to screenshot for the critic review. Do NOT attempt this in the implementer.

- [ ] **Step 4: Commit**

```bash
git add studio/editor.html
git commit -m "feat(editor): palette of mini live-preview tiles + assignment legend, descriptions, wider layout"
```

---

## Definition of Done / Visual Review

- `npm test` green; `assignmentCounts` unit-tested incl. the multi-assignment case.
- The palette shows mini live-preview tiles, color+count coded, drag=copy; categories show precise descriptions and are more compact; the palette is wider. Everything from v1 (reweight/move/Save/test-fire/read-only) still works.
- **User taste gate:** the user reviews the running editor and signs off (or requests the next tweak).

---

## Self-Review (done at write time)

- **Spec coverage (Iteration 1 addendum):** §1 palette mini-tiles + drag=copy → Task 2 `renderTray`. §2 legend green/orange + (N) → Task 1 `assignmentCounts` + Task 2 `.ptile`/legend. §3 descriptions → Task 1 `INTENT_FIRES` + Task 2 `.meta`. §4 layout (wider palette, compact categories) → Task 2 CSS (`grid-template-columns`, smaller `.tile`, `.intent` padding). New pure helper `assignmentCounts` → Task 1.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `assignmentCounts(manifest, rendererId, allNames)` defined in Task 1 and called in Task 2 `renderTray` identically; `INTENT_FIRES` keyed by intent name, consumed via `INTENT_FIRES[intent]`; drag payload `{name, from}` and the `assign`/`move` routing unchanged from the working v1; the assign no-op-on-duplicate guard (shipped) makes palette drag=copy safe.
