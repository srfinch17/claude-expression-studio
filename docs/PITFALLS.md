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

## 2026-06-11 — USB-CDC Serial prints FREEZE the whole board when no monitor is attached
**Symptom:** Every animation hitches/catches on a regular interval and the web
server turns sluggish — feels like "some background process on a timer". Started
right after enabling **USB CDC On Boot** in Tools.
**Cause:** With CDC enabled, `Serial` is the hardware USB-CDC port. In core
3.3.9, `HWCDC::write` blocks up to `tx_timeout_ms` (100ms) per chunk and allows
20 consecutive timeouts (~2s total) when the cable is plugged but the host isn't
draining the port — i.e. the NORMAL state: Serial Monitor closed (we close it
for every LittleFS upload). The 10-second `[heap]` log line alone froze loop()
— animations, FastLED, and HTTP all live there. With CDC *Disabled* (the old
setting) prints went to UART0, which never blocks — that's why it "was fast
before".
**Fix / rule:** `Serial.setTxTimeoutMs(0)` right after `Serial.begin()` (guarded
by `#if ARDUINO_USB_CDC_ON_BOOT && ARDUINO_USB_MODE`) — prints become
best-effort: they flow when a monitor is attached, drop when it isn't, and NEVER
block. Rule: on USB-CDC boards, diagnostics must never be allowed to stall the
loop. The 10s `[heap]` line now also prints `max-stall=<ms>` (longest loop()
gap that window) — use it to verify: >50ms hitches with the monitor closed
mean something is blocking again.

## 2026-06-11 — Clock/calendar pulse dim white "forever" right after boot
**Symptom:** Every calendar style (and the clock) shows only the pulsing dim
white "waiting" screen, looking completely broken — while WiFi/internet are fine.
Minutes later it spontaneously works.
**Cause:** Two stacked facts. (1) Clock/calendar draw NOTHING but the pulse until
the FIRST NTP sync lands (`getLocalTime` gate). (2) `startNtp()` used to call
configTzTime/configTime on every animation start, which **restarts the SNTP
client from scratch** — so clicking through calendar styles right after boot
kept aborting the in-flight first sync; each click reset the wait.
**Fix / rule:** `startNtp()` now no-ops when the requested tz/offset matches what
SNTP was already started with (`ntpActiveCfg` in `api_handlers.ino`). Rule of
thumb: pulsing white = "no valid time yet", not "calendar is broken" — check
`/api/status` (`ntp_synced`) and give a fresh boot ~10s on a working network
before concluding anything. USB CDC On Boot must be "Enabled" in Tools or none
of the firmware's own serial diagnostics appear (only ESP-IDF [W]/[E] lines).

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

**…and a THIRD: `autoConnect()` drops into the portal on a transient failure.**
`wm.autoConnect()` tries saved creds for `setConnectTimeout` (10s) then opens the
BLOCKING config portal if it fails — wrong for an appliance (a slow/marginal
connect strands it in the portal). Fix: if `wm.getWiFiIsSaved()`, use plain
`WiFi.begin()` + a 25s wait, then proceed and let `setAutoReconnect` + the loop
watchdog keep retrying the saved network FOREVER. Portal only for an unconfigured
board or a held BOOT. **Also: the ESP32 is 2.4GHz-only** — a connect that keeps
failing is often a 5GHz-only SSID or a wrong password, not code.

## 2026-06-09 — WiFi saga FINAL RESOLUTION: the mesh refused the 4-way handshake
**Symptom:** Board associates with the home network (strong signal, plain WPA2,
correct password — even hardcoded via secrets.h) but loops forever on
`reason=15 4WAY_HANDSHAKE_TIMEOUT`. Nothing on the router was (manually) changed.
**Diagnosis path that cracked it:** pre-connect scan diagnostics (RSSI/auth per
network) ruled out weak signal and WPA3-transition; PSRAM-off ruled out PSRAM;
secrets.h ruled out the portal; then the **phone-hotspot test** — board connected
instantly → board/core/firmware all healthy → **the home mesh itself was refusing
the key exchange for this device** (auto client-security blocklist of the board's
MAC after the crash-loop / rapid-reconnect debugging era, or a mesh node in a bad
state). Board MAC: `f0:f5:bd:75:29:3c`.
**Fix / rules:**
- **The phone-hotspot test is THE decisive board-vs-network splitter.** Put the
  hotspot creds in `secrets.h`, flash, watch. Connects → network side; fails →
  board side. Use it early, not after days of theorizing.
- Recovery on the network side: power-cycle all mesh nodes; check the mesh app's
  blocked/quarantined device list for the board's MAC.
- **Keep reconnect logic GENTLE** (watchdog backstop ≥30s; the driver's own
  autoReconnect handles fast retry). Rapid forced auth cycling is what trips
  mesh security heuristics in the first place.
- reason=15 with strong signal + right password ≈ "the AP won't complete the key
  exchange with YOU" — think blocklist/quarantine/sick node, not credentials.

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
