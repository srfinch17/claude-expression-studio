---
name: add-animation
description: Add a new animation/visualization mode to the ESP32-S3 matrix firmware. Use whenever creating a new animated display mode (a new anim_*.ino) so every wiring-up step is done consistently and nothing is skipped.
---

# Add a new animation mode

Adding an animation touches **6 places**. Skipping any one is the usual cause of
"I built it but it doesn't show up / the page 404s / the card is missing." Do all
six. Names below assume a mode called `<name>` (e.g. `comet`, `weather2`).

## Before you start
- Read `CLAUDE.md` (hardware facts) and `docs/PITFALLS.md` (traps).
- Remember: **`COLOR_ORDER` is RGB** — `CRGB(r,g,b)` maps straight through.
- Draw only via `setPixel(x, y, CRGB)` — it's bounds-checked. `XY(x,y)=y*8+x`,
  row-major (NOT serpentine), origin top-left.
- Animations are **non-blocking**: no `delay()`. Use the `millis()` + frame-state
  pattern like the other `anim_*.ino` files. The dispatcher already rate-limits
  via `animationSpeed`/`lastFrameMs`.

## The 6 steps

1. **New file `esp32_matrix_webserver/anim_<name>.ino`**
   - Mode-local state as `static`/global vars at the top.
   - A `run<Name>Frame()` (or `step<Name>Frame()`) that renders ONE frame into
     `leds[]` and returns. Clear what you need each frame; don't assume a clean
     buffer. Mirror an existing `anim_*.ino` for structure.

2. **Dispatch branch** in `esp32_matrix_webserver.ino`
   - Find the dispatch chain (grep `animationName ==` in that file).
   - Add `else if (animationName == "<name>") run<Name>Frame();`.

3. **HTTP handler** in `api_handlers.ino` → `handleAnimation()`
   - Parse `type == "<name>"` and any mode params from the JSON body.
   - Set the mode's globals, set `animationName = "<name>"`,
     `animationActive = true`, and `animationSpeed` if the mode wants a rate.

4. **Control page `data/<name>.html`**
   - Clone an existing page. Include the shared **brightness widget** and, if the
     mode has colors, the shared **palette/picker** component (see
     `docs/ROADMAP.md` S1/S2 — reuse, don't re-hand-roll).
   - Live 8×8 preview canvas + a Launch button that POSTs to
     `/api/display/animation` with `{ "type": "<name>", ... }`.

5. **Index card** in `data/index.html`
   - Add a card linking `<name>.html` (icon + one-line description), placed in
     the right section (e.g. under Animations).

6. **README** features table — add a row (optional but keep it current).

## Finish
- Tell the user this needs **both** a sketch upload (firmware) **and** a
  **Tools → ESP32 LittleFS Data Upload** (because `data/` changed).
- Do not claim it works until the user confirms on hardware (see the dev-loop
  memory). If a non-obvious trap bit us, append an entry to `docs/PITFALLS.md`.
