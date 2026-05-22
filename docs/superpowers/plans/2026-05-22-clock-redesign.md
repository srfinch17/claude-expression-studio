# Clock Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-color clock feature with a 3-color system (Hours / Colon / Minutes), add a live 8×8 pixel preview in the web UI, and update the firmware to render with the new layout and color scheme.

**Architecture:** Three files change. Firmware changes first (Tasks 1–2), UI change last (Task 3). The firmware and UI tasks are independent after Task 2 completes — either order works. No new files. No build pipeline. HTML/CSS/JS served directly from SPIFFS.

**Tech Stack:** Arduino C++ (FastLED, ArduinoJson, ESP-IDF configTime), vanilla HTML/CSS/JS.

**Spec:** `docs/superpowers/specs/2026-05-22-clock-redesign-design.md`

---

## File Map

| File | Change |
|------|--------|
| `esp32_matrix_webserver/esp32_matrix_webserver.ino` | Lines 147–151: replace `clockBgColor` with three color globals |
| `esp32_matrix_webserver/clock_timer.ino` | Lines 84–166: rewrite `drawTimeDisplay()` signature + body; Lines 334–366: update `stepClockFrame()` |
| `esp32_matrix_webserver/api_handlers.ino` | Lines 142–153: parse `colorHours`/`colorColon`/`colorMinutes` instead of `color` |
| `esp32_matrix_webserver/data/clock.html` | Full rewrite — 8×8 preview, 3 color pickers, 32 presets, updated API call |

---

## Task 1: Firmware globals

**Files:**
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino:147–151`

This task is purely additive. It adds three new color globals and removes the old `clockBgColor`. The rest of the firmware still references `clockBgColor` after this step — Task 2 fixes those references. **Do not compile between Task 1 and Task 2.**

- [ ] **Step 1: Replace the clock state block**

Find this block (lines 146–151):

```cpp
// ── Clock state ───────────────────────────────────────────────
CRGB     clockBgColor  = CRGB(0, 0, 64);   // background fill color
int      clockTimezone = -7;               // UTC offset in hours (e.g. -7 = Arizona MST)
bool     ntpSynced     = false;
int      clockPrevHour = -1;               // used to skip redraws when nothing changed
int      clockPrevMin  = -1;
```

Replace it with:

```cpp
// ── Clock state ───────────────────────────────────────────────
CRGB     clockColorHours = CRGB(255,  51,   0);  // hours digit color    (#FF3300)
CRGB     clockColorColon = CRGB(255, 255, 255);  // colon dot color      (#FFFFFF)
CRGB     clockColorMins  = CRGB(  0, 204, 255);  // minutes digit color  (#00CCFF)
int      clockTimezone   = -7;                   // UTC offset in hours (e.g. -7 = Arizona MST)
bool     ntpSynced       = false;
int      clockPrevHour   = -1;                   // used to skip redraws when nothing changed
int      clockPrevMin    = -1;
```

---

## Task 2: Firmware logic — drawTimeDisplay, stepClockFrame, api handler

**Files:**
- Modify: `esp32_matrix_webserver/clock_timer.ino:84–166` (drawTimeDisplay)
- Modify: `esp32_matrix_webserver/clock_timer.ino:334–366` (stepClockFrame)
- Modify: `esp32_matrix_webserver/api_handlers.ino:142–153` (clock case)

All three edits in this task must be done before compiling — they're interdependent. After all three edits, compile and flash.

### 2a — Rewrite `drawTimeDisplay()`

- [ ] **Step 1: Replace the entire `drawTimeDisplay()` function**

Find and replace the function at lines 67–166 of `clock_timer.ino`. The old function starts at:

```cpp
// ── drawTimeDisplay ───────────────────────────────────────────
```

and ends just before `// Linearly interpolates between two CRGB colors.`

Replace with:

```cpp
// ── drawTimeDisplay ───────────────────────────────────────────
// Renders H:MM on the 8×8 matrix using three independent colors.
//
// LAYOUT:
//   Rows 0–2  : hours  (FONT_3X3, 3×3 pixels)
//   Rows 3–7  : minutes (MINI_FONT, 3×5 pixels)
//   Col layout: colon[0] · tens[1–3] · gap[4] · units[5–7]
//   Colon dots: col 0, rows 5 and 7
//
// HOURS:
//   1–9  : single digit at cols 0–2
//   10–12: '1' at cols 0–2, units digit at cols 4–6 (col 3 gap)
void drawTimeDisplay(int hVal, int mVal, CRGB colorH, CRGB colorC, CRGB colorM) {
  // Colon dots
  setPixel(0, 5, colorC);
  setPixel(0, 7, colorC);

  // Minutes — MINI_FONT, rows 3–7
  // tens at cols 1–3, units at cols 5–7, col 4 is the 1-pixel gap
  int mTens  = (mVal / 10) % 10;
  int mUnits = mVal % 10;
  for (int col = 0; col < 3; col++) {
    uint8_t bT = pgm_read_byte(&MINI_FONT[mTens][col]);
    uint8_t bU = pgm_read_byte(&MINI_FONT[mUnits][col]);
    for (int row = 0; row < 5; row++) {
      if ((bT >> row) & 1) setPixel(col + 1, row + 3, colorM);
      if ((bU >> row) & 1) setPixel(col + 5, row + 3, colorM);
    }
  }

  // Hours — FONT_3X3, rows 0–2
  // FONT_3X3 digits are at indices 26–35 (0=index 26, 1=index 27, …, 9=index 35)
  if (hVal <= 9) {
    int idx = 26 + hVal;
    for (int col = 0; col < 3; col++) {
      uint8_t bits = pgm_read_byte(&FONT_3X3[idx][col]);
      for (int row = 0; row < 3; row++)
        if ((bits >> row) & 1) setPixel(col, row, colorH);
    }
  } else {
    // Draw '1' (index 27) at cols 0–2
    for (int col = 0; col < 3; col++) {
      uint8_t bits = pgm_read_byte(&FONT_3X3[27][col]);
      for (int row = 0; row < 3; row++)
        if ((bits >> row) & 1) setPixel(col, row, colorH);
    }
    // Draw units digit at cols 4–6
    int idxU = 26 + (hVal % 10);
    for (int col = 0; col < 3; col++) {
      uint8_t bits = pgm_read_byte(&FONT_3X3[idxU][col]);
      for (int row = 0; row < 3; row++)
        if ((bits >> row) & 1) setPixel(col + 4, row, colorH);
    }
  }
}
```

### 2b — Update `stepClockFrame()`

- [ ] **Step 2: Replace the entire `stepClockFrame()` function**

Find the function starting at line 334 (`void stepClockFrame() {`) and replace through its closing brace:

```cpp
void stepClockFrame() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 100)) {
    // NTP not yet synced — pulse dim white while waiting
    uint8_t pulse = (uint8_t)(128 + 60 * sinf(millis() / 800.0f));
    fill_solid(leds, NUM_LEDS, CRGB(pulse, pulse, pulse));
    return;
  }
  ntpSynced = true;

  // Convert 24h → 12h, treating 0 as 12
  int h = timeinfo.tm_hour % 12;
  if (h == 0) h = 12;
  int m = timeinfo.tm_min;

  // Skip redraw if nothing changed since last frame
  if (h == clockPrevHour && m == clockPrevMin) return;
  clockPrevHour = h;
  clockPrevMin  = m;

  fill_solid(leds, NUM_LEDS, CRGB::Black);
  drawTimeDisplay(h, m, clockColorHours, clockColorColon, clockColorMins);
}
```

### 2c — Update the clock case in `handleAnimation()`

- [ ] **Step 3: Replace the clock case in `api_handlers.ino`**

Find this block (lines 142–153 of `api_handlers.ino`):

```cpp
  if (animationName == "clock") {
    clockTimezone = (int)(doc["timezone"] | -7);
    String colorStr = String(doc["color"] | "#003366");
    clockBgColor  = hexToColor(colorStr);
    clockPrevHour = -1;
    clockPrevMin  = -1;
    ntpSynced     = false;
    // configTime sets up the ESP32's POSIX time library.
    // timezone * 3600 converts the UTC offset (hours) to seconds.
    // pool.ntp.org and time.nist.gov are public NTP servers.
    configTime((long)clockTimezone * 3600L, 0, "pool.ntp.org", "time.nist.gov");
  }
```

Replace with:

```cpp
  if (animationName == "clock") {
    clockTimezone    = (int)(doc["timezone"] | -7);
    clockColorHours  = hexToColor(String(doc["colorHours"]   | "#FF3300"));
    clockColorColon  = hexToColor(String(doc["colorColon"]   | "#FFFFFF"));
    clockColorMins   = hexToColor(String(doc["colorMinutes"] | "#00CCFF"));
    clockPrevHour    = -1;
    clockPrevMin     = -1;
    ntpSynced        = false;
    configTime((long)clockTimezone * 3600L, 0, "pool.ntp.org", "time.nist.gov");
  }
```

