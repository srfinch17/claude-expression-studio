# Calibration Lab (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Calibration Lab harness — a web wizard + firmware test patterns + a save/read round-trip — that produces a version-controlled `data/calibration.json`. This is Phase 1 of the spec `docs/superpowers/specs/2026-06-21-led-calibration-battery-design.md`; it ships and is useful on its own (the correction layer that consumes the file is Phase 3, a later plan).

**Architecture:** Reuse the existing static-display grid-test mechanism. Firmware gains new static test patterns (per-channel ramps/sweeps, white-balance patches, gamma ramp, single-pixel addressing) on the existing `/api/grid-test/set` endpoint, plus a `GET`/`POST /api/calibration` pair that reads/writes a `calibration.json` on LittleFS (mirroring how `version.json` is read at boot). A new `data/calibrate.html` wizard drives those patterns, captures eyeball observations, computes derived values in-browser (using the existing `ledsim.js` FastLED math), assembles the full `calibration.json`, and POSTs it to the board.

**Tech Stack:** Arduino C++ (ESP32 core, FastLED, ArduinoJson, LittleFS) for firmware; vanilla HTML/CSS/JS for the web page; no build step for web files.

## Verification model (read this first)

This repo has **no automated firmware/web test framework** — per `CLAUDE.md`, Claude cannot compile, flash, or see the LEDs. The real test cycle is:

1. Claude edits firmware (`.ino`) and/or web (`data/*.html`, `data/*.js`).
2. **User** does **Sketch → Upload** (firmware changed) and/or **LittleFS Data Upload** (web/`data/` changed). *These are two separate steps; the plan states which a task needs.*
3. Verification splits in two:
   - **Claude-runnable (HTTP):** Claude curls the board (reachable at `$ESP32_URL`, default `http://esp32matrix.local`) to confirm endpoints/JSON. These are exact commands with expected output.
   - **User-confirmed (eyeball):** the user reports what the panel shows. These are explicit "ask the user to confirm X" steps.

Each task ends with both kinds of verification (where applicable) and a commit. There is no "write a failing test first" step because there is no harness to run it — this is the deliberate, instruction-priority-correct adaptation of TDD to this codebase's hardware-in-the-loop loop.

## Global Constraints

- **COLOR_ORDER is `RGB`** (not GRB) — `CRGB(r,g,b)` maps straight through. Verbatim from `CLAUDE.md`.
- **Data pin 14, 64 WS2812B LEDs, `XY(x,y) = y*8 + x`** (row-major, NOT serpentine). Draw via `setPixel(x,y,CRGB)` (bounds-checked).
- **Calibration brightness must NEVER persist to NVS.** Reuse the existing `resumeBri` separation: a calibration run often drives the panel at 255, and a board booting all-lit at 255 pulls ~3-4A and browns out USB (see `docs/PITFALLS.md`). The existing `handleGridTest` already sets only the live `brightness`/`gridTestBrightness`, never `resumeBri` — preserve that.
- **All `.ino` files compile as one translation unit.** New globals and any helper used across files go in the main `esp32_matrix_webserver.ino`; route registration lives in its `setup()`. Function-ordering/auto-prototype traps slip past code review to the flash step — keep shared `#define`s/globals in the main ino (see `feedback_firmware_review_limits`).
- **Web `data/` changes require a LittleFS upload to go live; firmware `.ino` changes require a flash.** A change is not testable until its artifact is deployed.
- **Privacy:** never use the maintainer's real name in code/comments — refer to "the user".
- **calibration.json schema is fixed by the spec** — keys: `version`, `measured_at`, `board`, `floors{r,g,b}`, `white_balance{r,g,b}`, `gamma`, `palette{}`, `steps`, `pixel_trim`. Phase 1 ships identity defaults; Phase 2 fills real values.
- **Absence/parse-failure must degrade to identity** (floors=1, gains=1.0, gamma=1.0, palette={}, steps=0, pixel_trim=null) — never break rendering or the page.
- **Don't hand-edit `version.h`/`data/version.json`** — generated. Version bumps go through `npm run bump:*`.

