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

## Proposed shared module — `ledsim.js` (roadmap)

Extract the math above into one include (companion to `bright.js`) exposing
`effective()`, `minVisibleChannel()`, and `previewColor()`, and have it subscribe
to brightness changes so every preview canvas re-renders at the true appearance.
Build once, reuse on emoji, sketch, animations, and any future preview. Tracked
in `docs/ROADMAP.md`.

## Empirical observations (TO FILL IN)

The formula above is theoretical. The actual board may differ (LED binning,
supply voltage, viewing angle). Record real `grid_test` results here as
`(brightness → first channel value actually visible on the board)` so we have
ground truth, not just math:

| Brightness | First visible channel (observed) | Date | Notes |
|---:|---:|---|---|
| _e.g. 40_ | _?_ | | |

_(empty — run grid_test on the board and we'll fill this in)_
