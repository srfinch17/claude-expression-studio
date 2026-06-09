# Phase 5 · Sound / Vibration Visualizer — Design Spec
**Date:** 2026-06-09
**Roadmap:** Phase 5

## Overview
A `sound` animation mode: a VU bar that dances to **vibration** picked up by the
IMU. **There is no microphone** — this reacts to low-frequency vibration (bass
through a surface), so it's a beat/energy visualizer, NOT a spectrum equalizer
(the IMU can't resolve audio frequencies — see ROADMAP feasibility note).

## Algorithm (firmware `anim_sound.ino` → `stepSoundFrame()`)
1. `mag = |accel|` (≈1g at rest).
2. Slow-tracked `soundBaseline` (EMA) follows steady magnitude → removes gravity/
   orientation; `dev = |mag - baseline|`.
3. `target = clamp(dev × gain, 0..1)`, gain from `sensitivity` (0-10).
4. `soundEnergy`: fast attack (jump up), slow release (ease down) — VU feel.
5. `soundPeak`: hold + slow decay.
6. Render: bar rises from the bottom, height = energy × 8, gradient
   `soundColor1` (bottom) → `soundColor2` (top); white peak line at `soundPeak`.

Reuses `readAccel` (anim_liquid.ino), `blendColors`, `setPixel`.

## API
`POST /api/display/animation { type:"sound", color1, color2, sensitivity }`
- color1 bar bottom, color2 bar top, sensitivity 0-10 (default 5).

## Firmware
- New `anim_sound.ino`. Globals (main .ino): `soundColor1/2`, `soundSensitivity`,
  `soundBaseline`, `soundEnergy`, `soundPeak`. Dispatch + handler branches.

## Web
`sound.html`: S2 palette (2 colors, Bottom/Top) + sensitivity slider + brightness
widget + a clear "place near a speaker, no mic" note. Home Sound card. MCP `sound`.

## Verification (flash + LittleFS)
On/near a speaker with bass: bar rises with the beat, settles between hits, peak
line decays. Raise sensitivity if it barely moves. Calibrate gain on hardware.

## Future
True spectrum EQ would need an I2S MEMS mic (e.g. INMP441) — a hardware add.
