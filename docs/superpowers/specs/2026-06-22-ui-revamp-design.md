# Web UI Revamp — Unify & Modernize (design)

**Date:** 2026-06-22
**Status:** 🟡 Design — pending user review, then writing-plans.
**Scope:** the board's web control UI (`esp32_matrix_webserver/data/*.html` + shared `*.js`). **Web/LittleFS only — no firmware change** (every behavior uses existing HTTP endpoints), so each phase deploys with a single LittleFS upload and **zero flashing**.

## Problem

The UI grew page-by-page. `header.js`/`bright.js`/`ledsim.js`/`palette.js` are shared, but **each of the ~23 pages re-declares the same design system in its own inline `<style>` block** — so cards, panels, buttons, spacing, and type have drifted. There is no shared back-nav, no shared card-grid, no shared control-page layout, and previews aren't standardized. Concretely (user-reported):

1. Weather is two loose top-level cards (`Weather`, `Weather 2`) instead of one grouped card.
2. Back-navigation from a control page to its sub-hub is a tiny, near-invisible grey text link.
3. The Claude Sweep card renders larger than its neighbors (non-uniform grid).
4. Not every page has a preview; not every control applies to the board live.
5. Previews look too dim (they mirror the board's low brightness instead of rendering full-strength on screen).
6. Rainbow has no page — it's dumped inline at the bottom of `animations.html`, tangled with the global brightness slider.
7. General inconsistency across pages.

## Goal

One consistent, modernized dark UI, made consistent **by construction** (shared sources of truth), mobile-first, with every control page following one shell. Fix items 1–7 and audit for the rest.

## Locked decisions (from brainstorming, do not re-litigate)

- **Direction = "Unify + modernize"** (keep the dark identity, raise the polish as we standardize). Not a from-scratch redesign.
- **Visual style = "Elevated"**: controls grouped into labeled sub-cards (e.g. Motion / Palette / Colors), a larger framed full-strength preview, accent-tinted section headings.
- **Mobile-first responsive is a first-class requirement** — the board is driven from a phone; every page must reflow to a clean single/2-column layout with large tap targets.
- **Weather = sub-hub**: the main-hub Weather card opens a small Weather hub page with two cards ("Icon + Temp", "Dual Display"), consistent with how Animations works.
- **Approach = shared design system + components, then migrate every page** (not page-by-page touch-up, not CSS-only skin).

## Architecture

### 1. `app.css` — the design system (single source of truth)

A new stylesheet linked by every page; pages delete their inline `<style>` design blocks. Contains:

- **Tokens** (CSS custom properties on `:root`): color ramp (bg `#0d0d0d`, surface `#161616`/`#121212`, border `#2a2a2a`/`#242424`, text `#e0e0e0`/`#aaa`/`#666`), brand accents (green `#00ff88`, amber `#ffb000`, cyan `#22ddff`), the Animations accent (purple `#c98bff`), status green/red, a type scale, spacing scale, radii, shadows.
- **Chrome classes** promoted from today's inline styles, restyled to the Elevated look: `.wrap` container, `.panel`, `.subcard` + `.subhead` (the Elevated grouping), `.row`, buttons (`button`, `.danger`), `.status`, `.label`/`.panel-title`.
- **Card grid** (`.apps`, `.card`): uniform cell sizing — equal heights via grid auto-rows / flex so no card (Claude Sweep) can outgrow its neighbors.
- **Responsive** breakpoints baked in (grid column counts step down; controls stack) so mobile is correct everywhere for free.

Pages keep only page-specific tweaks inline (minimal), everything shared comes from `app.css`.

### 2. Shared component set

- **`header.js`** (exists) — the logo banner card linking Home. Keep; restyle via `app.css`.
- **`backnav.js`** (new) — a prominent **back-pill** breadcrumb ("← Home" / "← Animations"). Drop-in like `header.js` (`<script src="backnav.js" data-auto data-parent="/animations.html" data-label="Animations">`), mounted just under the header. Replaces the tiny grey text link. Defaults to Home when no parent is given.
- **Control-page shell** — a documented standard structure + `app.css` classes (header → back-nav → page title → framed preview → sub-carded controls → live-apply status). Implemented as HTML skeleton convention + CSS, not a heavy framework. Every control page conforms.
- **Preview standard** — the framed 8×8 preview renders **full-strength on screen**. Canvas previews never dim with board brightness; the brightness slider POSTs to the board only (formalizes [[feedback-preview-brightness]]). `ledsim.js` is adjusted so the on-screen preview is bright/usable. **Exception:** the Calibration Lab (`calibrate.html`) intentionally shows the corrected/real-panel output and keeps its current behavior.
- **`bright.js`** (exists) — keep the board-as-truth brightness widget, but mount it **only** on control pages and Home's Quick Controls. **Removed from sub-hub pages** (Animations / Weather / System) so it stops cluttering grids (fixes item 6's tangle).
- **`palette.js` / `presence-vocab.js`** — keep; align styling via `app.css`.

