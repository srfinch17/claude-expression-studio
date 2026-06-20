# Web UI Polish Pass — Design Spec

**Date:** 2026-06-20
**Status:** Approved for planning
**Author:** the user + Claude (brainstorm)

## Summary

A web-only (`data/*.html`) cleanup pass on the board's control panel: relocate two
cards into their proper hub pages, bring the two newest pages (`claudesweep.html`,
`settings.html`) up to the shared page standard, and add a favicon to the index.
No firmware, MCP, or API changes.

## Motivation

The v0.6/v0.7 work added `settings.html` and `claudesweep.html` as bespoke pages and
dropped their cards onto the flat `index.html` grid. They don't match the rest of the
UI: the index has dedicated **hub pages** (Animations, System) that those cards belong
in, and the two new pages use ad-hoc styling instead of the project's shared page
template. Plus the index has no favicon. This pass makes the UI consistent.

## Current structure (verified)

- **`index.html`** — a flat `.apps` card grid. "Animations" and "System" are themselves
  cards linking to hub pages.
- **`animations.html`** — the Animations hub. Inline-handled animations are `.anim-card`
  divs; animations with their OWN control page (fire, liquid, matrix_rain, snow) are
  **link-out cards** (`<a class="anim-card-link" href="/<x>.html">` wrapping an `.anim-card`).
- **`system.html`** — a simple hub: `.wrap` + `← Home` `.back` + colored `h1` + `.apps`
  grid of `.card` links (temp, grid_test, imu).
- **Animation control page standard** (`snow.html` is the reference): `.wrap`, `← Home`
  `.back`, colored `h1`, a `.layout` row of a **live preview `<canvas>`** (dimmed to board
  brightness via `ledsim.js`) + a `.controls` column of `.group`/`label`/`.slider-row`/
  `.hint`, the shared **`bright.js`** brightness widget mounted at `#brightnessSlot`,
  `.actions` with Apply/Stop buttons, and `.status`. Speed is an **fps slider mapped to
  ms** (`speedMs = Math.round(1000/fps)`); the canvas always renders at full brightness
  except where `ledsim.js` dims it.
- Shared assets: `bright.js` (brightness widget; `data-auto` attr auto-mounts) and
  `ledsim.js` (`LedSim.effective(value, bri)` / `LedSim.bri()` for brightness-aware preview).

## The four changes

### 1. Relocate the Claude Sweep card → `animations.html`
- **Remove** the `<a href="/claudesweep.html" class="card">…</a>` block from `index.html`'s
  `.apps` grid.
- **Add** to `animations.html`'s `.anim-grid`, in the link-out section next to fire/liquid/
  matrix_rain/snow, a link-out card:
  ```html
  <a href="/claudesweep.html" class="anim-card-link">
    <div class="anim-card">
      <span class="icon">🟠</span>
      <div class="name">Claude Sweep</div>
      <div class="desc">CRT/radar border sweep with Claude inside</div>
    </div>
  </a>
  ```

### 2. Relocate the Settings card → `system.html`
- **Remove** the `<a href="/settings.html" class="card">…</a>` block from `index.html`.
- **Add** to `system.html`'s `.apps` grid a `.card` (matching its siblings):
  ```html
  <a href="/settings.html" class="card">
    <span class="icon">⚙️</span>
    <div class="name">Settings</div>
    <div class="desc">Idle screensaver, default brightness, boot animation, timezone</div>
  </a>
  ```
- The index `System` card desc currently reads "Chip temp, grid test, and IMU
  diagnostics" — optionally update to mention settings (minor; decide in planning).
- (`system.html`'s h1 subtitle is "Diagnostics and calibration tools" — Settings is config,
  not diagnostics. Acceptable; the subtitle stays. Noted, not a blocker.)

### 3. Reskin `claudesweep.html` to the full animation-page standard
Rebuild on the `snow.html` template, preserving the launch behavior (POST
`/api/display/animation {type:"claudesweep", color, speed}`):
- `.wrap`, `← Home` `.back`, colored `h1` (e.g. amber `#ffb000` to match the sweep), the
  `.layout` (preview + `.controls`).
- Controls: a **color picker** (default `#ffb000`); a **speed fps slider** mapped to ms
  on POST (replace the bespoke 1–5 `MS` map with the standard fps→ms — keep a sane range,
  e.g. the sweep speed in fps); the shared **`bright.js`** widget at `#brightnessSlot`
  (`<script src="bright.js" data-auto></script>`); `.actions` Apply/Stop; `.status`.
