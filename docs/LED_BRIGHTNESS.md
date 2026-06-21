# LED Brightness → Appearance Reference

How a color you send maps to what the 8×8 panel *actually* shows at a given
brightness, and how to render an accurate preview on a web page. This is the
hard-won calibration knowledge behind `grid_test.html` — keep it here so it
doesn't live only in code.

## The model (FastLED `nscale8x3`)

FastLED scales every channel by brightness using integer math:

```
effective(channel, bri) = (channel * (bri + 1)) >> 8      // i.e. (c*(bri+1)/256) floored
```

An LED sub-pixel is **physically off** when `effective == 0`. Solving for the
smallest channel value that survives:

```
minVisibleChannel(bri) = ceil(256 / (bri + 1))
```

Any R/G/B channel **below** `minVisibleChannel` is dark at that brightness.

### Threshold table (computed from the formula)

| Brightness | Min visible channel | Notes |
|---:|---:|---|
| 255 | 1 | full color detail |
| 200 | 2 | |
| 128 | 2 | |
| 100 | 3 | top of the "safe" power range |
| 64  | 4 | |
| 50  | 6 | |
| **40** | **7** | **firmware default brightness** |
| 25  | 10 | |
| 20  | 13 | |
| 10  | 24 | heavy color loss |
| 5   | 43 | only bold colors survive |
| 1   | 128 | essentially on/off |

> **Implication for emoji / any image (Phase 3):** at low brightness, small
> channel values disappear, so subtle colors "don't translate." A faithful 8×8
> image needs its colors **quantized/boosted above `minVisibleChannel(bri)`**
> for the target brightness — not merely downscaled in resolution.

## Web preview accuracy (gamma)

LED output is linear; screens are gamma ~2.2. To make a canvas pixel *look* like
the LED, apply the dim first, then gamma-correct for display:

```
ledToDisplay(v) = v === 0 ? 0 : round(255 * (v/255) ** (1/2.2))
previewColor(hex, bri):
    [r,g,b] = parseHex(hex)
    return rgb( ledToDisplay(effective(r,bri)),
                ledToDisplay(effective(g,bri)),
                ledToDisplay(effective(b,bri)) )
```

`emoji.html` and `grid_test.html` already do exactly this. Other previews
(`matrix_rain`, the animation previews) currently render at **full brightness**
and do not reflect the real dimmed look — see the proposed shared module below.

## Shared module — `ledsim.js` (shipped, S4)

The math above is now a single include (companion to `bright.js`): global
`LedSim` exposes `effective()`, `minVisibleChannel()`, `displayGamma()`,
`previewColor(color, bri)`, `bri()`, and `onChange(cb)`. `bright.js` fires a
`matrixbrightness` window event on every change so `LedSim.onChange()` previews
update live with the slider.

**Accurate-dim preview is opt-in, not global.** Animation previews
(fire, matrix_rain, sun, …) were deliberately set to render at *full* brightness
because dim previews looked too dark — do **not** retrofit them. Use `LedSim`
where color fidelity matters (emoji, sketch, calibration) or as an inspector
(show `minVisibleChannel(bri)`). Spec:
`docs/superpowers/specs/2026-06-08-ledsim-preview-design.md`.

Usage: `LedSim.onChange(render)` then inside `render` use
`LedSim.previewColor(hex, LedSim.bri())`.

## Empirical observations → `data/calibration.json`

The formula above is theoretical; the real board differs (LED binning, supply
voltage, per-channel die response, viewing angle). Measured ground truth now lives
in the machine-readable **`data/calibration.json`**, produced by the **Calibration
Lab** (`/calibrate.html`, formerly Grid Test) and consumed by the firmware
correction layer, `ledsim.js`, and the MCP — so the numbers are *applied*, not just
recorded. Keys: per-channel `floors`, `white_balance` gains, `gamma`, a verified
`palette`, `steps`, optional `pixel_trim`.

To update: re-run the Lab on the board and re-commit `data/calibration.json` — do
not transcribe the numbers here (one source of truth). Full design:
`docs/superpowers/specs/2026-06-21-led-calibration-battery-design.md`.