## File Structure

- `esp32_matrix_webserver/api_handlers.ino` — modify `handleGridTest()` to add the new pattern modes; add `handleCalibrationGet()` and `handleCalibrationPost()`.
- `esp32_matrix_webserver/esp32_matrix_webserver.ino` — register the two new routes in `setup()`; (no boot-time read of calibration.json in Phase 1 — that is Phase 3).
- `esp32_matrix_webserver/data/calibration.json` — **new**, identity defaults, committed so `GET` and a future LittleFS upload always have a known file.
- `esp32_matrix_webserver/data/calibrate.html` — **new**, the Lab wizard (carries over the red ramp/sweep logic + chrome from `grid_test.html`).
- `esp32_matrix_webserver/data/grid_test.html` — replace body with a redirect stub to `/calibrate.html` (preserve bookmarks; the Lab supersedes it).
- `esp32_matrix_webserver/data/system.html` — repoint the 🔬 card to `/calibrate.html` and relabel "Calibration Lab".
- `docs/LED_BRIGHTNESS.md` — replace the empty "Empirical observations (TO FILL IN)" section with a pointer to `data/calibration.json` as the machine-readable source of truth.

---

### Task 1: `calibration.json` + GET/POST endpoints

**Files:**
- Create: `esp32_matrix_webserver/data/calibration.json`
- Modify: `esp32_matrix_webserver/api_handlers.ino` (add two handlers, end of file near `handleGridTest`)
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (register routes in `setup()`, next to the `/api/grid-test/set` line ~759)

**Interfaces:**
- Produces: `GET /api/calibration` → returns the LittleFS `calibration.json` verbatim, or the identity-default JSON (below) if the file is absent/unreadable. `POST /api/calibration` → writes the request body to `/calibration.json` on LittleFS; returns `{"status":"ok"}` or `{"error":...}`. Both used by `calibrate.html` (Task 6).

- [ ] **Step 1: Create the identity-default calibration file**

`esp32_matrix_webserver/data/calibration.json`:

```json
{
  "version": 1,
  "measured_at": "",
  "board": "esp32-s3-matrix",
  "floors": { "r": 1, "g": 1, "b": 1 },
  "white_balance": { "r": 1.0, "g": 1.0, "b": 1.0 },
  "gamma": 1.0,
  "palette": {},
  "steps": 0,
  "pixel_trim": null
}
```

- [ ] **Step 2: Add the GET handler**

In `api_handlers.ino`, after `handleGridTest()` (~line 849), add. The identity default is returned as a literal string so a missing file still yields a valid, schema-correct response:

```cpp
// GET /api/calibration — return the measured calibration profile (LittleFS
// /calibration.json), or identity defaults if the file is absent/unreadable.
// Identity defaults = "do nothing": floors 1, gains 1.0, gamma 1.0, no palette.
static const char CALIB_IDENTITY[] =
  "{\"version\":1,\"measured_at\":\"\",\"board\":\"esp32-s3-matrix\","
  "\"floors\":{\"r\":1,\"g\":1,\"b\":1},"
  "\"white_balance\":{\"r\":1.0,\"g\":1.0,\"b\":1.0},"
  "\"gamma\":1.0,\"palette\":{},\"steps\":0,\"pixel_trim\":null}";

void handleCalibrationGet() {
  if (LittleFS.exists("/calibration.json")) {
    File f = LittleFS.open("/calibration.json", "r");
    if (f) { server.streamFile(f, "application/json"); f.close(); return; }
  }
  sendJson(200, String(CALIB_IDENTITY));
}
```

- [ ] **Step 3: Add the POST handler**