- **Live preview `<canvas>`** that re-implements the firmware animation faithfully:
  the 28-pixel **perimeter sweep** (head at full, per-frame decay toward a baseline
  **floor**, never off) + the **mini-Claude sprite** (6×5, 1px bob + eye-blink).
  **CORRECTION (supersedes any "dimmed via ledsim" wording in this spec):** the preview
  renders at **FULL brightness** — do NOT dim the canvas to board brightness and do NOT
  include `ledsim.js` (animation previews render full-brightness per the project
  convention; `bright.js` sets the BOARD only). **Mirror the firmware constants** from
  `anim_claudesweep.ino` so the preview matches the board: `SWEEP_FLOOR` (76), the decay
  factor, the clockwise perimeter order, the sprite rows INCLUDING the corrected feet
  `.#..#.`, and the amber-by-default sweep color recolored live from the picker while
  Claude stays `#ff6a14`. Canvas renders the un-dimmed look except where `ledsim` applies
  board brightness (same convention as the other previews — preview at full unless the
  brightness widget dims it).

> Drift hazard (call out in the plan): the preview is a SECOND implementation of the
> animation. Keep its constants/sprite in sync with `anim_claudesweep.ino`; add a comment
> in both pointing at each other.

### 4. Reskin `settings.html` to the shared chrome
Keep ALL existing fields, the union-render of idle apps, and the GET/POST logic. Re-dress
only the presentation to match the shared look:
- `.wrap`, `← Home` `.back`, colored `h1`, a subtitle if useful.
- Group the form into `.panel`/`.group`/`label` blocks with the shared slider/`input`/
  button styling and the `.status` line (instead of the current ad-hoc CSS).
- A Save button styled like the standard primary action. No preview canvas (config page).
- The board-brightness story: `settings.html` edits `default_brightness` (persisted/boot),
  which is distinct from the live `bright.js` widget — keep them clearly separate (don't
  mount `bright.js` here unless it's clearly labeled; decide in planning, default: no
  `bright.js`, since this page sets the *default*, not the live value).

### 5. Favicon (index)
Add an **inline SVG data-URI** favicon to `index.html` `<head>` (no LittleFS file):
```html
<link rel="icon" type="image/svg+xml"
  href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>…</svg>">
```
Design: a dark rounded tile with a small grid of dots, a few lit in the panel accent hues
(green `#00ff88` / amber `#ffb000` / cyan) to evoke the 8×8 panel. Keep it legible at 16px
(a sparse 3×3 / 4×4 of dots reads better than a full 8×8 at tab size). The exact SVG is
authored in the plan. Index only (per the ask); extending the same `<link>` to every page
is a trivial follow-up if wanted.

## Non-Goals
- No firmware / MCP / API changes. No new animations or settings.
- No restructuring of `animations.html`'s inline-animation machinery — only adding one
  link-out card.
- No change to the brightness model, the wait pool, or the settings persistence logic.

## Touch list
- `data/index.html` — remove 2 cards; add favicon `<link>`.
- `data/animations.html` — add the Claude Sweep link-out card.
- `data/system.html` — add the Settings card.
- `data/claudesweep.html` — full rebuild to the standard (with `ledsim`-dimmed preview).
- `data/settings.html` — reskin to the shared chrome (keep logic).
- Shared assets `bright.js` / `ledsim.js` are REUSED, not modified.

## Testing / Verification
- **Web-only:** ship via **LittleFS upload** (no firmware flash). The user uploads + reports.
- **Visual checks (user):** Claude Sweep card now lives under Animations and launches;
  Settings card lives under System and opens; both pages match the shared look; the
  Claude Sweep page's live preview resembles the board (sweep + Claude w/ correct feet) and
  dims with the brightness widget; the favicon shows in the browser tab at
  `http://esp32matrix.local`.
- **Controller (HTTP):** confirm each page serves (HTTP 200), the index no longer
  references the two moved pages in its grid, `animations.html`/`system.html` reference the
  moved targets, and a `claudesweep` launch from the rebuilt page still POSTs correctly
  (framebuffer check). Restore board state after.
- **No version bump unless desired** — web-only polish; if bumped, redeploy web + stamp.
  (Decide in planning; default: a patch bump since it's user-visible, or fold into the next
  feature — controller's call with the user.)

## Open / deferred (decide in planning)
- Whether to extend the favicon `<link>` to all pages (default: index only, per the ask).
- Exact fps range + default for the Claude Sweep speed slider (tune to match the firmware's
  sweep feel; the current default maps to ~100ms/frame).
- Whether `settings.html` shows the live `bright.js` widget (default: no — it sets the
  *default* brightness, a separate concept).
- Version bump (default: patch or fold-forward).
