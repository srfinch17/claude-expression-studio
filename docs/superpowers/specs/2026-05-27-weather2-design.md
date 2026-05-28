# Weather 2 — Design Spec
**Date:** 2026-05-27

## Overview

A new animation mode `weather2` that shows a weather icon in the top 4 rows and current temperature in the bottom 3 rows of the 8×8 matrix — simultaneously, always, no phase switching. Color is user-selectable via 64-palette. Separate from Weather 1 (which alternates between icon and data overlay).

---

## Matrix Layout

```
Row 0  │ icon (top)
Row 1  │ icon
Row 2  │ icon
Row 3  │ icon (animated drops / rays here)
Row 4  │ [all black except degree dot at col 7]
Row 5  │ digit top
Row 6  │ digit mid
Row 7  │ digit bottom
```

---

## Temperature Display

**Font:** `FONT_3X3` (3×3 px, defined in `fonts.ino`). Each digit 3 cols wide, 1 col gap.

| Digits | Hundreds | Tens      | Gap  | Units     |
|--------|----------|-----------|------|-----------|
| 1-digit | —       | —         | —    | cols 3–5  |
| 2-digit | —       | cols 0–2  | col 3 | cols 4–6 |
| 3-digit | col 0 (solid bar, all 3 rows) | cols 2–4 | — | cols 5–7 |

The hundreds position for 3-digit is a single solid column (not FONT_3X3) to save width — matches existing `drawTempOverlay()` approach.

**Degree dot:** single pixel at `(col 7, row 4)`, always `CRGB(0, 200, 255)` cyan. Hardcoded — distinct from any palette color and from all icon colors.

**Digit colors:**
- `weather2Color1` — tens digit (and hundreds bar for 3-digit)
- `weather2Color2` — units digit
- Palette click sets `c1 = palette[0]`, `c2 = palette[2]` (skip middle for more contrast — same as comet/wave/spiral)
- Defaults: `c1 = CRGB(255, 165, 0)`, `c2 = CRGB(255, 220, 80)` (amber → gold)

**Unit:** `weather2Unit` string (`"F"` or `"C"`), defaults `"F"`, independent from `weatherUnit` (Weather 1).

---

## Temperature State Change

`fetchWeather()` currently stores only the unit-matched temp. Weather 2 needs both. Add two new globals:

```cpp
int weatherTempF = 0;   // always stores raw °F value
int weatherTempC = 0;   // always stores raw °C value
```

`stepWeather2Frame()` picks: `(weather2Unit == "F") ? weatherTempF : weatherTempC`.
`weatherTempVal` (used by Weather 1) continues to be set as before.

---

## Icons — All 7 Categories

All icons occupy rows 0–3. Animated elements live in row 3. Row 2 is the widest row of both the sun dome and clouds.

### Category 0 — Sunny
Half-sun dome, flat top (full 8px diameter), curved downward:
```
Row 0: Y Y Y Y Y Y Y Y   (flat top = full diameter)
Row 1: . Y Y Y Y Y Y .   (arc narrowing)
Row 2: . . Y Y Y Y . .   (narrow dome tip — slightly dimmer)
```
5 sparkle ray positions (0-indexed): `(2,0)`, `(2,7)`, `(3,2)`, `(3,4)`, `(3,6)`.
Each ray has an independent phase counter (0–39). Brightness = `sin8(phase * 180 / 39)`. When phase completes, random delay (15–45 frames) before restarting. Phase offsets staggered: `[0, 15, 8, 23, 5]`.
Colors: core = `CRGB(255, 220, 0)`, tip = `CRGB(255, 192, 0)`, ray = `CRGB(255, 120, 0)`.

### Category 1 — Partly Cloudy
Full sunny dome (same as Category 0) but with a cloud drifting in from the right. Cloud pixels overwrite the right portion of the sun in rows 1–2:
- Row 0: full sun diameter (cols 0–7), no cloud (sun always full-width at top)
- Row 1: sun cols 0–4; cloud body cols 5–7
- Row 2: sun tip cols 2–3 only; cloud cols 4–7 (flat bottom — no poof, too narrow for bumps)
- Row 3: sun ray sparkle at cols 0 and 2 only (right-side rays suppressed by cloud)
Exact pixel boundaries can be tuned during implementation — the intent is a sun mostly visible with a partial cloud encroaching from the right.

### Category 2 — Cloudy
Same cloud shape as Rainy (rows 0–2) but no drops. Brightness of whole cloud pulses gently via `sin8(f * 3)` mapped to range 120–220.

### Category 3 — Fog
All 8 columns, rows 0–3 filled. Each row has a slightly different sine phase: `br = 30 + sin8(f*2 + row*35) / 6`. Dim blue-gray `CRGB(br, br, br+10)`.