```cpp
// POST /api/calibration — overwrite /calibration.json on LittleFS with the body.
// Best-effort: the Calibration Lab saves measured results here; the repo copy is
// committed separately so a later LittleFS upload stays byte-identical.
void handleCalibrationPost() {
  String body = server.arg("plain");
  // Validate it parses as JSON before persisting — never write garbage.
  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    sendJson(400, "{\"error\":\"Invalid JSON\"}");
    return;
  }
  File f = LittleFS.open("/calibration.json", "w");
  if (!f) { sendJson(500, "{\"error\":\"Cannot open file for write\"}"); return; }
  f.print(body);
  f.close();
  sendJson(200, "{\"status\":\"ok\"}");
}
```

- [ ] **Step 4: Register the routes**

In `esp32_matrix_webserver.ino` `setup()`, immediately after the `/api/grid-test/set` registration (~line 759):

```cpp
  server.on("/api/calibration",          HTTP_GET,  handleCalibrationGet);
  server.on("/api/calibration",          HTTP_POST, handleCalibrationPost);
```

- [ ] **Step 5: User deploys**

Ask the user to **Sketch → Upload** (firmware changed) **and** **LittleFS Data Upload** (new `calibration.json`). Tell them: "Both steps — firmware for the endpoints, LittleFS for the default file."

- [ ] **Step 6: Verify via HTTP (Claude runs)**

```bash
curl -s "$ESP32_URL/api/calibration"
```
Expected: the identity-default JSON (`"gamma":1.0`, `"floors":{"r":1,...}`).

```bash
curl -s -X POST "$ESP32_URL/api/calibration" -H "Content-Type: application/json" \
  -d '{"version":1,"measured_at":"test","board":"esp32-s3-matrix","floors":{"r":3,"g":4,"b":2},"white_balance":{"r":1.0,"g":0.7,"b":0.85},"gamma":2.1,"palette":{},"steps":24,"pixel_trim":null}'
curl -s "$ESP32_URL/api/calibration"
```
Expected: POST returns `{"status":"ok"}`; the second GET echoes `"measured_at":"test"` and `"gamma":2.1` — proving the write persisted. Then restore the default:
```bash
curl -s -X POST "$ESP32_URL/api/calibration" -H "Content-Type: application/json" \
  --data-binary @esp32_matrix_webserver/data/calibration.json
```
Expected: `{"status":"ok"}`, and a final GET matches the committed default.

- [ ] **Step 7: Commit**

```bash
git add esp32_matrix_webserver/data/calibration.json esp32_matrix_webserver/api_handlers.ino esp32_matrix_webserver/esp32_matrix_webserver.ino
git commit -m "feat(calibration): calibration.json + GET/POST endpoints"
```

---

### Task 2: Firmware calibration test patterns

**Files:**
- Modify: `esp32_matrix_webserver/api_handlers.ino` — `handleGridTest()` (~822-849)

**Interfaces:**
- Consumes: existing `gridTestMode` (String), `gridTestBrightness`, `brightness`, `leds[]`, `stopAll()`, `setPixel`.
- Produces: `POST /api/grid-test/set` now accepts these `mode` values (in addition to the existing `color`/`brightness`): `ramp_r|ramp_g|ramp_b` (per-channel ramp, value `=(i+1)*4` on that channel), `sweep_r|sweep_g|sweep_b` (all 64 = full that channel — dim via `brightness` to find cutoff), `patch_rgb` (a fixed split: cols 0-2 red, 3-4 blank, 5-7… see below — equal raw value per channel for white-balance comparison), `gamma` (an 8-step value ramp, one value per row, `value=row*32`), and `pixel` (single lit pixel at index from `doc["index"]`). Called by `calibrate.html` (Tasks 3-5).

- [ ] **Step 1: Replace the pattern-render block in `handleGridTest()`**

Keep the parse/`stopAll()`/brightness lines (822-836) and the final `FastLED.show()`/response (847-848). Replace the `if (gridTestMode == "color") {...} else {...}` block (838-845) with:

```cpp
  // Helper: per-channel ramp value for linear index i (R/G/B steps of 4).
  auto rampVal = [](int i) -> uint8_t { return (uint8_t)constrain((i + 1) * 4, 0, 255); };

  fill_solid(leds, NUM_LEDS, CRGB::Black);

  if (gridTestMode == "color" || gridTestMode == "ramp_r") {
    for (int i = 0; i < NUM_LEDS; i++) leds[i] = CRGB(rampVal(i), 0, 0);
  } else if (gridTestMode == "ramp_g") {
    for (int i = 0; i < NUM_LEDS; i++) leds[i] = CRGB(0, rampVal(i), 0);
  } else if (gridTestMode == "ramp_b") {
    for (int i = 0; i < NUM_LEDS; i++) leds[i] = CRGB(0, 0, rampVal(i));
  } else if (gridTestMode == "brightness" || gridTestMode == "sweep_r") {
    fill_solid(leds, NUM_LEDS, CRGB(255, 0, 0));
  } else if (gridTestMode == "sweep_g") {
    fill_solid(leds, NUM_LEDS, CRGB(0, 255, 0));
  } else if (gridTestMode == "sweep_b") {
    fill_solid(leds, NUM_LEDS, CRGB(0, 0, 255));
  } else if (gridTestMode == "patch_rgb") {
    // Three equal-value patches for white-balance comparison: a full column band
    // each of R, G, B at the SAME raw value (the JS sends `brightness` to scale all
    // three equally). Columns 0-1 = R, 3-4 = G, 6-7 = B; gaps stay dark.
    uint8_t v = 255;
    for (int y = 0; y < 8; y++) {
      setPixel(0, y, CRGB(v,0,0)); setPixel(1, y, CRGB(v,0,0));
      setPixel(3, y, CRGB(0,v,0)); setPixel(4, y, CRGB(0,v,0));
      setPixel(6, y, CRGB(0,0,v)); setPixel(7, y, CRGB(0,0,v));
    }
  } else if (gridTestMode == "gamma") {
    // 8-step grey ramp, one value per row (row 0 dimmest), full white channels.
    for (int y = 0; y < 8; y++) {
      uint8_t v = (uint8_t)constrain((y + 1) * 32 - 1, 0, 255);
      for (int x = 0; x < 8; x++) setPixel(x, y, CRGB(v, v, v));
    }
  } else if (gridTestMode == "pixel") {
    int idx = constrain((int)(doc["index"] | 0), 0, NUM_LEDS - 1);
    leds[idx] = CRGB(255, 255, 255);
  }
```

- [ ] **Step 2: Update the handler's doc comment**

Replace the comment block above `handleGridTest()` (804-821) to list all modes (color/ramp_r/ramp_g/ramp_b, brightness/sweep_r/sweep_g/sweep_b, patch_rgb, gamma, pixel) and note `pixel` reads `index`. One concise paragraph per group.

- [ ] **Step 3: User deploys**

Ask the user to **Sketch → Upload** (firmware only — no `data/` change this task).

- [ ] **Step 4: Verify via HTTP + eyeball**

