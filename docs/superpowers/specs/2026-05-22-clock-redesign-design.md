# Clock Redesign Design

## Goal

Replace the single-color clock page with a 3-color system (Hours / Colon / Minutes), add an exact 8×8 pixel live preview that mirrors the board, add 32 complementary-color presets, and update the firmware to accept and use the three separate colors.

---

## Architecture

Three files change:

| File | Change |
|------|--------|
| `esp32_matrix_webserver/data/clock.html` | Full rewrite — 8×8 preview, 3 pickers, 32 presets, updated API call |
| `esp32_matrix_webserver/clock_timer.ino` | Refactor `drawTimeDisplay()` to accept 3 `CRGB` params; update `stepClockFrame()` to store and use them |
| `esp32_matrix_webserver/api_handlers.ino` | Parse `colorHours`, `colorColon`, `colorMinutes` from incoming JSON |

No new files. No build step. HTML/CSS/JS served from SPIFFS as-is.

---

## Pixel Layout (8×8 grid)

The preview and the firmware share the same layout:

```
     col: 0    1    2    3    4    5    6    7
row 0:  [H]  [H]  [H]  [H]  [H]  [H]  [H]  [H]   ← hours (3×3 font, rows 0–2)
row 1:  [H]  [H]  [H]  [H]  [H]  [H]  [H]  [H]
row 2:  [H]  [H]  [H]  [ ]  [H]  [H]  [H]  [ ]
row 3:  [ ]  [M]  [M]  [M]  [ ]  [M]  [M]  [M]   ← minutes (MINI_FONT 3×5, rows 3–7)
row 4:  [ ]  [M]  [M]  [M]  [ ]  [M]  [M]  [M]
row 5:  [C]  [M]  [M]  [M]  [ ]  [M]  [M]  [M]   ← colon dot at col 0 row 5
row 6:  [ ]  [M]  [M]  [M]  [ ]  [M]  [M]  [M]
row 7:  [C]  [M]  [M]  [M]  [ ]  [M]  [M]  [M]   ← colon dot at col 0 row 7
```

**Minutes columns:** colon[0] · tens[1–3] · gap[4] · units[5–7]

**Hours (3×3 font, rows 0–2):**
- Single digit (1–9): cols 0–2
- Double digit (10–12): `'1'` at cols 0–2, units digit at cols 4–6, 1-pixel gap at col 3

**Fonts:**
- Hours: `FONT_3X3` — each entry is `[col0, col1, col2]`, bit 0 = top row, bit 2 = bottom row
- Minutes: `MINI_FONT` (aka `FONT_3X5`) — each entry is `[col0, col1, col2]`, bit 0 = top row, bit 4 = bottom row

**Background:** Always black. No background color picker.

---

## Color System

Three independent colors:

| Element | Picker label | Default |
|---------|-------------|---------|
| Hours digits | Hours | `#ff3300` |
| Colon dots | Colon | `#ffffff` |
| Minutes digits | Minutes | `#00ccff` |

### Presets

32 swatches in an 8-column × 4-row grid (no scrollbar). Each swatch:
- Hue step: `360 / 32 = 11.25°`
- Hours color: that hue at full saturation/brightness
- Colon: always `#ffffff`
- Minutes color: complementary hue (`hue + 180°`)
- Visual: hours color fills top 65% of swatch, minutes color strip fills bottom 35%

Clicking a preset updates all three color pickers and re-renders the live preview.

---

## Live Preview

An 8×8 CSS grid of 22×22 px square divs (gap 3px, black background). Updates every second via `setInterval(updatePreview, 1000)` using `new Date()`. Responds immediately to any color picker or preset change.

The JS in `clock.html` embeds `FONT_3X3` and `MINI_FONT` data tables (matching `fonts.ino` exactly) and reimplements the same draw logic so the preview is pixel-perfect.

---

## API

**Endpoint:** `POST /api/display/animation`

Old payload:
```json
{ "type": "clock", "color": "#003366", "timezone": -7 }
```

New payload:
```json
{ "type": "clock", "colorHours": "#ff3300", "colorColon": "#ffffff", "colorMinutes": "#00ccff", "timezone": -7 }
```

---

## Firmware Changes

### `clock_timer.ino`

**Global state (replace single `clockBgColor`):**
```cpp
static CRGB clockColorHours  = CRGB(255, 51, 0);
static CRGB clockColorColon  = CRGB(255, 255, 255);
static CRGB clockColorMins   = CRGB(0, 204, 255);
```

**`drawTimeDisplay()` signature change:**
```cpp
// Before
void drawTimeDisplay(int hVal, int mVal, CRGB color);

// After
void drawTimeDisplay(int hVal, int mVal, CRGB colorH, CRGB colorC, CRGB colorM);
```

Internal logic:
- Colon dots: `matrix[row][0] = colorC` for rows 5 and 7
- Minutes tens: `MINI_FONT` at cols 1–3, rows 3–7, color `colorM`
- Minutes units: `MINI_FONT` at cols 5–7, rows 3–7, color `colorM`
- Hours single digit: `FONT_3X3` at cols 0–2, rows 0–2, color `colorH`
- Hours double digit: `FONT_3X3` `'1'` at cols 0–2, units at cols 4–6, rows 0–2, color `colorH`

**`stepClockFrame()`:** Replace `clockBgColor`/`digitColor` logic with the three static vars above. Fill background black. Call `drawTimeDisplay(h, m, clockColorHours, clockColorColon, clockColorMins)`.

### `api_handlers.ino`

In the `clock` case of the animation handler, parse three new hex fields and convert to `CRGB`:
```cpp
if (doc.containsKey("colorHours")) {
    // parse hex string → CRGB, store in clockColorHours
}
// same for colorColon, colorMinutes
```

Timezone parsing is unchanged.

---

## Out of Scope

- DST / daylight saving detection (existing behavior kept)
- Animated colon (future idea, not this iteration)
- Any other animation or page

---

## Success Criteria

1. `clock.html` live preview matches what the board displays pixel-for-pixel
2. Selecting a preset updates all 3 color pickers and the preview immediately
3. Manual picker changes update the preview immediately
4. Clicking "Start Clock" sends the three colors + timezone to the board
5. Board displays clock with hours, colon, and minutes each in their respective colors
6. Background is always black on the board
