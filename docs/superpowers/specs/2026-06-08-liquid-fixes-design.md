# Phase 2 · Liquid Mode Fixes — Design Spec
**Date:** 2026-06-08
**Roadmap:** Phase 2

Three fixes to `liquid` mode: (1) broken colors, (2) physics that dies at ~45°,
(3) a custom top/bottom gradient. Firmware + `liquid.html`. No new endpoint.

---

## 1. Color bug — root cause & fix

**Root cause:** `stepLiquidFrame()` hardcodes the water color
`CRGB col = CRGB(0, v>>1, v)` (teal) and reads no palette. Meanwhile the API
handler already maps the four presets (`classic/blue/green/purple` = Lava /
Ocean / Slime / Plasma) onto the shared `activePalette` that fire uses. So all 4
presets render identical teal.

**Fix:** color the fluid via the existing `heatToColor(uint8_t h)` (reuses
`activePalette`, no new infra). Map vertical position in the fluid column to the
palette: surface = bright/frothy stops, depth = darker stops.
- `h = base + depthShade`, where surface gets a high `h` (~210) and the deepest
  cell a lower `h` (~110); turbulence pushes surface `h` toward 255 (white tips).
- The four presets now visibly differ (each palette is a dark→bright gradient).

---

## 2. Physics — 1D heightfield → 2D closed-container (gravity projection)

**Goal:** behave like a sealed container. Tilt any direction and the fluid pools
against the down-edge; rotate past 45° and it spills onto the next edge/corner;
full 360°.

**Why the rework:** the current model stores one height per column and a single
left/right tilt (`atan2(-ay, az)`). A 1D heightfield can only represent
left/right sloshing — it can't pool at top/bottom or rotate to a corner.

### Model — gravity projection fill
Treat gravity as a 2D vector in the matrix plane and fill the most "downhill"
cells:

1. Read accel. Derive in-plane gravity direction `(gx, gy)` from two axes
   (mapping below). Low-pass smooth it into `liquidGX/liquidGY` for stability.
2. Each cell's **potential** `p(x,y) = x*gx + y*gy` — larger = more downhill.
3. Equilibrium threshold `Teq` = the value where exactly `LIQUID_CELLS` (=32,
   half full) cells have `p ≥ Teq`. (Collect all 64 `p` values, select the
   32nd-largest — cheap on 8×8.)
4. **Slosh:** spring a continuous `liquidLevel` toward `Teq` with momentum:
   ```
   liquidLevelVel += (Teq - liquidLevel) * stiffness;   // stiffness scales with tilt magnitude
   liquidLevelVel *= liquidDamping;                      // from viscosity (reused)
   liquidLevel    += liquidLevelVel;
   ```
   The overshoot when gravity rotates IS the slosh.
5. **Render:** cell is fluid iff `p(x,y) ≥ liquidLevel`. Surface = cells just
   above the threshold; depth = `(p - liquidLevel)` normalized. Froth/turbulence
   brightness scales with `|liquidLevelVel|`.

This pools against any edge/corner, spills to the next edge as you rotate, and
sloshes — all from one threshold. Volume is conserved by construction (≈32 cells
always filled); the old drift-correction hack is gone.

### IMU axis mapping — MUST CALIBRATE ON HARDWARE
Which accel axis maps to matrix x vs y, and the signs, depend on board mounting
and aren't knowable without the board. Implementation puts the mapping in one
clearly-marked block:
```cpp
// VERIFY ON HARDWARE: if the fluid pools toward the wrong edge, flip a sign
// or swap ax/ay here. This is the expected first-flash calibration step.
float gxRaw = ay;   // → matrix +x (right)
float gyRaw = ax;   // → matrix +y (down)
```
First flash is a calibration pass: tilt the board, watch which way it pools,
adjust signs/axes. Record the final mapping in `docs/PITFALLS.md`.
Flat board (gravity ⟂ screen, `ax,ay≈0`): keep the last direction (don't snap).

### Viscosity (reused)
`liquidDamping = 0.97 - vis*0.02` stays. Low viscosity = sloshy (less decay),
high = sluggish.

---

## 3. Gradient mode (custom top/bottom colors)

Adds a 5th palette option, **Custom**, with two color pickers: **Top** (surface/
froth) and **Bottom** (deep). When active, color = `lerp(bottomColor, topColor,
surfaceProximity)` instead of `heatToColor()`; froth still whitens the surface.

> Uses plain `<input type=color>` pickers for now (no S2 dependency). When S2
> (shared palette/picker) lands, swap these for the clock-style swatches — noted
> in ROADMAP. Full per-page palette beyond top/bottom stays parked.

---

## Firmware changes

### Globals (`esp32_matrix_webserver.ino`, replace the liquid/IMU state block)
```cpp
bool  imuReady = false;
float liquidLevel = 0, liquidLevelVel = 0;     // fill threshold + slosh velocity
float liquidGX = 0, liquidGY = 1;              // smoothed in-plane gravity dir
float liquidDamping = 0.88f;                    // from viscosity (unchanged)
bool  liquidGradient   = false;                 // custom top/bottom mode
CRGB  liquidTopColor    = CRGB(230, 250, 255);  // froth (custom)
CRGB  liquidBottomColor = CRGB(0,   40, 160);   // deep  (custom)
```
Remove `liquidHeight[]`, `liquidVelocity[]`.

### `anim_liquid.ino`
Rewrite `stepLiquidFrame()` per the model above. `stepImuFrame()`, IMU
driver (`initIMU`/`readAccel`/`qmi*`) unchanged.

### `api_handlers.ino` (liquid block)
Keep viscosity→damping and the shared `activePalette` mapping. Add: read
`gradient` (bool) + `top`/`bottom` hex colors; reset `liquidLevel/Vel` and the
gravity dir on (re)start.

### `data/liquid.html`
Add the **Custom** palette button → reveals two color pickers (Top/Bottom).
`sendLiquid()` posts `gradient`, `top`, `bottom` when Custom is active. Update
the tilt note to "tilt any direction — it pools to the low edge." Brightness
widget already present (auto-mount).

---

## Verification (hardware — needs flash + LittleFS upload)
1. Each of the 4 presets renders a *distinct* color (not all teal).
2. Custom gradient: top/bottom colors show as surface vs deep.
3. Tilt left/right/up/down → fluid pools to the low edge each way.
4. Rotate past 45° / to a corner → fluid spills to the next edge (the core fix).
5. Slosh settles; viscosity 0 = wavy, 10 = sluggish.
6. Calibration: if pooling direction is wrong, flip the gxRaw/gyRaw mapping;
   record the correct mapping in PITFALLS.

## Out of scope
- Full per-page palette picker beyond top/bottom (parked; needs S2).
- LedSim accurate-dim preview for this page (animation preview stays full-bright).
