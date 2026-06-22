# UI Revamp — Phase 1 (Foundation + shell proof) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared design-system foundation (`app.css` + `backnav.js`) and prove the modernized "Elevated" look on two representative pages (the main hub `index.html` and one control page `fire.html`), ending in a hardware review gate before the mass migration.

**Architecture:** Promote the design system that is currently copy-pasted into each page's inline `<style>` into one linked `app.css` (CSS custom-property tokens + chrome classes + uniform card grid + Elevated sub-cards + responsive rules). Add a drop-in `backnav.js` back-pill (mirrors the existing `header.js`/`bright.js` auto-mount pattern). Convert two pages onto it as the proof; the remaining ~21 pages migrate in Phases 2–3.

**Tech Stack:** Static HTML/CSS/vanilla JS served from LittleFS. No build step, no framework, **no firmware change**. Existing shared scripts: `header.js`, `bright.js`, `ledsim.js`, `palette.js`.

## Global Constraints

- **Web/LittleFS only — no firmware (`.ino`) change.** If any task appears to need one, STOP and surface it.
- **Distributable repo:** never use the maintainer's real name in any file; refer to "the user."
- **Visual direction = "Elevated"** (from the approved spec + mockups): controls grouped into labeled sub-cards, larger framed full-strength preview, accent-tinted section headings; keep the dark identity (bg `#0d0d0d`, green `#00ff88`, amber `#ffb000`, animations-accent purple `#c98bff`).
- **Mobile-first responsive** is mandatory: every converted page must reflow to a clean single column with large tap targets at ≤480px.
- **Previews render full-strength on screen** — never dim the canvas with board brightness; the brightness slider POSTs to the board only.
- **Deploy = one LittleFS upload** at the end of the phase (the user runs it); Claude cannot flash/upload. Verify everything Claude *can* before the gate.

## Verification model (repo has NO unit-test harness)

