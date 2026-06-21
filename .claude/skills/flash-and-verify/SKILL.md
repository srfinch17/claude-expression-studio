---
name: flash-and-verify
description: Runbook for getting an ESP32-S3 matrix change onto the board and confirming it works. Use after editing firmware or web UI to guide the user through the right upload step and to triage compile/flash/runtime errors.
---

# Flash & verify runbook

I (Claude) cannot compile, flash, or see the LEDs — the user does that and
reports back. My job here is to tell them exactly which step to run and to triage
what comes back. (See the `esp32-dev-loop` memory.)

## 0. Before you ask for ANY upload — minimize & de-risk the round-trip
Every Sketch→Upload and LittleFS upload is manual effort the USER pays. Treat
round-trips as the scarce resource:
- **Batch by artifact, not by task.** If several pending changes touch the same
  artifact (all firmware, or all `data/`), make them ALL first and ask for ONE
  upload. Pull forward params/superset changes so a single flash covers later work
  (e.g. add optional JSON fields now so the next task is web-only). Consolidating a
  6-task plan to **1 flash + 1 upload** is a real win — announce it and why.
- **Self-review the artifact before deploying** — proactively, not just when asked.
  Verify API assumptions against the actual firmware (e.g. `hexToColor` strips an
  optional `#` and needs 6 chars; check the real endpoint/param names) instead of
  deploying on assumed signatures. Watch for page-load side effects (init that POSTs
  to the board) and values that mean something dangerous downstream.
- **Self-verify what you can WITHOUT the user's eyes**, then reserve their eyes for
  true perception calls (does this read as cyan; is it blinding):
  - `curl` the endpoints (board reachable at `esp32matrix.local`).
  - `GET /api/display/framebuffer` → raw `leds[]` hex, so pattern geometry/color
    placement is provable (see `feedback-framebuffer-debugging`).
  - **Playwright MCP** for web pages: `browser_navigate` to
    `http://esp32matrix.local/<page>.html`, check console for errors, and
    `browser_evaluate` to call the page's own functions and confirm they drive the
    board (cross-check the framebuffer). Catches JS errors and dead controls before
    the user ever looks.
- **Defer version bumps** that rewrite `data/version.json` until a deploy is already
  happening — otherwise the stamp change forces an extra LittleFS upload.
- When done driving the panel hard (calibration runs hit 255), **restore a
  comfortable brightness** via `POST /api/brightness` (persists to NVS).

## 1. Which upload does this change need?
- **Firmware (`.ino`) changed** → Arduino IDE **Sketch → Upload**.
- **Web UI (`data/*.html`) changed** → IDE 2.x: **Ctrl+Shift+P → "Upload
  LittleFS to Pico/ESP8266/ESP32"** (needs the `arduino-littlefs-upload` .vsix
  plugin; Command Palette only, close Serial Monitor first). A *separate* step —
  uploading the sketch does NOT update web files. See `docs/PITFALLS.md`.
- **Both changed** → do both. Firmware first, then the data upload.

## 2. Pre-flight (only if uploads are failing)
Confirm board settings (Tools menu) match `CLAUDE.md`:
ESP32S3 Dev Module (or "Waveshare ESP32-S3-Matrix") · USB CDC On Boot **Enabled** ·
Flash **4MB (32Mb)** · Partition **Huge APP (3MB No OTA / 1MB SPIFFS)** ·
Upload speed 921600. (Board is 4MB — verified via esptool.)

## 3. Common errors → fix
| Symptom | Likely cause | Fix |
|---|---|---|
| `'X.h' No such file` / undefined ref to a lib | library not installed | Install via Manage Libraries (FastLED, ArduinoJson, PNGdec, **WiFiManager by tzapu**) |
| `Sketch too big` / won't link | wrong partition scheme | Set partition to `8MB with spiffs (3MB APP, 5MB SPIFFS)` |
| Web page is stale / 404 after editing `data/` | forgot LittleFS data upload | Run **ESP32 LittleFS Data Upload** |
| Upload fails / port busy | Serial Monitor holding the port, or no boot mode | Close Serial Monitor; retry; if stuck, hold BOOT during connect |
| Board reboots under bright patterns | power brownout (full-white ~3-4 A) | Lower brightness / better USB supply (see PITFALLS) |
| Red/green look swapped on a new effect | code assumed GRB | This firmware is **RGB** — don't swap channels, fix the source assumption |

## 4. Verify on hardware (what to ask the user for)
- **Serial Monitor** output at boot: WiFi connect line, IP / `esp32matrix.local`,
  any panics/stack traces — ask them to paste it.
- **LED behavior**: does the new mode show, are colors right, is motion smooth?
- For web changes: load `http://esp32matrix.local`, confirm the new card/page.

## 5. Close the loop
Only call a change "working" after the user confirms the observed behavior. If a
non-obvious problem cost time, append a dated entry to `docs/PITFALLS.md`.

## 6. Board offline / can't reach it (connectivity triage)
**Get the serial log FIRST — don't theorize before reading it.** The boot LED
color signals WiFi state (blue = connecting, amber = setup portal, green flash =
connected). Then read Serial (115200; needs USB CDC On Boot: Enabled):
- `*wm:No wifi saved` → **credentials were wiped** → board opens the portal.
  Recover: join `ESP32-Matrix-Setup` → `192.168.4.1` → re-enter WiFi. (Causes,
  both hardened: BOOT held at boot wipes creds — now needs a ~1s hold; heavy NVS
  writes churn the partition that holds creds — auto-resume writes are debounced.)
- `WiFi DISCONNECTED reason=NN` → connected then dropped. 200/201 = signal/range;
  2/15 = auth; 8/4 = router kicked it. Self-heal (`setAutoReconnect` +
  `setSleep(false)` + loop reconnect watchdog) should restore it within ~5s.
- `[heap] free=` trending toward ~14KB then an auto-restart → low heap. Confirm
  **PSRAM is Enabled** in Tools (this board has 2MB; Disabled starves the heap and
  destabilizes WiFi/web-server under load).
- `WiFi DISCONNECTED reason=15` (4WAY_HANDSHAKE_TIMEOUT) looping, with strong
  RSSI + correct password → the AP is refusing the key exchange with THIS device
  (mesh auto-blocklist / quarantined MAC / sick mesh node). **Decisive test:
  phone hotspot via secrets.h** — connects → network side (power-cycle the mesh,
  check its blocked-device list); fails → board side. The firmware's boot scan
  prints every network's RSSI + auth mode to rule out weak signal / WPA3 first.
- `.local` fails but the raw IP works → it's mDNS, not WiFi. Use the IP.

Full history of these in `docs/PITFALLS.md` (WiFi-drop + credential-loss entries).