### Category 4 — Rainy ✓ (approved)
Cloud at rows 0–2 (poofy bottom: `. X X X X X X .`):
```
Row 0: . . X X X X . .   (narrow top, cols 2–5)
Row 1: . X X X X X X .   (body, cols 1–6)
Row 2: . X X X X X X .   (poofy bottom, cols 1–6)
```
4 animated drops at row 3, cols `[1, 3, 5, 6]` (all under cloud). Each cycles bright → dim → off → off (4-frame period). Phase offsets: `[0, 1, 3, 2]`.
Drop colors: bright = `CRGB(0, 85, 238)`, dim = `CRGB(0, 30, 100)`.

### Category 5 — Snowy ✓ (approved)
Same cloud as Rainy. 3 animated flakes at row 3, cols `[2, 4, 6]`. Slower cycle (6-frame period): bright × 2 → dim × 1 → off × 3. Phase offsets: `[0, 3, 1]`.
Flake colors: bright = `CRGB(136, 200, 255)`, dim = `CRGB(40, 80, 120)`.

### Category 6 — Thunder
Same cloud as Cloudy but darker: `CRGB(70, 70, 95)`. Lightning bolt flashes at row 3:
- Visible for 2 frames every 25 (brief flash). When lit: cols 4 and 5 at row 3, `CRGB(255, 255, 200)`.

---

## HTML Page — weather2.html

### Controls (top to bottom)
1. **ZIP code** text input (default `"85013"`)
2. **F / °C** toggle buttons (default F)
3. **Color palette** — 64-entry grid (DF_PAL, same component as animations.html). Click sets c1/c2 pickers.
4. **Two color pickers** — c1 (tens) and c2 (units), labels "Tens" / "Units"
5. **Icon preview grid** — 7 small 56×56 canvas tiles (each = 8×8 matrix at 7px/cell), one per weather category: Sunny, Partly Cloudy, Cloudy, Foggy, Rainy, Snowy, Thunder. Tiles animate at ~6fps. Current condition tile is highlighted with a glowing border.
6. **Main 8×8 preview** — 144×144 live canvas showing current weather condition + chosen digit colors
7. **Launch button** → POST to `/api/display/animation`
8. **Status line**

### Palette behavior
Palette click → `clearWeather2Preset()` called on manual picker change (same pattern as wave/spiral).

### API payload
```json
{
  "type": "weather2",
  "zipcode": "85013",
  "units": "F",
  "color1": "#FFA500",
  "color2": "#FFDC50",
  "speed": 80
}
```

### Icon preview data
`fetchPreview()` calls `GET /api/sensors/weather` (existing endpoint) to get `category` and `temp` for the main preview canvas. All 7 icon tiles always animate regardless.

---

## New Globals (esp32_matrix_webserver.ino)

```cpp
// ── Weather 2 ─────────────────────────────────────────────────
String weather2Unit   = "F";
CRGB   weather2Color1 = CRGB(255, 165,  0);
CRGB   weather2Color2 = CRGB(255, 220, 80);

// Both temps always stored so Weather 1 and Weather 2 can use independent units
int    weatherTempF   = 0;
int    weatherTempC   = 0;
```

---

## New / Modified Firmware Functions

### weather.ino — new functions
- `drawWeather2Temp()` — renders temp using FONT_3X3 with 1/2/3-digit support + degree dot
- `drawSunnyIcon2(uint8_t f)` — dome + sparkle rays
- `drawPartlyCloudyIcon2(uint8_t f)` — mini sun + cloud
- `drawCloudyIcon2(uint8_t f)` — pulsing cloud
- `drawFogIcon2(uint8_t f)` — rippling dim bands
- `drawRainIcon2(uint8_t f)` — cloud + sparkle drops
- `drawSnowIcon2(uint8_t f)` — cloud + slow sparkle flakes
- `drawThunderIcon2(uint8_t f)` — dark cloud + lightning flash
- `stepWeather2Frame()` — main tick: triggers fetch if stale (600s), increments frame counter, dispatches icon draw, calls drawWeather2Temp()

### weather.ino — modified
- `fetchWeather()`: also sets `weatherTempF = tF` and `weatherTempC = tC` (in addition to existing `weatherTempVal`)

### esp32_matrix_webserver.ino — modified
- Add new globals above
- Animation dispatch: add `else if (animationName == "weather2") stepWeather2Frame();`

### api_handlers.ino — modified
- `handleAnimation()`: handle `type == "weather2"`, read color1/color2/units/zipcode, set globals

---

## New Files
- `data/weather2.html`

## Modified Files
- `weather.ino`
- `esp32_matrix_webserver.ino`
- `api_handlers.ino`
- `data/index.html` — add Weather 2 card (icon 🌡️, desc "Icon + temp simultaneously, color palette")

---

## Out of Scope
- Humidity, UV, pressure display (Weather 1 already covers these)
- Remote PNG icon mode
- Per-app brightness slider (can be added in a future pass with the other apps)
