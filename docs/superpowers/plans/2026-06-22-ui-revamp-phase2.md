# UI Revamp — Phase 2 (Animations section + IA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]`.

**Goal:** Make the animations section consistent — extract the shared preview engine + palette tables into `previews.js`/`palettes.js`, give every animation its own Elevated page, turn `animations.html` into a pure grid hub, and add the Weather sub-hub — all on the Phase-1 foundation.

**Architecture:** `animations.html` currently inlines 12 animations (shared JS preview engine + 64-palette table, switched by `?type=`) and 5 others are standalone pages. Extract the inline engine → `previews.js` and the palette/preset tables → `palettes.js`; build 12 new per-animation pages on the Phase-1 shell that consume them; re-shell the 5 standalone pages (which keep their own bespoke sim engines); convert `animations.html` to a grid hub. Build the Weather sub-hub similarly.

**Tech Stack:** Static HTML/CSS/vanilla JS on LittleFS. Uses Phase-1 `app.css` + `backnav.js`. **No firmware change.**

## Global Constraints

- Web/LittleFS only — no `.ino` change. One LittleFS upload at end of phase.
- Distributable repo: "the user", never the real name.
- Every new/changed page: links `app.css`, favicon, `header.js` + `backnav.js` (parent `/animations.html` for animation pages), full-strength preview, debounced (~180ms) default-on live-apply, mobile-first.
- **Animation pages do NOT mount `bright.js`** is wrong → they DO (control pages get brightness). **Sub-hubs (`animations.html`, the Weather hub) do NOT mount `bright.js`.**
- Preview parity: the extracted `previews.js` must render identical math to today's inline engine (it's a JS mirror of the firmware) — do not "improve" the sim, just relocate it.

## File Structure

- **Create `data/palettes.js`** — `window.DF_PAL` (64 palettes), `window.FW_PRESETS`, `window.FB_PRESETS`, `window.SUN_PRESETS`. Pure data + the swatch-grid builder helpers. One responsibility: shared palette data/UI.
- **Create `data/previews.js`** — the canvas preview engine for the 12 simple animations: the driver (`startPreview`/`tickPreview`/`stepPreview`/`drawPrevGrid`/`initPrevState`) + every `stepPrev*` + per-anim state. Exposes `window.MatrixPreview = { start(canvas, type), stop() }`. One responsibility: previews.
- **Create 12 pages:** `rainbow.html`, `breathe.html`, `wave.html`, `solid.html`, `spiral.html`, `starfield.html`, `frostbite.html`, `fireworks.html`, `fireworks2.html`, `comet.html`, `sun.html`, `dancefloor.html`. Each: shell + its control panel (lifted from the matching `panel-*` in animations.html) + `previews.js` + its `buildPayload` slice.
- **Modify 5 standalone pages:** `liquid.html`, `matrix_rain.html`, `snow.html`, `claudesweep.html` — re-shell onto `app.css`/`backnav.js` (keep their own inline sim engines).
- **Modify `animations.html`** → pure grid hub (uniform `.card` grid linking all 17, `backnav` to Home, NO inline controls/engine/brightness).
- **Weather sub-hub:** new `weather.html` (hub, 2 cards) + rename today's `weather.html`→`weather-classic.html` and `weather2.html`→`weather-dual.html` (re-shelled); update `index.html` (single Weather card → `/weather.html`).
- **Modify `index.html`:** Weather card already present; point it at the sub-hub; remove the separate Weather 2 card.

---

## Task 1: Extract `palettes.js`

**Files:** Create `data/palettes.js`; Modify `data/animations.html`.