### 3. Live-apply convention

- **Continuous controls** (sliders, color pickers, palette/preset clicks) **debounce-POST to the board on change** and update the preview immediately — the page IS the remote.
- **Discrete/destructive inputs** that shouldn't fire on every keystroke (Text content, Sketch canvas) keep an explicit **Send/Push** button, but everything else around them still applies live.
- A consistent **"applies live"** status indicator on every control page.

### 4. Information-architecture changes

- **Weather sub-hub:** main-hub `Weather` card → `weather.html` becomes a sub-hub with two cards. The two existing control pages are preserved as the leaves (exact filenames decided in the plan; "Icon + Temp" = today's `weather.html` behavior, "Dual Display" = today's `weather2.html`). Single shared ZIP/units where it makes sense is a plan detail.
- **Rainbow page:** new `rainbow.html` control page (POSTs `type:rainbow` to the existing animation endpoint). Remove the inline Rainbow block from `animations.html`; `animations.html` becomes a pure sub-hub.
- **Uniform cards** across all hubs.
- **`presence-card.html`** stays a distinct desktop card (excluded from the board chrome, per [[web-ui-structure]]) — aligned to the tokens but not forced into the control-page shell.

## Page inventory & classification (23 pages)

- **Hubs:** `index.html` (main), `animations.html`, `system.html`, + new Weather sub-hub.
- **Control pages (get the shell + preview + live-apply):** `text`, `clock`, `calendar`, `timer`, `sound`, `weather`(→leaf), `weather2`(→leaf), `sketch`, `emoji`, + every `anim_*` page reachable from Animations (`fire`, `liquid`, `matrix_rain`, `snow`, `claudesweep`, `temp`, …) + new `rainbow`.
- **System/diagnostic:** `settings`, `imu`, `grid_test` (redirect stub), `calibrate` (Lab — preview exception).
- **Special:** `presence-card` (desktop card, tokens only).

## Phases (each = one reviewable LittleFS upload, no flashing)

**Phase 1 — Foundation + proof.** Build `app.css` (tokens + chrome + card grid + responsive), `backnav.js`, the control-page shell CSS, and the full-strength preview standard. Convert **three exemplars**: `index.html` (main hub), `animations.html` (sub-hub), and `fireworks` (a representative control page). **Stop for hardware review on desktop + phone** before touching the rest — this is the taste-check gate for the Elevated look.

**Phase 2 — IA fixes.** Weather sub-hub + leaf pages, new `rainbow.html`, remove the Animations inline block, move brightness off sub-hubs, uniform cards everywhere.

**Phase 3 — Migrate + sweep.** Bring every remaining control/system page onto the shell; universal preview + live-apply pass; align `settings`/`system`/`imu`/`presence-card`; final consistency audit (spacing, type, labels, copy). Then version bump (1.1.0 — UI feature/enhancement) and finish.

## Verification

No unit harness (repo norm). Per page: Playwright `browser_navigate` + console check + `browser_evaluate` to drive controls and confirm POSTs hit the board (cross-check `/api/display/framebuffer`); `curl` for endpoints. Human eyeball on **desktop and phone** at the Phase-1 gate and Phase-3 close. Restore comfortable board brightness when done.

## Risks / non-goals

- **No firmware change** — if any item is found to need one, surface it (don't silently add a flash to a "web polish").
- **Not** a behavior/feature change beyond UI consistency (no new animations, no API changes).
- **Don't rototill** bespoke per-page logic that already works — restyle and standardize structure, preserve behavior.
- Calibration Lab preview behavior is deliberately preserved (shows real corrected output).

## Relationship to existing work

- Builds on [[web-ui-structure]] (HUB-based UI, control-page standard, full-brightness previews) and the existing shared chrome (`header.js`, `bright.js`).
- Follows the calibration milestone (v1.0.0); this is the deferred general UI polish, sequenced **before** the docs/RAG buildout per the user.
