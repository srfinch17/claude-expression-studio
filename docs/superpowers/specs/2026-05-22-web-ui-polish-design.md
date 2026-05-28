# Web UI Polish — Design Spec
**Date:** 2026-05-22

## Summary
Three targeted fixes to the ESP32 Matrix web UI. No new pages, no architecture changes.

---

## 1. Index Page — Card Grid Centering

**Problem:** The `.apps` card grid stretches to fill the full browser window, making cards uncomfortably wide at large viewport sizes.

**Solution:** Wrap the grid in a `max-width: 720px; margin: 0 auto` container. Keep `auto-fill, minmax(148px, 1fr)` so the grid naturally drops from 4 → 3 → 2 → 1 columns as the window narrows. Cards stay a comfortable size and the grid stays centered.

---

## 2. Index Page — Brightness Slider Redesign (Option A)

**Problems:**
- Label jitter: the `<strong>` value display changes character width as value goes 2-digit → 1-digit, causing the flex row to reflow.
- Default of 40 is arbitrary; 10 is a safer starting point.
- No protection against dangerously high brightness levels.

**Solution:**

### Slider
- Range stays 0–255.
- Default: 10 (or localStorage value, clamped to 100 if the warning checkbox is unchecked).
- Fix jitter: give the value display `display: inline-block; min-width: 2.5ch; text-align: right`.

### Heat gradient bar
- A decorative 5px `<div>` below the slider row using a CSS `linear-gradient`: green (0%) → yellow (~30%) → orange (~42%) → red (100%).
- A thin white vertical tick at ~39% (100/255) marks the safety boundary.
- Small labels below: `0`, `safe`, `100`, `⚠ hot`, `255`.

### Lock checkbox
- A compact warning row below the gradient: checkbox + "⚠ Heat warning: values above 100 risk overheating. Check to unlock."
- If unchecked: `oninput` clamps the slider value to 100 in real time (no snap animation, just instant correction).
- If checked: full 0–255 range is available.
- State persists in `localStorage` (brightness value + checkbox state).

---

## 3. All Sub-Pages — Content Centering

**Problem:** Content on sub-pages (fire, liquid, text, IMU, weather, temp, timer, clock, animations, matrix rain, emoji) is left-aligned with no max-width, making it feel unanchored at wide viewports.

**Solution:** On each sub-page, wrap the main content (everything after the back link) in a `<div class="content-wrap">` with `max-width: 760px; margin: 0 auto`. No other style changes — existing layout, colors, and interactions stay identical.

Affected files: `fire.html`, `liquid.html`, `text.html`, `imu.html`, `weather.html`, `temp.html`, `timer.html`, `clock.html`, `animations.html`, `matrix_rain.html`, `emoji.html`

---

## Out of Scope
- No changes to firmware or MCP server.
- No new pages.
- No CSS framework or build tooling introduced — all pages stay self-contained vanilla HTML/CSS/JS.