For each mode, Claude POSTs and the user reports. Example:
```bash
curl -s -X POST "$ESP32_URL/api/grid-test/set" -H "Content-Type: application/json" -d '{"mode":"ramp_g","brightness":255}'
```
Expected response: `{"status":"ok","mode":"ramp_g",...}`. Ask the user to confirm the board shows a **green** gradient (dim top-left → bright bottom-right). Repeat for `ramp_b` (blue gradient), `sweep_g`/`sweep_b` (full green / full blue), `patch_rgb` (three vertical bands R|G|B), `gamma` (8 rows dim→bright white), and `pixel` with `{"mode":"pixel","index":0}` then `index:63` (single white pixel top-left, then bottom-right). After testing, clear: `curl -s -X POST "$ESP32_URL/api/display/clear" -d '{}'`.

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/api_handlers.ino
git commit -m "feat(calibration): firmware test patterns (per-channel ramp/sweep, patches, gamma, pixel)"
```

---

### Task 3: `calibrate.html` scaffold + per-channel floors section

**Files:**
- Create: `esp32_matrix_webserver/data/calibrate.html`

**Interfaces:**
- Consumes: `POST /api/grid-test/set` (Task 2 modes), `ledsim.js` global `LedSim` (`effective`, `minVisibleChannel`), `header.js` (shared chrome).
- Produces: a global `CALIB` JS object accumulating measured values (`CALIB.floors = {r,g,b}` after this task); a `showPattern(mode, opts)` helper; a `section`-based wizard layout that Tasks 4-5 extend.

- [ ] **Step 1: Build the page shell**

Create `data/calibrate.html` copying the `<head>`/CSS chrome and the back-link/header pattern from `grid_test.html` (reuse its styles; relabel `<h1>` to "🔬 Calibration Lab"). Include at the end, like every page:
```html
<script src="ledsim.js"></script>
<script src="header.js" data-auto></script>
```
Lay the body out as a vertical stack of `<section class="cal-section">` blocks, each with a title, an on-screen protocol paragraph, a "Show on board" button, observation input(s), and a computed-value readout. Add the shared accumulator and helpers in a `<script>`:

```js
const ESP = '';  // same-origin
const CALIB = {
  version: 1, measured_at: new Date().toISOString().slice(0,10),
  board: 'esp32-s3-matrix',
  floors: { r: 1, g: 1, b: 1 },
  white_balance: { r: 1.0, g: 1.0, b: 1.0 },
  gamma: 1.0, palette: {}, steps: 0, pixel_trim: null
};
async function showPattern(mode, opts = {}) {
  const body = Object.assign({ mode, brightness: 255 }, opts);
  try {
    const r = await fetch('/api/grid-test/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.ok;
  } catch { return false; }
}
// raw channel value for a linear cell index (matches firmware rampVal)
function rampVal(i) { return Math.min((i + 1) * 4, 255); }
```

- [ ] **Step 2: Build the per-channel floors section**

For each channel (r, g, b), a control that: (a) "Show ramp" → `showPattern('ramp_'+ch)`, (b) an input "first lit cell # (1-64)", (c) "Show sweep" → `showPattern('sweep_'+ch, {brightness: <sliderVal>})` with a brightness slider to find the cutoff, (d) computes the floor. Core compute logic:

```js
// From the ramp: the first visible cell's raw channel value is the channel's raw
// floor at full brightness. Convert to an EFFECTIVE-value floor (what the
// correction layer stores): at full bri, effective == raw, so floor = that raw
// value's effective at 255 — i.e. the raw value itself (>>0). We store the raw
// first-lit value as the effective floor reference.
function setFloorFromRamp(ch, firstCell) {
  const idx = Math.max(1, Math.min(64, firstCell)) - 1;
  CALIB.floors[ch] = rampVal(idx);   // raw value of first lit cell
  document.getElementById('floor-' + ch).textContent = CALIB.floors[ch];
}
```

Wire a brightness slider for the sweep that calls `showPattern('sweep_'+ch, {brightness})` (debounced, like `grid_test.html`'s `onBriSlider`). The sweep is the cross-check: the brightness at which the full channel just goes dark gives the same floor via `LedSim.effective(255, bri)`.

- [ ] **Step 3: User deploys**

Ask the user to **LittleFS Data Upload** (new `calibrate.html`; web only).

- [ ] **Step 4: Verify (eyeball + interaction)**

Ask the user to open `http://esp32matrix.local/calibrate.html`, confirm the page loads with the shared header, and that clicking "Show ramp" for each of R/G/B drives the matching gradient on the board. Confirm entering a "first lit cell" updates the floor readout. (No calibration.json save yet — that is Task 6.)

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/data/calibrate.html
git commit -m "feat(calibration): Calibration Lab scaffold + per-channel floors section"
```

---

### Task 4: White-balance + gamma sections

**Files:**
- Modify: `esp32_matrix_webserver/data/calibrate.html`

**Interfaces:**
- Consumes: `CALIB`, `showPattern` (Task 3).
- Produces: `CALIB.white_balance = {r,g,b}` and `CALIB.gamma` populated.

- [ ] **Step 1: White-balance section**

"Show patches" → `showPattern('patch_rgb')` (three equal-value R/G/B bands). Protocol on screen: "All three bands are the same raw value. Adjust each band's value until the three look equally bright." Provide three number inputs (0-255, default 255) that re-POST `patch_rgb` with per-channel scaling — extend `showPattern` use by sending a custom body the firmware understands. **Note:** Task 2's `patch_rgb` uses a fixed `v=255`; to support per-band tuning, add to the firmware `patch_rgb` branch reading `doc["pr"]|255`, `doc["pg"]|255`, `doc["pb"]|255` for the three band values (small follow-up edit in this task — include it).

Firmware tweak (in `api_handlers.ino`, `patch_rgb` branch):
```cpp
  } else if (gridTestMode == "patch_rgb") {
    uint8_t pr = (uint8_t)constrain((int)(doc["pr"] | 255), 0, 255);
    uint8_t pg = (uint8_t)constrain((int)(doc["pg"] | 255), 0, 255);
    uint8_t pb = (uint8_t)constrain((int)(doc["pb"] | 255), 0, 255);
    for (int y = 0; y < 8; y++) {
      setPixel(0, y, CRGB(pr,0,0)); setPixel(1, y, CRGB(pr,0,0));
      setPixel(3, y, CRGB(0,pg,0)); setPixel(4, y, CRGB(0,pg,0));
      setPixel(6, y, CRGB(0,0,pb)); setPixel(7, y, CRGB(0,0,pb));
    }
```

Compute gains: the matched values are inversely proportional to channel strength. Normalize so the **dimmest** channel (largest matched value) = 1.0:
```js
function computeWhiteBalance(vr, vg, vb) {
  const maxV = Math.max(vr, vg, vb);     // dimmest channel needed the most → ref
  CALIB.white_balance = {
    r: +(vr / maxV).toFixed(3),
    g: +(vg / maxV).toFixed(3),
    b: +(vb / maxV).toFixed(3)
  };
  // readout
  for (const ch of ['r','g','b'])
    document.getElementById('wb-' + ch).textContent = CALIB.white_balance[ch];
}
```

- [ ] **Step 2: Gamma section**

"Show ramp" → `showPattern('gamma')` (8-row dim→bright white ramp). Protocol: "Do the steps look evenly spaced, or do the dark ones bunch together? Adjust the slider until the perceived jumps are even." A slider 1.0-3.0 sets `CALIB.gamma`; show a small canvas preview that applies `value**(1/gamma)` so the user can match screen-to-panel:
```js
function setGamma(g) {
  CALIB.gamma = +(+g).toFixed(2);
  document.getElementById('gamma-val').textContent = CALIB.gamma;
  // optional: redraw an 8-swatch canvas preview using v_disp = 255*(v/255)**(1/g)
}
```

- [ ] **Step 2.5: Firmware deploy for the patch tweak**

Because Step 1 added `pr/pg/pb` to the firmware, ask the user to **Sketch → Upload** (firmware) **and** **LittleFS Data Upload** (calibrate.html). State both.

- [ ] **Step 3: Verify (eyeball)**

Ask the user to confirm: the three white-balance bands respond to the per-band inputs, the gain readout updates and the dimmest channel reads 1.0; the gamma ramp shows on the board and the slider updates `CALIB.gamma`.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/calibrate.html esp32_matrix_webserver/api_handlers.ino
git commit -m "feat(calibration): white-balance + gamma sections (+ per-band patch values)"
```

---

### Task 5: Secondary colors + per-pixel + steps sections

**Files:**
- Modify: `esp32_matrix_webserver/data/calibrate.html`

**Interfaces:**
- Consumes: `CALIB`, `showPattern`, `POST /api/display/matrix` (existing endpoint, for arbitrary hex fills) and `pixel` mode (Task 2).
- Produces: `CALIB.palette = {name: hex}`, `CALIB.steps` (int), and `CALIB.pixel_trim` (null unless the user records outliers).

- [ ] **Step 1: Secondary/mixed colors section**

For each candidate (amber, cyan, magenta, orange, white) show a color picker pre-filled with a starting hex, a "Show on board" button that fills the panel via the existing matrix endpoint, and a brightness control to check low-bri legibility:
```js
async function showSolid(hex) {
  const row = Array(8).fill(hex.replace('#',''));
  const matrix = Array(8).fill(row);
  await fetch('/api/display/matrix', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matrix })
  });
}
function recordPalette(name, hex) {
  CALIB.palette[name] = hex;
  document.getElementById('pal-' + name).textContent = hex;
}
```
Protocol on screen: "Does this read as <name> at full brightness? At brightness 5? Nudge the picker until it reads true at both, then Record."

- [ ] **Step 2: Per-pixel uniformity section (optional)**

A "Walk pixels" control that steps `showPattern('pixel', {index:i})` from 0→63 (a Next button or auto-advance with a delay), and a textarea to note outlier indices. Default leaves `CALIB.pixel_trim = null`; only if the user records outliers do we build a 64-length array of gains (1.0 except noted). Keep it explicitly optional in the UI copy.

- [ ] **Step 3: Distinguishable-steps section**

Reuse the `gamma` ramp (8 distinct rows) plus a finer follow-up: a control that fills the panel at a chosen brightness and lets the user step brightness up/down to count how many *distinct* levels they perceive; an input records the count into `CALIB.steps`:
```js
function setSteps(n) { CALIB.steps = Math.max(0, parseInt(n,10)||0);
  document.getElementById('steps-val').textContent = CALIB.steps; }
```

- [ ] **Step 4: User deploys**

Ask the user to **LittleFS Data Upload** (calibrate.html; web only).

- [ ] **Step 5: Verify (eyeball)**

Ask the user to confirm each secondary color fills the panel and the picker records its hex; the pixel walk lights one pixel at a time across all 64; the steps input records a number.

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/data/calibrate.html
git commit -m "feat(calibration): secondary-color, per-pixel, and distinguishable-steps sections"
```

---

### Task 6: Assemble + Save round-trip; wire navigation & docs

**Files:**
- Modify: `esp32_matrix_webserver/data/calibrate.html` (save UI)
- Modify: `esp32_matrix_webserver/data/grid_test.html` (redirect stub)
- Modify: `esp32_matrix_webserver/data/system.html` (card)
- Modify: `docs/LED_BRIGHTNESS.md` (pointer)

**Interfaces:**
- Consumes: `CALIB` (fully populated), `POST /api/calibration` (Task 1), `GET /api/calibration` (Task 1).

- [ ] **Step 1: Save section in `calibrate.html`**

A "Review & Save" section that pretty-prints `CALIB` into a `<pre>` and a Save button:
```js
function reviewCalibration() {
  CALIB.measured_at = new Date().toISOString().slice(0,10);
  document.getElementById('calib-json').textContent = JSON.stringify(CALIB, null, 2);
}
async function saveCalibration() {
  reviewCalibration();
  const r = await fetch('/api/calibration', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CALIB)
  });
  document.getElementById('save-status').textContent =
    r.ok ? '✓ Saved to board. Ask Claude to commit the repo copy.' : 'Save failed: HTTP ' + r.status;
}
```

- [ ] **Step 2: Redirect stub for `grid_test.html`**

Replace the file contents with:
```html
<!DOCTYPE html>
<meta charset="UTF-8">
<title>Moved → Calibration Lab</title>
<meta http-equiv="refresh" content="0; url=/calibrate.html">
<p>Grid Test is now the <a href="/calibrate.html">Calibration Lab</a>.</p>
```

- [ ] **Step 3: Repoint the system.html card**

In `data/system.html`, change the `🔬` card `href` from `/grid_test.html` to `/calibrate.html`, the name to "Calibration Lab", and the desc to "Measure the board's real color/brightness behavior into calibration.json".

- [ ] **Step 4: Update `docs/LED_BRIGHTNESS.md`**

Replace the "## Empirical observations (TO FILL IN)" section and its placeholder table with:
```markdown
## Empirical observations → `data/calibration.json`

