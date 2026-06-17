# Phase 3a · Sketch App — Design Spec
**Date:** 2026-06-09
**Roadmap:** Phase 3 (static-image apps) · establishes the S3 paint-grid + matrix-push pattern

## Overview

A web page where you paint on an 8×8 grid and push it to the board. Pure
front-end — the firmware's `POST /api/display/matrix { matrix: [[8×8 "#RRGGBB"]] }`
already exists, stops animations, and paints pixels. No firmware change.

Reuses the shared pieces: brightness widget (`bright.js`) and the LED-appearance
model (`ledsim.js`) for a true-to-board preview.

## UI (`data/sketch.html`)

- **Title** 🎨 Sketch + brightness widget (auto-mount, inside the panel).
- **Paint grid** — 8×8 cells, click or drag to paint with the current color;
  works with mouse and touch (drag uses `elementFromPoint`). Cells show the
  *true* painted color for editing clarity. Right of it (or below), a small
  **board preview** canvas renders the same grid through
  `LedSim.previewColor(hex, LedSim.bri())` so you see what the LEDs will actually
  show at the current brightness — updates live as you paint and as brightness
  changes (`LedSim.onChange`). This directly surfaces the "low brightness eats
  dark colors" reality.
- **Tools:**
  - Color picker (`<input type=color>`) = current paint color.
  - Quick swatches — a row of ~10 common colors (white, red, orange, yellow,
    green, cyan, blue, purple, magenta, off/black) to click without the picker.
  - Eraser toggle — paints `#000000`.
- **Actions:** **Send to Board** (POST the matrix), **Fill** (all = current
  color), **Clear** (all black). Status line.

## State & data flow
- `cells[64]` array of hex strings (row-major, `y*8+x`), default `#000000`.
- Painting a cell updates `cells[]`, the cell's background, and the preview.
- Send builds `matrix = [[8 rows × 8 hex]]` from `cells[]` →
  `POST /api/display/matrix`. (Brightness is handled by the shared widget; no
  need to send it here — it's already applied globally.)

## Persistence
- Save the current `cells[]` to `localStorage` (`sketch_grid`) so a refresh keeps
  the drawing. (Cheap; nice for an editor.)

## Home page
Add a 🎨 **Sketch** card to `index.html` (creative app, alongside Emoji/Text).

## Files
- New: `data/sketch.html`
- Modified: `data/index.html` (add card)
- Firmware: none.

## Verification (LittleFS upload only)
1. Paint cells (click + drag) → grid updates; preview shows dimmed/true output.
2. Send → board shows the drawing.
3. Lower brightness → preview shows dark colors vanishing (matches board).
4. Fill / Clear / eraser work; refresh keeps the drawing.

## Out of scope (later)
- Image import → 8×8 (that's Emoji's quantizer, Phase 3b — shares the matrix-push).
- Undo/redo, multiple frames/animation.
