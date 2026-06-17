# S4 · `ledsim.js` — Brightness-Accurate Preview Model — Design Spec
**Date:** 2026-06-08
**Roadmap item:** S4 (shared UI component)
**Reference:** `docs/LED_BRIGHTNESS.md`

## Overview

Extract the FastLED brightness→appearance math (today duplicated in `emoji.html`
and `grid_test.html`) into one shared include, `data/ledsim.js`, and give it a
live hook so any page can render *exactly* what the LED shows at the current
brightness — and re-render when the S1 brightness widget changes.

No firmware change (served from LittleFS like `bright.js`).

## Important scope decision: accurate-dim is OPT-IN, not global

Git history shows animation previews were **deliberately** switched to render at
**full brightness** ("sun preview too dim…", "matrix rain preview too dim…")
because accurate-dim previews looked too dark to be useful UX. S4 therefore does
**not** dim every preview. It provides the *capability*; pages opt in where it
helps:

- **Use accurate preview:** emoji, sketch, grid_test — color fidelity is the
  point; you need to see which colors physically survive.
- **Keep full-bright preview (unchanged):** the animation previews
  (fire, matrix_rain, sun/animations, etc.) — by prior deliberate choice.
- **As an inspector anywhere:** surfacing `minVisibleChannel(bri)` ("below
  channel N is dark at this brightness") is useful without dimming anything.

## Module: `data/ledsim.js` → global `LedSim`

Pure model (mirrors `docs/LED_BRIGHTNESS.md`):
```js
LedSim.effective(channel, bri)      // (channel*(bri+1))>>8  — FastLED nscale8x3
LedSim.minVisibleChannel(bri)       // ceil(256/(bri+1))
LedSim.displayGamma(v)              // v? round(255*(v/255)**(1/2.2)) : 0
LedSim.previewColor(color, bri)     // hex '#rgb'/'#rrggbb' or [r,g,b] -> 'rgb(r,g,b)' as displayed
```
Brightness glue:
```js
LedSim.bri()            // current brightness: MatrixBright.get() if present,
                        //   else localStorage 'matrix_brightness', else 10
LedSim.onChange(cb)     // calls cb(bri) now and on every brightness change;
                        //   returns an unsubscribe fn
```
`onChange` listens for the `matrixbrightness` window event (see below). A preview
becomes accurate with one line: `LedSim.onChange(render)` and have `render` use
`LedSim.previewColor(hex, LedSim.bri())`.

## S1 hook: brightness broadcast in `bright.js`

`bright.js` gains a `broadcast()` that dispatches
`window.dispatchEvent(new CustomEvent('matrixbrightness', { detail: { level } }))`
**immediately** on every value change (slider input, lock toggle, `set()`,
initial mount) — fired un-debounced so previews track the slider in real time,
even though the board POST stays debounced. Pages with their own brightness
control (emoji/grid_test) can dispatch the same event to drive `LedSim`.

## Scope as built (this turn)
- New `data/ledsim.js` (the module).
- `bright.js`: add `broadcast()` + the `matrixbrightness` event.
- **No preview retrofits this turn.** Existing accurate pages (emoji/grid_test)
  keep working; they can migrate to `LedSim` to de-dup when those pages are next
  touched (emoji in Phase 3). Animation previews stay full-bright by design.

## Verification
Module-level (browser console once uploaded):
`LedSim.minVisibleChannel(40)` → `7`; `LedSim.effective(6,40)` → `1`;
`LedSim.previewColor('#080808',40)` → a near-black `rgb(...)`. Hardware not
required for the math; the on-board check comes when a preview opts in.

## Out of scope
- Dimming animation previews (deliberately rejected).
- Refactoring emoji/grid_test now (deferred to when they're next edited).
- The emoji color quantizer itself (Phase 3) — it will *consume* `minVisibleChannel`.