### 2d — Compile and flash

- [ ] **Step 4: Compile the sketch**

Open the Arduino IDE (or PlatformIO), select the ESP32-S3 board, and compile (`Verify` / `ctrl+R`).

Expected: Compile succeeds with 0 errors. Any "use of undeclared identifier 'clockBgColor'" error means Step 1 or Step 3 was missed — check that both edits are in place.

- [ ] **Step 5: Flash to the board**

Upload the compiled sketch to the ESP32-S3 board.

- [ ] **Step 6: Visual smoke test via curl or browser console**

Send a test clock command (replace IP with the board's actual IP):

```bash
curl -s -X POST http://<BOARD_IP>/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"clock","colorHours":"#ff0000","colorColon":"#ffffff","colorMinutes":"#00ff00","timezone":-7}'
```

Expected: Board shows a clock. Hours digits in red, colon dots in white, minutes digits in green. Background is black.

- [ ] **Step 7: Commit firmware changes**

```bash
git add esp32_matrix_webserver/esp32_matrix_webserver.ino \
        esp32_matrix_webserver/clock_timer.ino \
        esp32_matrix_webserver/api_handlers.ino
git commit -m "feat: clock redesign — 3-color system with new pixel layout"
```

---

## Task 3: UI — clock.html rewrite

**Files:**
- Modify: `esp32_matrix_webserver/data/clock.html` (full rewrite)

This task is independent of Task 2 — the HTML just sends different JSON. It can be done before or after flashing firmware.

- [ ] **Step 1: Replace the entire contents of `clock.html`**

Write the following as the complete file contents:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESP32 Matrix — Clock</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0d0d0d; color: #e0e0e0; min-height: 100vh; padding: 20px; }
    .wrap { max-width: 760px; margin: 0 auto; }
    header { margin-bottom: 24px; display: flex; align-items: center; gap: 14px; }
    a.back { color: #555; text-decoration: none; font-size: 0.85rem; }
    a.back:hover { color: #aaa; }
    h1 { font-size: 1.5rem; color: #00ff88; }
    .panel { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px; }
    .panel-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-bottom: 16px; }
    .preview-wrap { display: flex; flex-direction: column; align-items: center; margin-bottom: 18px; }
    .pixel-grid {
      display: grid;
      grid-template-columns: repeat(8, 22px);
      grid-template-rows: repeat(8, 22px);
      gap: 3px;
      background: #000;
      padding: 8px;
      border-radius: 7px;
      border: 1px solid #1e1e1e;
    }
    .px { border-radius: 3px; background: #0a0a0a; }
    .preview-label { font-size: 0.62rem; color: #333; margin-top: 6px; text-transform: uppercase; letter-spacing: .06em; }
    .pickers { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .picker-group { display: flex; flex-direction: column; gap: 5px; }
    .picker-group label { font-size: 0.68rem; color: #666; text-transform: uppercase; letter-spacing: .06em; }
    .picker-group input[type=color] {
      width: 48px; height: 34px; border: 1px solid #333; border-radius: 6px;
      background: none; cursor: pointer; padding: 2px;
    }
    .presets-label { font-size: 0.68rem; color: #555; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .presets-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 5px;
      margin-bottom: 18px;
    }
    .preset {
      aspect-ratio: 1;
      border-radius: 5px;
      border: 1px solid rgba(255,255,255,0.07);
      cursor: pointer;
      transition: transform .1s;
      position: relative;
      overflow: hidden;
    }
    .preset:hover { transform: scale(1.12); }
    .preset.active { outline: 2px solid #fff; outline-offset: 2px; }
    .preset .comp-strip { position: absolute; bottom: 0; left: 0; right: 0; height: 35%; }
    .footer-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    select { background: #1e1e1e; color: #ccc; border: 1px solid #333; border-radius: 6px; padding: 6px 10px; font-size: 0.82rem; cursor: pointer; }
    button { background: #1e1e1e; color: #ccc; border: 1px solid #333; border-radius: 7px; padding: 8px 18px; cursor: pointer; font-size: 0.85rem; }
    button.primary { border-color: #00aa55; color: #00ff88; }
    button.primary:hover { background: #002211; }
    button.danger { border-color: #7a0000; color: #ff5555; }
    button.danger:hover { background: #250000; }
    .status { font-size: 0.78rem; margin-top: 12px; min-height: 1.2em; color: #00cc66; }
    .status.err { color: #ff5555; }
  </style>
</head>
<body>
  <div class="wrap">
  <header>
    <a class="back" href="/">← Back</a>
    <h1>🕰️ Clock</h1>
  </header>

  <div class="panel">
    <div class="panel-title">Clock Settings</div>

    <div class="preview-wrap">
      <div class="pixel-grid" id="pixelGrid"></div>
      <div class="preview-label">Live 8×8 preview — updates every second</div>
    </div>

    <div class="pickers">
      <div class="picker-group">
        <label for="cHours">Hours</label>
        <input type="color" id="cHours" value="#ff3300" oninput="updatePreview()">
      </div>
      <div class="picker-group">
        <label for="cColon">Colon</label>
        <input type="color" id="cColon" value="#ffffff" oninput="updatePreview()">
      </div>
      <div class="picker-group">
        <label for="cMins">Minutes</label>
        <input type="color" id="cMins" value="#00ccff" oninput="updatePreview()">
      </div>
    </div>

    <div class="presets-label">Color Presets</div>
    <div class="presets-grid" id="presetsGrid"></div>

    <div class="footer-row">
      <select id="timezone">
        <option value="-12">UTC-12</option>
        <option value="-11">UTC-11</option>
        <option value="-10">UTC-10</option>
        <option value="-9">UTC-9</option>
        <option value="-8">UTC-8 (Pacific)</option>
        <option value="-7" selected>UTC-7 (Mountain / Phoenix)</option>
        <option value="-6">UTC-6 (Central)</option>
        <option value="-5">UTC-5 (Eastern)</option>
        <option value="-4">UTC-4</option>
        <option value="-3">UTC-3</option>
        <option value="-2">UTC-2</option>
        <option value="-1">UTC-1</option>
        <option value="0">UTC+0</option>
        <option value="1">UTC+1</option>
        <option value="2">UTC+2</option>
        <option value="3">UTC+3</option>
        <option value="4">UTC+4</option>
        <option value="5">UTC+5</option>
        <option value="6">UTC+6</option>
        <option value="7">UTC+7</option>
        <option value="8">UTC+8</option>
        <option value="9">UTC+9</option>
        <option value="10">UTC+10</option>
        <option value="11">UTC+11</option>
        <option value="12">UTC+12</option>
      </select>
      <button class="primary" onclick="startClock()">Start Clock</button>
      <button class="danger" onclick="stopClock()">Stop</button>
    </div>
    <div class="status" id="status"></div>
  </div>

  <script>
    // FONT_3X3 digits 0–9 (indices 26–35 from fonts.ino)
    // [col0, col1, col2] — bit0 = top row, bit2 = bottom row
    const FONT_3X3 = [
      [7,5,7],[5,7,4],[1,7,4],[5,7,7],[3,2,7],
      [4,7,1],[7,6,6],[1,1,7],[7,7,7],[3,3,7],
    ];

    // MINI_FONT 3×5 (from clock_timer.ino)
    // [col0, col1, col2] — bit0 = top row, bit4 = bottom row
    const MINI_FONT = [
      [31,17,31],[2,31,16],[29,21,23],[17,21,31],[7,4,31],
      [23,21,29],[31,21,29],[25,5,3],[31,21,31],[23,21,31],
    ];

    const grid = document.getElementById('pixelGrid');
    const pixels = [];
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      d.className = 'px';
      grid.appendChild(d);
      pixels.push(d);
    }

    function setPixel(x, y, color) {
      if (x < 0 || x > 7 || y < 0 || y > 7) return;
      pixels[y * 8 + x].style.background = color;
    }
    function clearGrid() { pixels.forEach(p => p.style.background = '#0a0a0a'); }

    function draw3x3(digit, startX, startY, color) {
      const f = FONT_3X3[digit];
      for (let col = 0; col < 3; col++)
        for (let row = 0; row < 3; row++)
          if ((f[col] >> row) & 1) setPixel(startX + col, startY + row, color);
    }

    function drawMini(digit, startX, startY, color) {
      const f = MINI_FONT[digit];
      for (let col = 0; col < 3; col++)
        for (let row = 0; row < 5; row++)
          if ((f[col] >> row) & 1) setPixel(startX + col, startY + row, color);
    }

    function renderClock(h, m, cH, cC, cM) {
      clearGrid();
      // Colon dots: col 0, rows 5 and 7
      setPixel(0, 5, cC);
      setPixel(0, 7, cC);
      // Minutes: tens at cols 1–3, units at cols 5–7 (col 4 gap), rows 3–7
      drawMini(Math.floor(m / 10), 1, 3, cM);
      drawMini(m % 10, 5, 3, cM);
      // Hours: 1–9 at cols 0–2; 10–12: '1' at cols 0–2, units at cols 4–6
      if (h <= 9) {
        draw3x3(h, 0, 0, cH);
      } else {
        draw3x3(1, 0, 0, cH);
        draw3x3(h % 10, 4, 0, cH);
      }
    }

    function updatePreview() {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      const m = now.getMinutes();
      renderClock(h, m,
        document.getElementById('cHours').value,
        document.getElementById('cColon').value,
        document.getElementById('cMins').value
      );
    }

    function hslToHex(h, s, l) {
      s /= 100; l /= 100;
      const k = n => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return '#' + [f(0),f(8),f(4)].map(x => Math.round(x*255).toString(16).padStart(2,'0')).join('');
    }

    const presetsGrid = document.getElementById('presetsGrid');
    let activePreset = null;

    for (let i = 0; i < 32; i++) {
      const hue = Math.round(i * 360 / 32);
      const hoursHex = hslToHex(hue, 100, 50);
      const minsHex  = hslToHex((hue + 180) % 360, 100, 50);

      const wrap = document.createElement('div');
      wrap.className = 'preset';
      wrap.style.background = hoursHex;
      wrap.title = `Hours: ${hoursHex}  Colon: #ffffff  Minutes: ${minsHex}`;

      const strip = document.createElement('div');
      strip.className = 'comp-strip';
      strip.style.background = minsHex;
      wrap.appendChild(strip);

      wrap.addEventListener('click', () => {
        if (activePreset) activePreset.classList.remove('active');
        wrap.classList.add('active');
        activePreset = wrap;
        document.getElementById('cHours').value = hoursHex;
        document.getElementById('cColon').value = '#ffffff';
        document.getElementById('cMins').value  = minsHex;
        updatePreview();
      });

      presetsGrid.appendChild(wrap);
    }

    updatePreview();
    setInterval(updatePreview, 1000);

    function setStatus(msg, isErr) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status' + (isErr ? ' err' : '');
    }

    async function post(url, data) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        return r.ok;
      } catch { return false; }
    }

    async function startClock() {
      const ok = await post('/api/display/animation', {
        type:         'clock',
        colorHours:   document.getElementById('cHours').value,
        colorColon:   document.getElementById('cColon').value,
        colorMinutes: document.getElementById('cMins').value,
        timezone:     parseInt(document.getElementById('timezone').value, 10)
      });
      setStatus(ok ? 'Clock started. NTP sync may take a few seconds…' : 'Error — is the board reachable?', !ok);
    }

    async function stopClock() {
      const ok = await post('/api/display/clear', {});
      setStatus(ok ? 'Display cleared.' : 'Error — is the board reachable?', !ok);
    }
  </script>
  </div>
</body>
</html>
```

- [ ] **Step 2: Open `clock.html` in a browser (file://)**

Open the file directly. Verify:
1. An 8×8 grid appears with the current time rendered in red (hours) / white (colon) / cyan (minutes).
2. The colon dots are at the far left (col 0), rows 5 and 7 — not centered.
3. There is a visible 1-pixel gap between the tens and units minute digits.
4. For hours 1–9, the digit is at the left edge of the grid.
5. Click a color preset — all 3 color pickers update and the preview re-renders.
6. Change a color picker manually — preview updates immediately.
7. The grid ticks every second (minute changes are visible by running the page across a minute boundary, or you can temporarily change `now.getMinutes()` to `now.getSeconds() % 60` to see all digit transitions quickly, then revert).

- [ ] **Step 3: Upload `clock.html` to the board via SPIFFS**

Use the LittleFS upload tool (Arduino IDE: Tools → ESP32 LittleFS Data Upload, or PlatformIO: `pio run --target uploadfs`).

- [ ] **Step 4: Verify end-to-end on the board**

Open the board's web UI, navigate to Clock, pick a preset, click "Start Clock". Verify:
- Board displays clock with visually distinct hours / colon / minutes colors.
- Colors match what the preview showed.
- Background is black.

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/data/clock.html
git commit -m "feat: clock UI — 8x8 preview, 3-color pickers, 32 presets"
```