This repo has no test framework; the calibration plans established the adaptation. Each task's "test" is an **executable verification** Claude can run against the live board at `http://esp32matrix.local`, plus an eyeball gate only where perception is required:
- **Playwright MCP** (`browser_navigate`, `browser_console_messages`, `browser_evaluate`, `browser_take_screenshot`, `browser_resize`) — load the page, assert **zero console errors**, drive controls, and check responsive reflow.
- **`curl` + `GET /api/display/framebuffer`** — prove a control actually changed the board (the framebuffer is the board's real `leds[]`).
- **Human eyeball** — only at the end-of-phase gate (desktop + phone).

> Because edits are to `data/` files served from LittleFS, **Claude's local edits are not live on the board until the user uploads.** Within a task, Playwright verification runs against the *currently uploaded* copy. To verify a single page mid-phase without a full upload, use Playwright `browser_evaluate` to inject the new file contents into the loaded DOM where practical; otherwise the real verification happens at the end-of-phase gate. Note this limitation in each task and lean on what is checkable (markup validity, no-JS-error structure, framebuffer round-trips for endpoints that are unchanged).

## File Structure

- **Create `esp32_matrix_webserver/data/app.css`** — the design system. One responsibility: all shared visual tokens + chrome. Linked by every page (this phase: `index.html`, `fire.html`).
- **Create `esp32_matrix_webserver/data/backnav.js`** — the back-pill breadcrumb component. One responsibility: render a prominent "← <parent>" link just under the header card, configured by `data-parent`/`data-label`.
- **Modify `esp32_matrix_webserver/data/index.html`** — drop the inline design `<style>`, link `app.css`, keep uniform cards + Quick Controls.
- **Modify `esp32_matrix_webserver/data/fire.html`** — re-shell onto `app.css` + `backnav.js` + Elevated sub-cards; keep its existing fire preview engine + apply/stop logic; standardize the live-apply indicator.

Shared `header.js`/`bright.js` are unchanged this phase (only their styling is now superseded where it overlaps — confirm no double-injection conflict).

---

## Task 1: `app.css` design system

**Files:**
- Create: `esp32_matrix_webserver/data/app.css`

**Interfaces:**
- Produces (CSS contract consumed by every later task/page):
  - Tokens on `:root`: `--bg:#0d0d0d`, `--surface:#161616`, `--surface-2:#121212`, `--border:#2a2a2a`, `--border-2:#242424`, `--text:#e0e0e0`, `--text-dim:#aaa`, `--text-faint:#666`, `--accent:#00ff88` (brand/green), `--amber:#ffb000`, `--cyan:#22ddff`, `--anim:#c98bff` (animations accent), `--ok:#00cc66`, `--err:#ff5555`, radii `--r:12px`/`--r-sm:8px`, space scale `--s1..--s5`, `--maxw:760px`.
  - Layout: `.wrap` (max-width `--maxw`, centered, padding).
  - Card grid: `.apps` (CSS grid, `repeat(auto-fill,minmax(150px,1fr))`, gap `--s2`) and `.card` (uniform: `min-height` + flex column so every card is the same height regardless of text length — fixes the Claude Sweep outlier). `.card .icon/.name/.desc`.
  - Panels: `.panel`, `.panel-title`; **Elevated** grouping: `.subcard` (inner card, `--surface-2`, `--border-2`) + `.subhead` (accent-tinted, `var(--anim)` by default, overridable via `--accent-page`).
  - Controls: `.row`, `label`, `input[type=range]` (accent-color `var(--accent-page,--accent)`), `input[type=color]`, `.btn`/`.btn-primary`/`.btn-secondary`/`.danger`, `.status`/`.status.err`, `.actions`.
  - Preview: `.preview-frame` (the framed wrapper) + `canvas.preview` (pixelated, full-strength) + `.preview-label`.
  - Live-apply indicator: `.live-dot` (a small dot + "applies live" text in `--ok`).
  - Per-page accent hook: a page sets `--accent-page` on `.wrap` (e.g. fire = `#ff6600`) and sliders/headings pick it up.
  - **Responsive:** at `max-width:480px` → `.wrap` padding shrinks, `.apps` becomes 2-col then 1-col, the control-page `.layout` stacks (preview above controls), tap targets ≥44px. At `max-width:360px` → `.apps` 1-col.

- [ ] **Step 1: Write `app.css`** with the tokens + classes above. Base the exact look on the approved Elevated mockups (`/.superpowers/brainstorm/1507-*/content/control-shell.html` / `navigation.html`). Use CSS custom properties for every color/space so the whole theme is tunable from `:root`. Keep it ≲ 250 lines, comment each section.

- [ ] **Step 2: Validate the CSS parses + tokens resolve.** Run a quick check that braces balance and there are no obvious syntax errors:

```bash
node -e "const c=require('fs').readFileSync('esp32_matrix_webserver/data/app.css','utf8');const o=(c.match(/{/g)||[]).length,p=(c.match(/}/g)||[]).length;if(o!==p)throw new Error('brace mismatch '+o+' vs '+p);if(!/--accent:/.test(c))throw new Error('missing tokens');console.log('app.css OK:',o,'rules')"
```

Expected: `app.css OK: <n> rules` (no throw).

- [ ] **Step 3: Commit.**

```bash
git add esp32_matrix_webserver/data/app.css
git commit -m "feat(ui): app.css shared design system (tokens + chrome + grid + responsive)"
```

---

## Task 2: `backnav.js` back-pill component

**Files:**
- Create: `esp32_matrix_webserver/data/backnav.js`

**Interfaces:**
- Consumes: nothing (self-contained; styles itself, like `header.js`).
- Produces: a drop-in script. Usage on a page: `<script src="backnav.js" data-auto data-parent="/animations.html" data-label="Animations"></script>`. With no `data-parent`, defaults to `href="/"`, label `Home`. Mounts the pill as the **second** child of `.wrap` (immediately after the `header.js` card). Idempotent.

- [ ] **Step 1: Write `backnav.js`.** Mirror the `header.js` IIFE/auto-mount pattern exactly (same structure for consistency):

```javascript
/* ============================================================
 * backnav.js — shared "back one level" pill (UI revamp Phase 1)
 * Drop-in, mirrors header.js:
 *   <script src="backnav.js" data-auto data-parent="/animations.html" data-label="Animations"></script>
 * Injects its own <style> and inserts a prominent back-pill right
 * AFTER the header card (so it reads as the page's back control,
 * not a tiny grey link). Defaults to Home. Idempotent.
 * ============================================================ */
(function (global) {
  'use strict';
  var CSS =
    '.bn-pill{display:inline-flex;align-items:center;gap:6px;background:#1c1c1c;' +
      'border:1px solid #333;border-radius:999px;padding:6px 14px;margin:0 0 16px;' +
      'color:#bdbdbd;text-decoration:none;font-size:.82rem;font-family:system-ui,-apple-system,sans-serif;' +
      'transition:border-color .15s,color .15s}' +
    '.bn-pill:hover{border-color:#555;color:#fff}' +
    '.bn-pill b{color:#e8e8e8;font-weight:600}';
  function injectStyleOnce() {
    if (document.getElementById('bn-style')) return;
    var s = document.createElement('style'); s.id = 'bn-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function markup(href, label) {
    return '<a class="bn-pill" href="' + href + '">← <b>' + label + '</b></a>';
  }
  function mount(opts) {
    opts = opts || {};
    if (document.querySelector('.bn-pill')) return; // idempotent
    injectStyleOnce();
    var host = document.querySelector('.wrap') || document.body;
    var tmp = document.createElement('div');
    tmp.innerHTML = markup(opts.parent || '/', opts.label || 'Home');
    var headerCard = host.querySelector('.mh-card');
    var node = tmp.firstChild;
    if (headerCard && headerCard.nextSibling) host.insertBefore(node, headerCard.nextSibling);
    else if (headerCard) host.appendChild(node);
    else host.insertBefore(node, host.firstChild);
  }
  global.MatrixBackNav = { mount: mount };
  var cs = document.currentScript;
  if (cs && cs.hasAttribute('data-auto')) {
    var opts = { parent: cs.getAttribute('data-parent'), label: cs.getAttribute('data-label') };
    var run = function () { mount(opts); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }
})(window);
```

- [ ] **Step 2: Sanity-check it parses as JS.**

```bash
node -e "require('fs').readFileSync('esp32_matrix_webserver/data/backnav.js','utf8');new Function(require('fs').readFileSync('esp32_matrix_webserver/data/backnav.js','utf8').replace('document.currentScript','null'));console.log('backnav.js parses OK')"
```

Expected: `backnav.js parses OK`.

- [ ] **Step 3: Commit.**

```bash
git add esp32_matrix_webserver/data/backnav.js
git commit -m "feat(ui): backnav.js shared back-pill breadcrumb component"
```

---

## Task 3: Convert `index.html` (main hub) onto the design system

**Files:**
- Modify: `esp32_matrix_webserver/data/index.html`

**Interfaces:**
- Consumes: `app.css` tokens/classes (Task 1). Keeps `header.js`/`bright.js` auto-mounts and the existing `clearDisplay()`/`MatrixBright.mount` script.

- [ ] **Step 1: Replace the inline `<style>` block** (`index.html:8-35`) with `<link rel="stylesheet" href="app.css">`. Keep the `<link rel="icon" …>` favicon line. Remove only the design rules now owned by `app.css`; if any index-only rule remains (none expected), keep it in a tiny inline block.

- [ ] **Step 2: Keep the existing card markup** (`.apps` > `.card` list) — it already matches the `app.css` `.card` contract. Leave the current card set unchanged (the Weather grouping is Phase 2). Do not touch the Quick Controls panel or scripts.

- [ ] **Step 3: Verify on the loaded page (after the user uploads at the gate, or via Playwright against the current host).** Run:
  - `browser_navigate http://esp32matrix.local/` → `browser_console_messages` shows **no errors**.
  - `browser_evaluate`: assert every `.card` has equal `offsetHeight` (uniform grid) — `[...document.querySelectorAll('.card')].map(c=>c.offsetHeight)` all equal.
  - `browser_resize` to 390×800 → `browser_take_screenshot` → cards reflow to 1–2 columns, header + brightness usable.

  Expected: no console errors; uniform card heights; clean mobile reflow.

- [ ] **Step 4: Commit.**

```bash
git add esp32_matrix_webserver/data/index.html
git commit -m "feat(ui): main hub onto app.css (uniform cards, responsive)"
```

---

## Task 4: Re-shell `fire.html` onto the Elevated control-page template

**Files:**
- Modify: `esp32_matrix_webserver/data/fire.html`

**Interfaces:**
- Consumes: `app.css` (Task 1), `backnav.js` (Task 2). Keeps the existing fire simulation/preview engine (`fire.html:117-290`) and `applyToDisplay()`/`stopDisplay()` (`:342-373`) unchanged — only the chrome/structure changes.

- [ ] **Step 1: Replace the inline `<style>`** (`fire.html:7-43`) with `<link rel="stylesheet" href="app.css">` and a one-line page-accent: set `--accent-page:#ff6600` on the `.wrap` (e.g. `<div class="wrap" style="--accent-page:#ff6600">`). Remove the old `.back`/`h1`/button styles now owned by `app.css`.

- [ ] **Step 2: Restructure the body to the shell:**
  - Remove the inline `<a class="back">← Home</a>` (`fire.html:47`); add `<script src="backnav.js" data-auto data-parent="/animations.html" data-label="Animations"></script>` near the existing `header.js` include (so Fire backs to the Animations hub, not Home).
  - Wrap the controls into Elevated `.subcard` groups with `.subhead` labels: **THEME**, **MOTION** (Intensity/Tendrils/Speed/Sparks), and keep the preview in a `.preview-frame`.
  - Replace the "Auto-sync (send to display on every change)" checkbox with the **default-on live-apply** model: wire every control's existing `if (autoSync) applyToDisplay()` to fire always (set `autoSync = true` and remove the checkbox), and add a `.live-dot` "applies live" indicator. Keep the **Apply to Display** / **Stop / Clear** buttons (Apply becomes a manual re-send; Stop clears).
  - Keep the canvas id `preview` and all sim JS as-is (preview already renders full-strength — satisfies the bright-preview rule).

- [ ] **Step 3: Verify.**
  - `browser_navigate http://esp32matrix.local/fire.html` → `browser_console_messages` no errors; the **back-pill** "← Animations" is visible (`browser_evaluate`: `!!document.querySelector('.bn-pill')` and its `href` ends `/animations.html`).
  - Drive a control live, then confirm the board changed: `browser_evaluate` to move the intensity slider + dispatch `input`; then `curl -s http://esp32matrix.local/api/status` shows `"animation":"fire"`, and `GET /api/display/framebuffer` is non-blank.
  - `browser_resize` 390×800 → preview stacks above controls, tap targets large.

  Expected: no errors, back-pill present + correct href, board shows fire, clean mobile stack.

- [ ] **Step 4: Commit.**

```bash
git add esp32_matrix_webserver/data/fire.html
git commit -m "feat(ui): fire.html onto Elevated control-page shell + backnav + live-apply"
```

---

## Task 5: Deploy + hardware review gate

**Files:** none (deploy + review).

- [ ] **Step 1: Ask the user to upload `data/` to LittleFS** (the only deploy this phase — no firmware flash). Remind them: Ctrl+Shift+P → "Upload LittleFS", Serial Monitor closed.

- [ ] **Step 2: Post-upload Claude verification** (no eyeball needed): re-run the Task 3 + Task 4 Playwright checks against the now-live pages; confirm zero console errors, uniform cards, back-pill, fire live-apply → framebuffer, mobile reflow at 390px.

- [ ] **Step 3: Human review gate (desktop + phone).** Ask the user to look at `index.html` and `fire.html` on both a desktop browser and their phone and confirm the **Elevated look + spacing + the bright preview + the back-pill** feel right. This is the taste gate before the mass migration.

- [ ] **Step 4: Capture decisions + restore board.** Record any look tweaks the user wants (fold into `app.css` before Phase 2). Restore a comfortable board brightness via `POST /api/brightness` if testing drove it. Then proceed to write the Phase 2 plan.

---

## Phases 2–3 (outline — planned in detail AFTER the Phase 1 gate)

Not tasked here (YAGNI: the gate may adjust `app.css`, and the exact shell is the template Phase 2 copies). High-level:

- **Phase 2 — Animations section + IA.** Extract `previews.js` (consolidate every page's preview engine) + `palettes.js` (`DF_PAL` + preset tables). Create the remaining animation pages (rainbow, breathe, wave, solid, spiral, starfield, frostbite, fireworks, fireworks2, comet, sun, dancefloor) on the shell using `previews.js`; re-shell the existing standalone pages (liquid, matrix_rain, snow, claudesweep). Convert `animations.html` to a pure grid hub linking all 17 (uniform cards). Build the **Weather sub-hub** + its two leaf pages. Move `bright.js` off all sub-hubs. One LittleFS upload + review.

- **Phase 3 — Remaining pages + sweep.** Re-shell `text`, `clock`, `calendar`, `timer`, `sound`, `sketch`, `emoji`, `settings`, `system`, `imu`; align `presence-card` to tokens; standardize previews + live-apply everywhere; final consistency audit. `npm run bump:minor` → 1.1.0, deploy, `npm run check`, finish branch.

## Self-Review

- **Spec coverage (Phase 1 slice):** design system ✅ (Task 1), back-nav ✅ (Task 2), uniform cards ✅ (Task 1+3), Elevated control shell ✅ (Task 4), full-strength preview ✅ (Task 4 keeps engine), mobile-first ✅ (Task 1 responsive + Task 3/4 checks), review gate ✅ (Task 5). Weather/rainbow/animations-extraction/remaining pages are correctly deferred to Phases 2–3 per the spec's phasing.
- **Placeholder scan:** `backnav.js` is given in full; `app.css` is specified by an exact token list + class contract + responsive rules (adapted from the skill's code-in-plan rule because the final CSS is craft guided by the already-approved mockups, and the repo has no test harness — same adaptation the calibration plans used). Verification steps are concrete commands, not "test it."
- **Consistency:** class/token names used in Tasks 3–4 (`.wrap`, `.card`, `.subcard`, `.subhead`, `.preview-frame`, `--accent-page`, `.live-dot`, `.bn-pill`) all trace to Task 1/2 definitions.
