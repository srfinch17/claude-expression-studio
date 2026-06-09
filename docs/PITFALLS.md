# Pitfalls & Gotchas — ESP32-S3 Matrix

Running log of hardware/firmware traps we've hit (or that bite newcomers to this
board). Append a dated entry whenever a non-obvious problem costs us time. Read
this before debugging anything weird. Newest entries at the top.

Entry template:
```
## YYYY-MM-DD — <short title>
**Symptom:** what we saw.
**Cause:** the real reason.
**Fix / rule:** what to do (and what to never do again).
```

---

## 2026-06-08 — LittleFS upload: IDE 2.x needs a .vsix plugin, not the library
**Symptom:** Installed "LittleFS" but the Command Palette can't find any LittleFS
upload command, and there's no "ESP32 LittleFS Data Upload" under Tools.
**Cause:** Two different things share the name. The **LittleFS library** (Library
Manager) only lets firmware read the filesystem — it adds no upload command. The
old "ESP32 Sketch/LittleFS Data Upload" Tools-menu item is **Arduino IDE 1.x
only**; IDE 2.x dropped it.
**Fix / rule:** In IDE 2.x install the **`arduino-littlefs-upload`** plugin: drop
the `.vsix` from github.com/earlephilhower/arduino-littlefs-upload/releases into
`C:\Users\srfin\.arduinoIDE\plugins\` (create the folder), fully restart the IDE,
then **Ctrl+Shift+P → "Upload LittleFS to Pico/ESP8266/ESP32"**. The command
lives ONLY in the Command Palette, never the Tools menu. **Close the Serial
Monitor first** or the upload fails on a busy port. Needs IDE ≥ 2.2.1.

## 2026-06-08 — Liquid IMU axis mapping (calibration result)
The liquid 2D model maps board accel to in-plane gravity. Calibrated on hardware:
`gxRaw = -ay` (matrix +x / right), `gyRaw = ax` (matrix +y / down). Tip the board
right (clockwise) → fluid pools right. If a future board mounts the IMU
differently and left/right or up/down reads reversed, negate the corresponding
axis in `stepLiquidFrame()` (`anim_liquid.ino`).

## 2026-06-09 — Arduino multi-.ino concatenation order
**Symptom:** A new `anim_X.ino` that uses a `#define` (or file-scope variable)
from another tab fails to compile, even though calling that tab's *functions* works.
**Cause:** The Arduino build concatenates the main sketch (`esp32_matrix_webserver.ino`)
FIRST, then the other `.ino` files **alphabetically**. Function *prototypes* are
auto-generated so functions are callable across tabs in any order — but `#define`
macros and file-scope variables are only visible to files concatenated *after*
them. So `anim_calendar.ino` cannot see `FONT_CHAR_W` (defined in `fonts.ino`,
which sorts later).
**Fix / rule:** Put shared constants/globals in the **main sketch** (it's first,
so visible everywhere). In a new `anim_*.ino`, only rely on cross-tab *functions*,
not on another tab's macros/vars. (e.g. anim_calendar hardcodes the 4px font
stride instead of using `FONT_CHAR_W`.)

## 2026-06-09 — WiFi drops and never recovers (no reconnect path)
**Symptom:** Board loses WiFi during use (often around the weather app) and stays
offline even after a power-cycle, while the animation keeps running.
**Cause(s):** (1) The firmware connected once at boot via WiFiManager `autoConnect`
and had NO reconnect logic — any disconnect (router kick, RSSI dip, modem
power-save) left it permanently offline. (2) Auto-resume made it sticky by
replaying the last (weather) command on every boot. (3) `fetchWeather()` buffered
the whole ~50KB wttr.in body with `http.getString()` — heavy on the
PSRAM-disabled board, a likely trigger.
**Fix / rule:** Always run a WiFi self-heal: `WiFi.setAutoReconnect(true)`,
`WiFi.setSleep(false)` (modem power-save is a common silent-drop cause), and a
loop() watchdog that calls `WiFi.reconnect()` if `WiFi.status() != WL_CONNECTED`.
Log the disconnect reason via `WiFi.onEvent(...STA_DISCONNECTED)` to see WHY.
Never buffer large HTTP bodies — stream-parse with an ArduinoJson filter. Keep
blocking network calls out of request handlers and `setup()`.
**✅ Self-heal CONFIRMED working (2026-06-09):** after flashing, the web interface
came back. (`setAutoReconnect` + `setSleep(false)` + loop reconnect watchdog.)

**…but then a SECOND, separate WiFi cause showed up — lost credentials.**
Serial showed `*wm:No wifi saved, skipping` → the stored WiFi creds were gone, so
WiFiManager opened the setup portal. Two contributors, both now mitigated:
- **BOOT-button wipe too eager.** `setup()` wipes creds if GPIO0 reads LOW at
  boot; a glitchy strapping read after a USB flash/reset (or a stray BOOT bump
  while troubleshooting) could nuke them. Fix: require BOOT held **~1s** before wiping.
- **NVS churn from auto-resume.** Frequent `prefs.put*` (every animation/brightness
  change) churns the NVS partition that ALSO holds WiFi creds. Fix: **debounce** —
  handlers set a dirty flag, loop() flushes to NVS once changes settle (~8s).
Recovery when it happens: join `ESP32-Matrix-Setup` → 192.168.4.1 → re-enter WiFi.

## Standing gotchas (board-level, always true)

### Color order is RGB, not GRB
`COLOR_ORDER` is `RGB` in this firmware, so `CRGB(r, g, b)` maps straight to the
panel. Most WS2812B code assumes GRB — if you copy an animation from elsewhere
and red/green look swapped, this is why. Don't "fix" it by swapping channels in
one animation; the whole firmware is consistent on RGB.

### LittleFS upload is a separate step from flashing
Editing `data/*.html` and uploading the sketch does **nothing** to the web UI.
Web files only land on the board via **Tools → ESP32 LittleFS Data Upload**, and
that tool must be installed separately from the LittleFS *library*. If the UI
looks stale after a change, you flashed firmware but forgot the data upload.

### Brightness vs. current draw
Default brightness is 40/255. At full brightness all 64 LEDs white can pull
~3-4 A — more than some USB ports supply, causing brownout/reboot or color
glitches. If the board resets under bright patterns, suspect power before code.

### mDNS (`esp32matrix.local`) is flaky from spawned processes
The browser usually resolves `.local` fine, but Node/MCP spawned by Claude Code
on Windows often can't. Use the board's raw IP in MCP config.

### Matrix is row-major, not serpentine
`XY(x,y) = y*8 + x`. If a ported effect looks zig-zagged every other row, it
assumed serpentine wiring — this panel isn't.