Measured ground truth now lives in the machine-readable `data/calibration.json`,
produced by the Calibration Lab (`/calibrate.html`) and consumed by the firmware
correction layer, `ledsim.js`, and the MCP. See
`docs/superpowers/specs/2026-06-21-led-calibration-battery-design.md`. Re-run the
Lab and re-commit that file to update the numbers — do not transcribe them here.
```

- [ ] **Step 5: User deploys**

Ask the user to **LittleFS Data Upload** (calibrate.html, grid_test.html, system.html; web only).

- [ ] **Step 6: Verify the full round-trip (Claude + eyeball)**

Ask the user to open the Lab, click Save (with whatever values are entered). Then Claude confirms persistence and commits the board's bytes to the repo:
```bash
curl -s "$ESP32_URL/api/calibration" -o esp32_matrix_webserver/data/calibration.json
cat esp32_matrix_webserver/data/calibration.json
```
Expected: the saved values (not identity defaults). Confirm `http://esp32matrix.local/grid_test.html` redirects to the Lab, and the system page card opens the Lab.

- [ ] **Step 7: Commit + version bump**

```bash
git add esp32_matrix_webserver/data/calibrate.html esp32_matrix_webserver/data/grid_test.html esp32_matrix_webserver/data/system.html esp32_matrix_webserver/data/calibration.json docs/LED_BRIGHTNESS.md
git commit -m "feat(calibration): save round-trip + Lab navigation + docs pointer"
npm run bump:minor   # Phase 1 ships the Calibration Lab → minor bump
git add -A && git commit -m "chore: bump $(cat VERSION)"   # if bump didn't self-commit
```
Note: `npm run bump:minor` rewrites VERSION + stamps firmware/web/MCP and commits per the versioning system. After merge, deploy each artifact (flash, LittleFS upload, MCP reconnect) to clear drift.

