# "Claude Sweep" Animation — Design Spec

**Date:** 2026-06-20
**Status:** Approved for planning
**Author:** the user + Claude (brainstorm)

## Summary

A new procedural firmware animation, **`claudesweep`**: a single-color CRT/radar-style
sweep that travels the 8×8 perimeter (dim baseline ring → bright head → fading comet
tail, never fully off), with the orange **Claude mascot** living centered inside the
border doing its bob + blink. It serves three roles: a **selectable roster animation**,
an **idle screensaver** pick, and a member of the **busy/wait indicator** rotation.
Plus a small bonus: a **mini-Claude stamp** on the freehand draw page.

## Motivation

The project already has a varied "Claude is thinking" busy-indicator pool (snake / orbit
/ alien) and an idle screensaver. The user wants a new signature piece that marries the
existing **border-spinner** idea with the **Claude mascot** — a radar/CRT sweep around
the edge with a little Claude living inside. It should be usable everywhere a busy/idle
visual is: pickable, idle-rotatable, and part of the wait rotation.

## Decisions (from brainstorm)

- **Claude behavior:** centered in the interior, bob + blink (NOT wandering) — maximizes
  recognizability at small size. The sweep carries the motion.
- **Sweep color:** single hue (NOT rainbow). Default **amber CRT `#ffb000`**, adjustable
  via a color picker on the control page. Dim same-hue baseline → bright head → comet
  tail fading back to the baseline.
- **Uses:** all three — roster (selectable), idle screensaver pick, AND busy/wait
  indicator that **joins the weighted rotation** (not replace).
- **Name:** `claudesweep` (provisional; easy to rename).

## The Animation (firmware, procedural)

New `esp32_matrix_webserver/anim_claudesweep.ino`.

### Border sweep
- The **28 perimeter pixels** form a 1-px ring. Treat them as an ordered loop (index
  0..27 around the square) so a "head position" can advance smoothly.
- **Per-frame decay:** every border pixel's brightness multiplies down toward the
  baseline each frame (the `comet` / `matrix_rain` trail technique — see those
  `anim_*.ino` for the pattern). The **head** pixel is set to full; the trailing pixels
  decay, producing a comet tail. Pixels never decay below the **baseline floor**.
- **Head motion:** advances around the loop at a configurable speed (clockwise default).
- **Single hue:** all border pixels are the chosen hue at varying brightness (baseline →
  full). No hue cycling.

