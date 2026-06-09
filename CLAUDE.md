# ESP32-S3 Matrix — Project Brief (read me first)

Waveshare ESP32-S3-Matrix (8×8 WS2812B) controlled in natural language via
Claude → MCP server (Node) → HTTP → Arduino firmware → LEDs.

This file is the canonical project brief and loads every session. Keep it
current. Deeper material is split out:
- `docs/PITFALLS.md` — hardware/firmware gotchas we've hit (read before debugging)
- `docs/superpowers/specs/` — per-feature design specs
- `docs/superpowers/plans/` — per-feature implementation plans

---

## How we work (the dev loop)

**I (Claude) cannot compile, flash, or see the LEDs.** I write C++/HTML; **you**
compile + flash in the Arduino IDE and report back. So:

1. I edit firmware (`.ino`) and/or web UI (`data/*.html`).
2. You **Sketch → Upload** (firmware) and, if `data/` changed,
   **Tools → ESP32 LittleFS Data Upload** (web files). *Both are separate steps.*
3. You paste the **Serial Monitor** output and/or describe the LED behavior.
4. We iterate.

**Never claim a change "works" until you've confirmed it on hardware.** I can
reason about correctness, but "compiles in my head" ≠ "runs on the board."

---

## Hardware facts (don't re-derive these)

| Thing | Value |
|---|---|
| Board | Waveshare ESP32-S3-Matrix |
| LEDs | 8×8 WS2812B, 64 total, **data pin 14** |
| `LED_TYPE` | `WS2812B` |
| **`COLOR_ORDER`** | **`RGB`** ⚠️ not the usual GRB — `CRGB(r,g,b)` maps straight through |
| IMU | QMI8658C 6-axis, I2C **SDA=11 SCL=12**, addr **0x6B** |
| Flash / PSRAM | **4MB** embedded flash + 2MB PSRAM (verified from esptool). LittleFS lives in the 1MB SPIFFS region of the `huge_app` partition. |
| Default brightness | 40 / 255 (LEDs are bright + draw real current at full) |

### Coordinate system
`XY(x, y)` returns `y * 8 + x` — **plain row-major, NOT serpentine.** Origin
top-left, x→right, y→down. Out-of-bounds returns `-1`. Always draw via
`setPixel(x, y, CRGB)` (bounds-checked) — defined in `esp32_matrix_webserver.ino`.

---

## Arduino IDE setup

**Libraries (Tools → Manage Libraries):** FastLED · ArduinoJson · PNGdec ·
**WiFiManager *by tzapu*** (watch for lookalikes). WiFi/WebServer/mDNS/
WiFiClientSecure are in the ESP32 core.

**Web-file (`data/`) upload — Arduino IDE 2.x:** install the
**`arduino-littlefs-upload`** `.vsix` plugin into `~/.arduinoIDE/plugins/`, then
**Ctrl+Shift+P → "Upload LittleFS to Pico/ESP8266/ESP32"** (Command Palette only,
NOT the Tools menu; close the Serial Monitor first). The LittleFS *library* in
Library Manager is unrelated — it adds no upload command. See `docs/PITFALLS.md`.

**Board settings (Tools menu):**
- Board: `Waveshare ESP32-S3-Matrix` (or `ESP32S3 Dev Module`)
- **PSRAM: `Enabled`** — the board has 2MB. Leaving it Disabled starves the heap
  (~300KB SRAM only) and caused WiFi / web-server instability under load. Keep ON.
- USB Mode: `Hardware CDC and JTAG` · USB CDC On Boot: `Enabled` (needed for the Serial Monitor over USB)
- Upload Speed: `921600`
- Flash Size: `4MB (32Mb)` (this board is 4MB — verified via esptool)
- Partition Scheme: `Huge APP (3MB No OTA / 1MB SPIFFS)` — LittleFS data folder is
  small (~hundreds of KB) so it fits the 1MB region. Watch this if the data
  folder ever grows (emoji/sketch image assets).

---

## WiFi (runtime, no hardcoded creds)

WiFiManager captive portal. On boot it tries saved WiFi (LEDs **blue**); on
failure it opens hotspot **`ESP32-Matrix-Setup`** (LEDs **amber**) at
`192.168.4.1`. Hold **BOOT (GPIO 0)** while powering on to wipe creds and force
setup. Reachable at `http://esp32matrix.local` once joined.

---

## Firmware layout (all `.ino` in `esp32_matrix_webserver/` compile as one unit)

| File | Contents |
|---|---|
| `esp32_matrix_webserver.ino` | globals, `setup()`, `loop()`, `XY`/`setPixel`, dispatch |
| `api_handlers.ino` | all HTTP route handlers |
| `anim_*.ino` | one animation each (fire, liquid, matrix, comet, gradient, …) |
| `scroll_text.ino` | 5×7/3×5/3×3 scrolling text |
| `fonts.ino` | 3×3 and 3×5 pixel fonts |
| `weather.ino` | weather fetch + icon draw + chip temp |
| `clock_timer.ino` | NTP clock + 3 timer modes |
| `data/*.html` | per-mode web control pages (served from LittleFS) |

### Adding a new animation touches these files (the recurring recipe)
1. New `anim_<name>.ino` — state globals + `run<Name>Frame()` / `step<Name>Frame()`
2. Dispatch branch in `esp32_matrix_webserver.ino` loop: `else if (animationName == "<name>") run<Name>Frame();`
3. `api_handlers.ino` `handleAnimation()` — parse params, set globals, set `animationName`
4. `data/<name>.html` — control page (palette, color pickers, live preview canvas, launch POST)
5. `data/index.html` — add a card linking the new page
6. README features table (optional)

---

## MCP server (`mcp_server/`)

TypeScript, pre-compiled to `dist/index.js`. After TS edits:
`cd mcp_server; npx tsc --project tsconfig.json` then restart Claude Code.
On Windows, MCP spawn is finicky — see global `~/.claude/CLAUDE.md` for the
cmd.exe-wrapper template and debug checklist. Prefer the board's **IP address
over `esp32matrix.local`** in MCP config (mDNS is unreliable in spawned procs).

---

## API surface

```
GET  /api/status
GET  /api/sensors/{temperature,accelerometer,weather}
POST /api/display/clear
POST /api/brightness        { level: 0-255 }
POST /api/display/text      { text, color, color2, gradient, small, tiny, scroll_speed }
POST /api/display/animation { type, ...mode-specific }   # clock/calendar accept tz (POSIX TZ, DST) or timezone (int offset)
POST /api/display/matrix    { matrix: [[8×8 hex]] }
POST /api/weather/mode      { mode: temp|humidity|uv|pressure|cycle }
```

## Auto-resume (NVS)

The board persists its **last animation** + **brightness** to NVS (`Preferences`,
namespace `matrix`) and restores them on boot — so it powers back up into
whatever it was showing. `handleAnimation` is split into `applyAnimationBody(body)`
(shared by the HTTP handler and the boot-time restore in `setup()`). Clearing the
display (`/api/display/clear`) makes it boot blank. Text/sketch are transient
(not auto-resumed). If you're puzzled why the board "starts showing something" on
power-up — that's this.