---

## Self-Review

**Spec coverage (Phase 1 scope only):**
- calibration.json contract → Task 1 (file + endpoints + identity fallback). ✓
- Per-channel floors test → Tasks 2 (patterns) + 3 (UI/compute). ✓
- White balance + gamma → Tasks 2/4. ✓
- Secondary/mixed colors → Tasks 2 (matrix fills) + 5. ✓
- Per-pixel + steps (optional) → Task 5. ✓
- Web-app captures + computes + writes calibration.json → Tasks 3-6. ✓
- Sync rule (read back, commit exact bytes) → Task 6 Step 6. ✓
- resumeBri / no-NVS-for-calibration-brightness → Global Constraints + reuse of `handleGridTest` (unchanged brightness handling). ✓
- grid_test redirect/retire decision → resolved: redirect stub (Task 6). ✓
- Correction layer, settings toggle, ledsim/MCP consumption, re-review → **intentionally NOT in this plan** (Phase 3/4, later plans). ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code; verification steps give exact curl commands + explicit eyeball asks. The only deliberate "optional/empty" is `pixel_trim: null`, which is the spec-defined default.

**Type/name consistency:** `CALIB` shape matches the calibration.json schema and Task 1's identity default. `showPattern(mode, opts)`, `rampVal(i)`, `CALIB.floors/white_balance/gamma/palette/steps/pixel_trim` are used consistently across Tasks 3-6. Firmware modes (`ramp_*`, `sweep_*`, `patch_rgb` with `pr/pg/pb`, `gamma`, `pixel` with `index`) match between Task 2/4 (firmware) and Tasks 3-5 (callers).

**Note on patch_rgb:** Task 2 introduces a fixed-value `patch_rgb`; Task 4 extends it with `pr/pg/pb` and re-flashes. This ordering is intentional (Task 2 verifies the simple pattern first), and Task 4 Step 2.5 calls out the extra flash.
