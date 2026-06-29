# Presence Card Web Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the presence card to a board-independent, self-demoing web Studio surface that shares one render core, is engine-served and Pages-deployable.

**Architecture:** Extract the board card's render logic into `shared/presence-card.js` (pure helpers + one DOM render fn) plus a canonical `shared/presence-vocab.js` (parity-tested against the board copy). Build `studio/presence.html` that renders via the shared core and includes a local playground (intents × data-type × urgency) so it works with no board and no engine; a best-effort relative `/api/presence` poll reflects real presence when the origin serves it. Web-only, additive — no firmware/board/engine changes.

**Tech Stack:** Vanilla ESM (browser + node `--test`), the existing `shared/` + `studio/` patterns, `scripts/build-pages.mjs` (already copies `studio/`+`shared/`).

## Global Constraints

- All work stays on branch `feat/expression-studio` — **no merge** (repo cut is the arc's final step).
- **Web-only, additive:** do NOT modify firmware, `esp32_matrix_webserver/data/`, or the engine (TypeScript). The board's `data/presence-card.html` stays untouched and keeps working.
- **One render core:** the new surface imports `shared/presence-card.js`; do NOT copy-paste the board's render logic into the page.
- The new `shared/presence-vocab.js` must stay content-identical to `esp32_matrix_webserver/data/presence-vocab.js` (parity test enforces).
- Never use the maintainer's real name in any emitted file (refer to "the user").
- `pages-dist/` stays gitignored; the surface ships via the existing build-pages copy (no build-script change needed beyond verification).
- Spec: `docs/superpowers/specs/2026-06-27-presence-card-web-surface-design.md`.

---

### Task 1: Shared render core + vocab + parity

**Files:**
- Create: `shared/presence-vocab.js`
- Create: `shared/presence-card.js`
- Test: `shared/presence-vocab.test.js`
- Test: `shared/presence-card.test.js`

**Interfaces:**
- Produces (from `shared/presence-vocab.js`): `PRESENCE_VOCAB` (10 intents → `{label,glyph,color,motion}`), `GENERIC`.
- Produces (from `shared/presence-card.js`): `vocabFor(vocab, intent)`, `dataBlock(data) -> {kind:"progress"|"values"|"series"|"none", ...}`, `sparklinePoints(series, w, h) -> string`, `motionClass(entry, urgency) -> string`, `formatAge(tsSeconds, nowMs) -> string`, `renderPresenceCard(el, msg, vocab)` (DOM).

- [ ] **Step 1: Write the failing tests**

Create `shared/presence-card.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { vocabFor, dataBlock, sparklinePoints, motionClass, formatAge } from "./presence-card.js";
import { PRESENCE_VOCAB, GENERIC } from "./presence-vocab.js";

test("vocabFor returns the entry, GENERIC on miss", () => {
  assert.equal(vocabFor(PRESENCE_VOCAB, "working"), PRESENCE_VOCAB.working);
  assert.equal(vocabFor(PRESENCE_VOCAB, "nope"), GENERIC);
});

test("dataBlock classifies each PresenceData shape", () => {
  assert.deepEqual(dataBlock(null), { kind: "none" });
  assert.deepEqual(dataBlock({}), { kind: "none" });
  assert.deepEqual(dataBlock({ progress: 0.5 }), { kind: "progress", pct: 50 });
  assert.deepEqual(dataBlock({ progress: 2 }), { kind: "progress", pct: 100 }); // clamped
  assert.deepEqual(dataBlock({ progress: -1 }), { kind: "progress", pct: 0 });  // clamped
  const vb = dataBlock({ values: [{ value: 7 }] });
  assert.equal(vb.kind, "values"); assert.equal(vb.values.length, 1);
  const sb = dataBlock({ series: [1, 2, 3], label: "x", unit: "k" });
  assert.equal(sb.kind, "series"); assert.deepEqual(sb.series, [1, 2, 3]);
  assert.equal(sb.label, "x"); assert.equal(sb.unit, "k");
});

test("sparklinePoints yields one point per sample inside the box", () => {
  const pts = sparklinePoints([1, 2, 3, 4], 300, 50).split(" ");
  assert.equal(pts.length, 4);
  for (const p of pts) {
    const [x, y] = p.split(",").map(Number);
    assert.ok(x >= 0 && x <= 300, `x in box: ${x}`);
    assert.ok(y >= 0 && y <= 50, `y in box: ${y}`);
  }
});

test("motionClass composes motion + urgency, urgency defaults ambient", () => {
  assert.equal(motionClass({ motion: "pulse" }, "notice"), "m-pulse u-notice");
  assert.equal(motionClass({ motion: "pulse" }), "m-pulse u-ambient");
  assert.equal(motionClass({}, undefined), "m-none u-ambient");
});

test("formatAge: dash / seconds / minutes", () => {
  assert.equal(formatAge(0, Date.now()), "—");
  assert.equal(formatAge(1000, 1000 * 1000 + 12_000), "12s ago");
  assert.equal(formatAge(1000, 1000 * 1000 + 125_000), "2m ago");
});
```

Create `shared/presence-vocab.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESENCE_VOCAB } from "./presence-vocab.js";
import { PRESENCE_VOCAB as BOARD_VOCAB } from "../esp32_matrix_webserver/data/presence-vocab.js";

test("shared presence vocab matches the board's copy (no drift)", () => {
  assert.deepEqual(Object.keys(PRESENCE_VOCAB).sort(), Object.keys(BOARD_VOCAB).sort());
  for (const k of Object.keys(BOARD_VOCAB)) {
    assert.deepEqual(PRESENCE_VOCAB[k], BOARD_VOCAB[k], `intent ${k} differs from the board copy`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test shared/presence-card.test.js shared/presence-vocab.test.js`
Expected: FAIL — `Cannot find module './presence-card.js'` / `'./presence-vocab.js'`.

- [ ] **Step 3: Create `shared/presence-vocab.js`**

The values are copied verbatim from `esp32_matrix_webserver/data/presence-vocab.js` (do not invent — the parity test compares them):

```js
// shared/presence-vocab.js — canonical web copy of the presence card's intent -> appearance
// table (the 10 PresenceMessage intents in mcp_server/presence.ts). Kept content-identical to
// esp32_matrix_webserver/data/presence-vocab.js (the board's copy); the parity test enforces it.
// glyph = a single char drawn large; color = CSS hex; motion = a CSS animation key.
export const PRESENCE_VOCAB = {
  working:   { label: "Working",   glyph: "◐", color: "#e0a020", motion: "pulse" },
  thinking:  { label: "Thinking",  glyph: "…", color: "#3a78d0", motion: "shimmer" },
  done:      { label: "Done",      glyph: "✓", color: "#33c06a", motion: "settle" },
  ok:        { label: "OK",        glyph: "✓", color: "#33c06a", motion: "none" },
  celebrate: { label: "Celebrate", glyph: "✦", color: "#d24bd2", motion: "burst" },
  alert:     { label: "Needs you", glyph: "!", color: "#e0a020", motion: "blink" },
  error:     { label: "Error",     glyph: "✗", color: "#e0473c", motion: "blink" },
  question:  { label: "Question",  glyph: "?", color: "#3a78d0", motion: "pulse" },
  info:      { label: "Info",      glyph: "i", color: "#7a8aa0", motion: "none" },
  idle:      { label: "Idle",      glyph: "z", color: "#46506a", motion: "breathe" },
};

export const GENERIC = { label: "Status", glyph: "○", color: "#7a8aa0", motion: "none" };
```

> NOTE to implementer: open `esp32_matrix_webserver/data/presence-vocab.js` and confirm each
> glyph character matches byte-for-byte (they are unicode: `◐ … ✓ ✦ ✗`). If any differ, the
> board file is the source of truth — copy from it. The parity test is your check.

- [ ] **Step 4: Create `shared/presence-card.js`**

```js
// shared/presence-card.js — the web presence-card render core. Pure helpers (unit-tested) +
// one DOM render fn (renderPresenceCard), factored out of the board's presence-card.html so the
// Studio web surface (studio/presence.html) shares one implementation rather than a third copy.
import { GENERIC } from "./presence-vocab.js";

// Intent -> appearance lookup, GENERIC on miss (never blank).
export function vocabFor(vocab, intent) {
  return (vocab && vocab[intent]) || GENERIC;
}

// Classify a PresenceData (one of progress/values/series) into a plain model for the DOM layer.
export function dataBlock(data) {
  if (!data || typeof data !== "object") return { kind: "none" };
  if ("progress" in data) {
    const pct = Math.round(Math.max(0, Math.min(1, Number(data.progress) || 0)) * 100);
    return { kind: "progress", pct };
  }
  if ("values" in data && Array.isArray(data.values)) {
    return { kind: "values", values: data.values };
  }
  if ("series" in data && Array.isArray(data.series)) {
    return { kind: "series", series: data.series, label: data.label, unit: data.unit };
  }
  return { kind: "none" };
}

// SVG polyline points for a min/max-normalized sparkline in a w×h box (3px vertical padding).
export function sparklinePoints(series, w, h) {
  const n = series.length;
  const min = Math.min(...series), max = Math.max(...series), span = (max - min) || 1;
  return series.map((v, i) =>
    `${(i / Math.max(1, n - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(" ");
}

// The "m-<motion> u-<urgency>" class the card element carries (urgency defaults to ambient).
export function motionClass(entry, urgency) {
  return `m-${(entry && entry.motion) || "none"} u-${urgency || "ambient"}`;
}

// "Ns ago" / "Nm ago" / "—". tsSeconds is unix-seconds (0/falsey => "—").
export function formatAge(tsSeconds, nowMs) {
  if (!tsSeconds) return "—";
  const s = Math.max(0, Math.floor(nowMs / 1000) - tsSeconds);
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

// DOM render: write a PresenceMessage into a card element that contains
// .glyph .label .headline .detail .intent .data nodes. Sets --accent + the motion class on `el`.
export function renderPresenceCard(el, msg, vocab) {
  const v = vocabFor(vocab, msg.intent);
  el.style.setProperty("--accent", v.color);
  const set = (sel, txt) => { const n = el.querySelector(sel); if (n) n.textContent = txt; };
  set(".glyph", v.glyph);
  set(".label", v.label);
  set(".headline", msg.headline ?? "");
  set(".detail", msg.detail ?? "");
  set(".intent", msg.intent);
  const cls = motionClass(v, msg.urgency);
  if (el.className !== cls) el.className = cls;
  renderDataInto(el.querySelector(".data"), dataBlock(msg.data));
}

function renderDataInto(box, block) {
  if (!box) return;
  box.innerHTML = "";
  if (block.kind === "progress") {
    box.innerHTML = `<div class="bar"><i style="width:${block.pct}%"></i></div>` +
      `<div class="readout"><span class="v">${block.pct}%</span></div>`;
  } else if (block.kind === "values") {
    const row = document.createElement("div"); row.className = "readouts";
    for (const r of block.values) {
      const cell = document.createElement("div"); cell.className = "readout";
      const vEl = document.createElement("span"); vEl.className = "v"; vEl.textContent = String(r.value);
      if (r.unit) { const u = document.createElement("small"); u.textContent = r.unit; vEl.appendChild(u); }
      cell.appendChild(vEl);
      if (r.label) { const lEl = document.createElement("span"); lEl.className = "l"; lEl.textContent = r.label; cell.appendChild(lEl); }
      row.appendChild(cell);
    }
    box.appendChild(row);
  } else if (block.kind === "series") {
    if (block.label || block.unit) {
      const cap = document.createElement("div"); cap.className = "readout"; cap.style.marginBottom = "4px";
      const lEl = document.createElement("span"); lEl.className = "l";
      lEl.textContent = `${block.label ?? ""} ${block.unit ? `(${block.unit})` : ""}`.trim();
      cap.appendChild(lEl); box.appendChild(cap);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "spark"); svg.setAttribute("viewBox", "0 0 320 56");
    svg.innerHTML = `<polyline fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linejoin="round" stroke-linecap="round" points="${sparklinePoints(block.series, 320, 56)}" />`;
    box.appendChild(svg);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test shared/presence-card.test.js shared/presence-vocab.test.js`
Expected: PASS — all assertions green (parity confirms shared ≡ board).

- [ ] **Step 6: Commit**

```bash
git add shared/presence-vocab.js shared/presence-card.js shared/presence-vocab.test.js shared/presence-card.test.js
git commit -m "feat(presence): shared web render core + vocab for the presence card"
```

---

### Task 2: The surface — `studio/presence.html` + playground

**Files:**
- Create: `studio/presence-samples.js`
- Create: `studio/presence.html`
- Test: `studio/presence.test.js`
- Modify: `studio/studio-nav.js` (add the "Presence" entry to `PAGES`)

**Interfaces:**
- Consumes: `shared/presence-card.js` (`renderPresenceCard`), `shared/presence-vocab.js` (`PRESENCE_VOCAB`).
- Produces (from `studio/presence-samples.js`): `sampleData(kind) -> PresenceData | undefined` for kind in `"none"|"progress"|"values"|"series"`.

- [ ] **Step 1: Write the failing test**

Create `studio/presence.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleData } from "./presence-samples.js";

test("sampleData returns the right PresenceData per kind", () => {
  assert.equal(sampleData("none"), undefined);
  assert.equal(sampleData("progress").progress, 0.62);
  const v = sampleData("values");
  assert.ok(Array.isArray(v.values) && v.values.length >= 1 && v.values.length <= 3);
  const s = sampleData("series");
  assert.ok(Array.isArray(s.series) && s.series.length >= 1 && s.series.length <= 32);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test studio/presence.test.js`
Expected: FAIL — `Cannot find module './presence-samples.js'`.

- [ ] **Step 3: Create `studio/presence-samples.js`**

```js
// studio/presence-samples.js — fixed sample PresenceData for the presence playground's
// data-type selector. Pure; unit-tested. Shapes match mcp_server/presence.ts PresenceData.
export function sampleData(kind) {
  switch (kind) {
    case "progress": return { progress: 0.62 };
    case "values":   return { values: [
      { value: 72, unit: "°F", label: "temp" },
      { value: 41, unit: "%", label: "humidity" },
    ] };
    case "series":   return { series: [3, 5, 4, 8, 6, 9, 7, 11, 10, 13], label: "tokens", unit: "k" };
    default:         return undefined; // "none"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test studio/presence.test.js`
Expected: PASS.

- [ ] **Step 5: Add the "Presence" nav entry**

In `studio/studio-nav.js`, the `PAGES` array currently is:

```js
const PAGES = [
  { file: "index.html", label: "Gallery" },
  { file: "editor.html", label: "Editor" },
  { file: "board.html", label: "Board" },
];
```

Add a fourth entry so it becomes:

```js
const PAGES = [
  { file: "index.html", label: "Gallery" },
  { file: "editor.html", label: "Editor" },
  { file: "board.html", label: "Board" },
  { file: "presence.html", label: "Presence" },
];
```

- [ ] **Step 6: Create `studio/presence.html`**

The page renders the card via the shared core and drives it with a local playground. (Live
polling is added in Task 3 — do NOT add fetch here.)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Presence — Expression Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#0a0a0e; --panel:#111118; --text:#e8e8ef; --dim:#9a9aa8; --faint:#5a5a68;
    --mono:'IBM Plex Mono',ui-monospace,monospace; --sans:'IBM Plex Sans',system-ui,sans-serif;
    --cyan:#22ddff; --accent:#46506a; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:var(--sans);
    padding:0 0 80px; line-height:1.5; }
  .wrap { max-width:880px; margin:0 auto; padding:28px 24px; }
  h1 { font-family:var(--mono); font-size:1.25rem; margin:0 0 4px; }
  .sub { color:var(--dim); font-size:.86rem; margin:0 0 24px; max-width:62ch; }
  .stage { display:grid; grid-template-columns:1fr; gap:22px; }
  @media (min-width:680px){ .stage { grid-template-columns:360px 1fr; } }

  /* ── The card (mirrors the board's presence-card visual) ── */
  #card { min-height:230px; display:grid; grid-template-rows:auto 1fr auto; gap:10px;
    padding:18px 20px; border-radius:14px; border:1px solid #1c1c24;
    background:radial-gradient(120% 90% at 30% 0%, color-mix(in srgb, var(--accent) 28%, #0c0e14), #0c0e14); }
  #card .top { display:flex; align-items:center; gap:14px; }
  #card .glyph { font-size:52px; line-height:1; color:var(--accent);
    text-shadow:0 0 18px color-mix(in srgb, var(--accent) 60%, transparent); }
  #card .headline { font-size:20px; font-weight:650; }
  #card .label { font-size:12px; letter-spacing:.12em; text-transform:uppercase;
    color:color-mix(in srgb, var(--accent) 70%, var(--text)); }
  #card .detail { color:#aeb6c8; font-size:14px; }
  #card .data { display:flex; flex-direction:column; gap:8px; justify-content:center; }
  #card .bar { height:14px; border-radius:7px; background:#1c2030; overflow:hidden; }
  #card .bar > i { display:block; height:100%; background:var(--accent); border-radius:7px; transition:width .4s ease; }
  #card .readouts { display:flex; gap:18px; flex-wrap:wrap; }
  #card .readout { display:flex; flex-direction:column; }
  #card .readout .v { font-size:26px; font-weight:650; font-variant-numeric:tabular-nums; }
  #card .readout .l { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#8b94a8; }
  #card .spark { width:100%; height:56px; display:block; color:var(--accent); }
  #card .foot { display:flex; justify-content:space-between; font-size:11px; color:#6b7488; }
  /* motion (keyed off the card's class set by renderPresenceCard) */
  @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.55} }
  @keyframes shimmer{ 0%,100%{opacity:.7} 50%{opacity:1} }
  @keyframes blink  { 0%,49%{opacity:1} 50%,100%{opacity:.2} }
  @keyframes breathe{ 0%,100%{opacity:.45} 50%{opacity:.75} }
  @keyframes burst  { 0%{transform:scale(1)} 30%{transform:scale(1.18)} 100%{transform:scale(1)} }
  @keyframes settle { 0%{transform:scale(1.18)} 100%{transform:scale(1)} }
  #card.m-pulse   .glyph { animation:pulse 1.4s ease-in-out infinite; }
  #card.m-shimmer .glyph { animation:shimmer 2s ease-in-out infinite; }
  #card.m-blink   .glyph { animation:blink .7s steps(1) infinite; }
  #card.m-breathe .glyph { animation:breathe 3.5s ease-in-out infinite; }
  #card.m-burst   .glyph { animation:burst .8s ease-out; }
  #card.m-settle  .glyph { animation:settle .5s ease-out; }
  #card.u-notice { animation:pulse 2.4s ease-in-out infinite; }
  #card.u-urgent { animation:blink 1s steps(1) infinite; }
  @media (prefers-reduced-motion:reduce){ #card, #card .glyph { animation:none !important; } }

  /* ── Playground ── */
  .pg { background:var(--panel); border:1px solid #1c1c24; border-radius:14px; padding:16px 18px; }
  .pg h2 { font-family:var(--mono); font-size:.7rem; letter-spacing:.16em; text-transform:uppercase;
    color:var(--faint); margin:0 0 12px; }
  .pg .row { margin-bottom:16px; }
  .pg .row > .rl { font-size:.7rem; letter-spacing:.1em; text-transform:uppercase; color:var(--dim); margin-bottom:7px; }
  .chips { display:flex; flex-wrap:wrap; gap:7px; }
  .chip { font:inherit; font-size:.78rem; cursor:pointer; color:var(--dim); background:#15151b;
    border:1px solid #2a2a34; border-radius:7px; padding:4px 11px; }
  .chip:hover { color:var(--text); }
  .chip.on { color:var(--cyan); border-color:#22ddff66; background:#22ddff14; }
  .hint { color:var(--faint); font-size:.72rem; margin-top:14px; }
</style>
</head>
<body>
<script type="module" src="./studio-nav.js"></script>
<div class="wrap">
  <h1>Presence</h1>
  <p class="sub">Claude's semantic status, rendered the same way everywhere from one
    <code>PresenceMessage</code>. This is the desktop card — board-independent. Drive it below,
    or flip on Live to mirror a real board's <code>/api/presence</code>.</p>

  <div class="stage">
    <div id="card" class="m-breathe u-ambient">
      <div class="top">
        <div class="glyph">z</div>
        <div>
          <div class="label">Idle</div>
          <div class="headline"></div>
        </div>
      </div>
      <div class="data"></div>
      <div>
        <div class="detail"></div>
        <div class="foot"><span class="intent">idle</span><span class="age">—</span></div>
      </div>
    </div>

    <div class="pg">
      <h2>Playground</h2>
      <div class="row">
        <div class="rl">Intent</div>
        <div class="chips" id="intents"></div>
      </div>
      <div class="row">
        <div class="rl">Data</div>
        <div class="chips" id="datakinds"></div>
      </div>
      <div class="row">
        <div class="rl">Urgency</div>
        <div class="chips" id="urgencies"></div>
      </div>
      <div class="hint" id="hint">Self-driven demo — no board or engine required.</div>
    </div>
  </div>
</div>

<script type="module">
import { renderPresenceCard } from "../shared/presence-card.js";
import { PRESENCE_VOCAB } from "../shared/presence-vocab.js";
import { sampleData } from "./presence-samples.js";

const cardEl = document.getElementById("card");
const state = { intent: "idle", dataKind: "none", urgency: "ambient" };

const INTENTS = Object.keys(PRESENCE_VOCAB);
const DATAKINDS = ["none", "progress", "values", "series"];
const URGENCIES = ["ambient", "notice", "urgent"];

const HEADLINES = {
  working: "Refactoring the resolver", thinking: "Weighing two approaches",
  done: "All tests green", ok: "Got it", celebrate: "Shipped v1.0",
  alert: "Need your call on the schema", error: "Build failed",
  question: "Which port should I use?", info: "Synced 12 files", idle: "",
};

function buildMsg() {
  return {
    intent: state.intent,
    headline: HEADLINES[state.intent] ?? "",
    detail: state.dataKind === "none" ? "" : `demo · ${state.dataKind}`,
    data: sampleData(state.dataKind),
    urgency: state.urgency,
  };
}

const apply = () => renderPresenceCard(cardEl, buildMsg(), PRESENCE_VOCAB);

function chips(host, items, key) {
  const el = document.getElementById(host);
  el.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.className = "chip" + (state[key] === it ? " on" : "");
    b.textContent = it;
    b.onclick = () => {
      state[key] = it;
      for (const c of el.children) c.classList.toggle("on", c.textContent === it);
      apply();
    };
    el.appendChild(b);
  }
}

chips("intents", INTENTS, "intent");
chips("datakinds", DATAKINDS, "dataKind");
chips("urgencies", URGENCIES, "urgency");
apply();
window.__presenceApply = apply; // hook for Task 3's live toggle
</script>
</body>
</html>
```

- [ ] **Step 7: Verify the page is well-formed and the nav has 4 entries**

Run: `node --test studio/presence.test.js` (still PASS) and
`node -e "const s=require('fs').readFileSync('studio/studio-nav.js','utf8'); if(!s.includes('presence.html'))process.exit(1); console.log('nav has presence')"`
Expected: test PASS; prints `nav has presence`.

- [ ] **Step 8: Commit**

```bash
git add studio/presence-samples.js studio/presence.html studio/presence.test.js studio/studio-nav.js
git commit -m "feat(presence): studio/presence.html surface + playground, nav entry"
```

---

### Task 3: Best-effort live mode + Pages wiring + full suite

**Files:**
- Modify: `studio/presence.html` (add the Live toggle + best-effort poll)

**Interfaces:**
- Consumes: `window.__presenceApply` (Task 2) to restore the playground render when Live is off; `/api/presence` (relative, best-effort).

- [ ] **Step 1: Add `formatAge` to the top import**

In `studio/presence.html`, change the first import line:

```js
import { renderPresenceCard } from "../shared/presence-card.js";
```

to also pull in `formatAge` (used by the live age line):

```js
import { renderPresenceCard, formatAge } from "../shared/presence-card.js";
```

- [ ] **Step 2: Add the Live toggle markup**

In `studio/presence.html`, inside the `.pg` playground panel, add a Live row as the FIRST `.row` (immediately after `<h2>Playground</h2>`):

```html
      <div class="row">
        <div class="rl">Source</div>
        <div class="chips"><button class="chip" id="livebtn">○ Live (board)</button></div>
      </div>
```

- [ ] **Step 3: Add the best-effort poll logic**

In the page's `<script type="module">`, replace the final two lines:

```js
apply();
window.__presenceApply = apply; // hook for Task 3's live toggle
```

with (note: `formatAge` is already imported at the top from Step 1 — do NOT re-import it here):

```js
apply();

// ── Best-effort live mode ── poll a real /api/presence on this origin (the board today, or a
// future presence-proxying engine). Any failure (404/unreachable — e.g. engine/Pages) silently
// keeps the playground render; no error surfaces. Toggling off restores the playground.
const liveBtn = document.getElementById("livebtn");
const ageEl = cardEl.querySelector(".age");
let live = false, timer = null, ageTimer = null, lastTs = 0;

async function poll() {
  if (document.hidden) return;
  try {
    const r = await fetch("/api/presence", { cache: "no-store" });
    if (r.ok) {
      const m = await r.json();
      renderPresenceCard(cardEl, m, PRESENCE_VOCAB);
      lastTs = Number(m.ts) > 1e9 ? Number(m.ts) : 0;
    }
  } catch { /* unreachable — keep last render */ }
}
function tickAge() { ageEl.textContent = live ? formatAge(lastTs, Date.now()) : "—"; }

liveBtn.onclick = () => {
  live = !live;
  liveBtn.classList.toggle("on", live);
  liveBtn.textContent = (live ? "● " : "○ ") + "Live (board)";
  document.getElementById("hint").textContent = live
    ? "Polling /api/presence on this origin — falls back to the demo if none."
    : "Self-driven demo — no board or engine required.";
  if (live) { poll(); timer = setInterval(poll, 1500); ageTimer = setInterval(tickAge, 1000); }
  else {
    clearInterval(timer); clearInterval(ageTimer); timer = ageTimer = null;
    lastTs = 0; ageEl.textContent = "—"; apply(); // restore playground render
  }
};
window.__presenceApply = apply;
```

(The replacement consumes the old trailing `apply();` + `window.__presenceApply = apply;`, so `window.__presenceApply` ends up assigned exactly once, at the very end.)

- [ ] **Step 4: Verify the Pages bundle includes the surface**

Run: `node scripts/build-pages.mjs && node -e "const f=require('fs');for(const p of ['studio/presence.html','studio/presence-samples.js','shared/presence-card.js','shared/presence-vocab.js']){if(!f.existsSync('pages-dist/'+p)){console.error('MISSING '+p);process.exit(1)}}console.log('bundle has presence surface')"`
Expected: prints `bundle has presence surface`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green. Prior count was 222; this plan adds 7 tests (Task 1: 5 in presence-card.test.js + 1 in presence-vocab.test.js = 6; Task 2: 1 in presence.test.js) → **229 passing**. `check-manifest` `OK`, `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add studio/presence.html
git commit -m "feat(presence): best-effort live /api/presence mode on the surface"
```

---

## Notes for the executor

- **Do NOT touch** firmware, `esp32_matrix_webserver/data/`, or the engine (TypeScript). This
  increment is web-only; the board's presence card stays as-is.
- **Do NOT start a server on port 8787** (the user's own engine). The controller will run the
  read-only/live-degradation smoke on a throwaway port after Task 3.
- The motion CSS lives in `presence.html` (presentation); the shared core only emits the class
  string via `motionClass`. That split is intentional — don't move CSS into `shared/`.
- If the parity test (Task 1) fails on a glyph mismatch, the board file
  `esp32_matrix_webserver/data/presence-vocab.js` is the source of truth.