### Brightness-floor constraint (correctness — do not skip)
This runs at ambient brightness **5** in the wait/idle roles. FastLED lights a channel
only when `channel × (brightness+1) >> 8 ≥ 1`, i.e. a channel must be ≳ `ceil(256/(5+1))
= 43`/255 to show at all at brightness 5 ([[feedback_led_brightness_formula]]). Therefore:
- The **baseline floor** must use channel values that remain visible at brightness 5 (the
  dim ring can't be near-black or it disappears). The decay floors at this visible
  baseline, NOT at 0.
- Verify the look at BOTH brightness 5 (wait/idle) and a normal brightness (roster use)
  via `GET /api/display/framebuffer` ([[feedback_framebuffer_debugging]]).

### Resident Claude
- The orange mascot (`#ff6a14`) drawn **centered in the interior**, shrunk to clear the
  1-px border (≈ inner 6×6). Nearly identical silhouette to the existing
  `wait-claude` / `claude-idle` mascot ([[claude_mascot_design]]).
- **Bob + blink:** a small vertical bob and an occasional eye-blink (photo-negative or
  eyes-off frame), matching the established animated-glyph approach
  ([[feedback_8x8_animation_design]]).
- Design the 6×6 sprite by **downscaling the real 8×8 reference**, not freehand
  ([[feedback_8x8_glyph_design]]); iterate live against the framebuffer. The mascot color
  is independent of the sweep hue (Claude stays orange even if the sweep is recolored).

### Parameters (control-page + API)
- `color` (hex, default `#ffb000`) — sweep hue.
- `speed` (1–5 via the MCP scale → ms/frame in firmware, per the existing convention;
  slider left=slow/right=fast, fps-style — [[feedback_slider_direction]]).
- (Optional, decide in planning) `baseline` brightness of the ring floor; `claude` on/off.
  Keep the param set minimal (YAGNI) unless a clear need appears.

## Wiring — three homes

### A. Roster (selectable)
Standard `add-animation` recipe:
1. `anim_claudesweep.ino` — state + `runClaudeSweepFrame()` / `stepClaudeSweepFrame()`.
2. Dispatch branch in `esp32_matrix_webserver.ino` `loop()`.
3. `handleAnimation()` (`api_handlers.ino`) — parse `color`/`speed`, set globals, set
   `animationName = "claudesweep"`.
4. `data/claudesweep.html` — control page (color picker, speed slider, live canvas
   preview rendering the sweep + claude, launch POST). Preview at full brightness
   ([[feedback_preview_brightness]]).
5. `data/index.html` — add a card.
6. Add to `KNOWN_ANIMS` / the MCP `matrix_set_animation` enum + description.

### B. Idle screensaver pick
- Add `claudesweep` to the firmware idle rotation CSV default (`IDLE_APPS_DEFAULT` in
  `settings.ino`) and to `mcp_server/idle.ts` `IDLE_APPS` (keep the two aligned per the
  three-list convention from v0.6). Launches at idle brightness via the existing
  `idleLaunch` path (already transient — bypasses auto-resume).

### C. Busy/wait indicator — joins the weighted rotation (type-aware pool)
The wait pool today = the `working` builtin + auto-discovered `wait-*` frame expressions,
picked weighted-random in **both** `mcp_server/wait.ts` (MCP path) and
`claude-hooks/matrix_signal.py` (UserPromptSubmit hook path), weighted by
`mcp_server/wait-weights.json`.

- Make the pool **type-aware:** a pool entry is either a **frame-expression** (today) or a
  **firmware-animation** (new). Add a `claudesweep` firmware-animation entry to the pool
  in both pickers, weighted in `wait-weights.json`.
- When the picker selects the firmware-animation entry, the caller fires
  `POST /api/display/animation { type:"claudesweep", transient:true }` at brightness 5
  **instead of** pushing frames. Frame-expression entries behave exactly as today.
- Keep the two picker implementations behaviorally aligned (they already mirror each
  other) — [[wait_animation_library]].

### Transient-launch flag (correctness — required for role C)
`handleAnimation` persists the animation to NVS auto-resume (`resumeKind="anim"`), so a
wait-role launch would make the board boot into "Claude is thinking" forever. Frame
spinners avoid this because frames are transient.
- Add a **`transient` boolean** to the `/api/display/animation` body. When true,
  `handleAnimation` skips the auto-resume write (the same exemption the `presence`
  animation already gets — generalize that check to also honor `transient`).
- The wait-path launch sends `transient:true`. Roster launches omit it (persist normally).
  Idle launches already bypass persistence via `idleLaunch`/`applyAnimationBody`, so they
  need no change.

## Bonus: sketch-page mini-Claude stamp
- Add a **"mini Claude" preset** to the freehand draw page **`data/sketch.html`**'s
  premade-image picker — an 8×8 Claude bitmap selectable like the other stamps. Web-only,
  independent of the animation. Use the full 8×8 mascot silhouette (not the 6×6 interior
  version). Match the existing preset format in `sketch.html` (inspect how the current
  premade images are encoded/registered and add one more entry the same way).

## Touch list

**Firmware (`esp32_matrix_webserver/`):**
- `anim_claudesweep.ino` *(new)* — sweep decay + head motion + mini-Claude sprite + bob/blink.
- `esp32_matrix_webserver.ino` — dispatch branch; any new globals (keep sweep/claude state
  in the new file as file-local statics — globals shared across files go in the main ino
  per [[feedback_firmware_review_limits]] / docs/PITFALLS.md).
- `api_handlers.ino` — `handleAnimation` parse for `claudesweep`; add `transient` flag
  handling (skip auto-resume write).
- `settings.ino` — add `claudesweep` to `IDLE_APPS_DEFAULT`.

**Web (`data/`):**
- `claudesweep.html` *(new)* — control page.
- `index.html` — card.
- `sketch.html` — mini-Claude preset stamp (premade-image picker).

**MCP (`mcp_server/`):**
- `index.ts` — `matrix_set_animation` enum/description gains `claudesweep`.
- `idle.ts` — add `claudesweep` to `IDLE_APPS` (aligned with firmware CSV).
- `wait.ts` — type-aware pool: support a firmware-animation entry; fire the animation
  endpoint when picked.
- `wait-weights.json` — weight for `claudesweep`.

**Hooks (`claude-hooks/` + installed copies):**
- `matrix_signal.py` — type-aware wait pool; launch `claudesweep` (transient) when picked.
  Edit BOTH the repo copy and the `~/.claude/hooks/` copy ([[hook_live_copy_sync]]).

## Build order (one spec, sequenced; each independently flashable/testable)
1. **Firmware animation** (`anim_claudesweep.ino`) + dispatch + `handleAnimation` parse —
   get the sweep + claude looking right on hardware (framebuffer + visual, both brightnesses).
2. **Control page + index card** + MCP `matrix_set_animation` enum.
3. **Sketch-page mini-Claude preset** (independent, web-only).
4. **Idle lineup** (firmware CSV + idle.ts).
5. **`transient` flag** in `handleAnimation`.
6. **Wait-pool type-aware integration** (wait.ts + matrix_signal.py + wait-weights.json) —
   the meatiest; depends on 1 + 5.

## Testing / Verification
- **Hardware (user flashes + reports):** the sweep reads as a CRT/radar sweep at BOTH
  brightness 5 and a normal brightness (baseline visible at 5, not vanished); the comet
  tail fades to the floor and never fully off; Claude reads recognizably at 6×6 and
  bob/blinks; speed + color picker work; roster launch persists (auto-resume) but a
  `transient:true` launch does NOT (power-cycle test); idle rotation includes it; the
  wait rotation sometimes shows it (and it disappears on `done`).
- **MCP:** `npx tsc` clean; `node:test` suite green (the project uses **node:test**, not
  vitest — [[feedback_firmware_review_limits]]); add picker tests in `wait.test.ts` for the
  type-aware entry if it carries real logic.
- **Restore board state after any HTTP-driven verification** (brightness + display) —
  [[feedback_restore_board_after_testing]].
- Watch the single-translation-unit ordering traps (globals/#defines/structs) —
  docs/PITFALLS.md.

## Open / deferred (decide in planning)
- Whether `baseline` brightness and `claude` on/off are exposed params (lean: no, keep minimal).
- Exact head speed → ms mapping and tail decay rate (tune live on hardware).
- Final mini-Claude 6×6 bitmap (design + iterate against the framebuffer).
- The pre-existing deferred item from v0.6 (`matrix_signal.py` MCP_DIR hardcoded path) is
  unrelated to this work but lives in a file role C touches — leave it as-is here.