- [ ] **Step 1:** Move `DF_PAL` (animations.html:842-907), `FW_PRESETS` (:1024-1035), `FB_PRESETS` (:1069-1076), `SUN_PRESETS` (:1095-1101) into `palettes.js` as `window.DF_PAL = [...]` etc. Keep the swatch-grid builder helpers (`buildFwPresetGrid`) too if shared; otherwise leave per-page.
- [ ] **Step 2:** In `animations.html`, delete those literals and add `<script src="palettes.js"></script>` before its inline script; reference `DF_PAL` etc. via the globals.
- [ ] **Step 3 (verify):** local threaded server + Playwright — load `animations.html?type=dancefloor`, confirm `window.DF_PAL.length===64`, no console errors, the dancefloor preview still animates (canvas lit pixels > 0).
- [ ] **Step 4:** Commit `feat(ui): extract palettes.js (DF_PAL + preset tables)`.

## Task 2: Extract `previews.js`

**Files:** Create `data/previews.js`; Modify `data/animations.html`.

- [ ] **Step 1:** Move the preview driver + all `stepPrev*` + per-anim state + `initPrevState` (animations.html ~:436-839) into `previews.js`, wrapped as `window.MatrixPreview = { start(canvasEl, type), stop() }` (start = today's `startPreview` bound to a passed canvas; keep the 66ms interval). It reads control values by element id exactly as today (so a page just needs the same input ids).
- [ ] **Step 2:** In `animations.html`, delete the moved code, add `<script src="previews.js"></script>`, and call `MatrixPreview.start(getEl('prev'), type)` where `startPreview` was called.
- [ ] **Step 3 (verify):** Playwright on `animations.html?type=fireworks` and `?type=rainbow` — previews animate, no console errors, framebuffer unaffected (this page still drives the board via its own buildPayload).
- [ ] **Step 4:** Commit `feat(ui): extract previews.js (shared canvas preview engine)`.

## Task 3: Animation page template + `rainbow.html`

**Files:** Create `data/rainbow.html`.

- [ ] **Step 1:** Build `rainbow.html` on the Phase-1 shell: head (favicon + app.css), `.wrap` with `--accent-page:#c98bff`, `<h1>🌈 Rainbow</h1>`, a `.panel` with `.layout` (`.preview-frame` canvas#prev + `.controls`), the rainbow control panel markup lifted from `panel-rainbow` (Mode chips + palette grid) wrapped in a `.subcard`, `.actions` (Apply/Stop + `.live-dot`), status. Scripts: `palettes.js`, `previews.js`, then a small inline script that wires the controls + a `buildPayload()` (the rainbow slice from animations.html:1172-1175) + debounced `liveApply` + `MatrixPreview.start(canvas,'rainbow')`, then `backnav.js`(parent `/animations.html`), `bright.js`, `header.js`.
- [ ] **Step 2 (verify):** local server + Playwright — back-pill "← Animations", preview animates, no console errors, mobile reflow; then on the REAL board after a later upload, confirm Apply drives `animation:rainbow`.
- [ ] **Step 3:** Commit `feat(ui): rainbow.html (own page) — animation-page template`.

## Task 4: The remaining 11 inline-animation pages

**Files:** Create `breathe/wave/solid/spiral/starfield/frostbite/fireworks/fireworks2/comet/sun/dancefloor.html`.

Each follows the Task-3 template exactly. Per page, lift: the `panel-*` control markup, the `buildPayload` branch (animations.html:1176-1203), the matching emoji/title, and any preset-grid wiring (frostbite/sun presets, fireworks preset grid). Accent `--accent-page:#c98bff` for all (animations section), or the page's natural hue if it has one.

- [ ] **Step 1:** Create all 11 pages from the template (one commit per ~3-4 pages is fine).
- [ ] **Step 2 (verify):** Playwright loop over each new page — no console errors, `.bn-pill` present, canvas lit > 0, `.subcard` present, mobile reflow OK.
- [ ] **Step 3:** Commit(s) `feat(ui): <names>.html own pages`.

## Task 5: Re-shell the 5 standalone pages

**Files:** Modify `liquid.html`, `matrix_rain.html`, `snow.html`, `claudesweep.html` (fire.html already done in Phase 1).

- [ ] **Step 1:** For each: swap inline `<style>`→`app.css` + favicon, `.wrap --accent-page` (page hue), replace the `.back` link with `backnav.js` (parent `/animations.html`), wrap controls in `.subcard`/`.subhead`, framed preview, default-on debounced live-apply (convert any existing autosync), `.live-dot`. Keep each page's own sim engine + apply/stop logic.
- [ ] **Step 2 (verify):** Playwright each — no errors, back-pill, preview animates, mobile.
- [ ] **Step 3:** Commit `feat(ui): re-shell liquid/matrix_rain/snow/claudesweep onto app.css`.

## Task 6: `animations.html` → pure grid hub

**Files:** Modify `data/animations.html`.

- [ ] **Step 1:** Replace the whole page with a hub: head (app.css + favicon), `.wrap`, `<h1>🌈 Animations</h1>`, a `.apps` grid of 17 uniform `.card` link-outs (each → its new page), `backnav.js`(Home), `header.js`. **No** inline controls, **no** previews/palettes scripts, **no** `bright.js`.
- [ ] **Step 2 (verify):** Playwright — 17 cards, all uniform height, every card `href` resolves to an existing page, no console errors, no brightness widget present, mobile reflow.
- [ ] **Step 3:** Commit `feat(ui): animations.html → pure grid hub (17 cards, no inline controls)`.

## Task 7: Weather sub-hub

**Files:** Create `data/weather.html` (hub); Rename/modify `weather.html`→`weather-classic.html`, `weather2.html`→`weather-dual.html`; Modify `index.html`.

- [ ] **Step 1:** `git mv weather.html weather-classic.html` and `git mv weather2.html weather-dual.html`; re-shell both onto app.css/backnav (parent `/weather.html`), keep their logic + ZIP/units.
- [ ] **Step 2:** Create `weather.html` as a sub-hub: header, backnav(Home), `<h1>🌤️ Weather</h1>`, `.apps` grid with 2 cards ("Icon + Temp" → `/weather-classic.html`, "Dual Display" → `/weather-dual.html`). No `bright.js`.
- [ ] **Step 3:** In `index.html`, point the Weather card at `/weather.html` and remove the separate Weather 2 card.
- [ ] **Step 4 (verify):** Playwright — index Weather card → hub → both leaves load; cards uniform; back-pills correct.
- [ ] **Step 5:** Commit `feat(ui): Weather sub-hub + weather-classic/weather-dual leaves`.

## Task 8: Deploy + review gate

- [ ] **Step 1:** Ask the user to upload `data/` to LittleFS (no flash).
- [ ] **Step 2 (verify, real board):** Playwright sweep — every animation page loads clean, Apply drives the right `animation:<type>` (spot-check 4-5 via framebuffer); animations hub + weather hub navigate correctly; brightness absent from sub-hubs.
- [ ] **Step 3 (human gate):** user spot-checks a few animation pages + the hubs on desktop + phone. Capture tweaks.
- [ ] **Step 4:** Restore board brightness/display. Proceed to Phase 3 plan.

## Self-Review

- **Spec coverage:** every-animation-own-page ✅ (T3/T4 + T5), previews.js/palettes.js extraction ✅ (T1/T2), animations.html→hub ✅ (T6), Weather sub-hub ✅ (T7), brightness off sub-hubs ✅ (T6/T7), uniform cards ✅ (Phase-1 `app.css`). Remaining non-animation control pages + system + sweep + bump → Phase 3.
- **Placeholders:** the repetitive pages reference the explicit Task-3 template + exact source line ranges to lift (panels + buildPayload slices) rather than re-dumping 17 files — appropriate for mechanical repetition with a proven template; each page's verification is concrete.
- **Consistency:** `MatrixPreview.start/stop`, `window.DF_PAL`, `app.css` classes, `backnav` data-attrs all trace to defined tasks/Phase-1.
