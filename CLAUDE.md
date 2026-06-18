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

TypeScript, pre-compiled to `dist/index.js` — the live server runs the COMPILED
dist, so TS edits are invisible until rebuilt **and** the server is reconnected.

**Rebuild is automated.** A Claude Code hook (`.claude/settings.json` →
`scripts/rebuild-mcp.mjs`) runs `tsc` whenever the `mcp_server/*.ts` sources are
newer than `dist` — fired on every Edit/Write (PostToolUse) and at SessionStart.
It's a no-op when dist is current, surfaces TS errors if the build fails, and on a
successful rebuild prints a reminder. So after I edit TS you only need to **`/mcp`
reconnect** to pick up the new build (the hook can't reconnect the running server).
Manual fallback: `cd mcp_server; npx tsc --project tsconfig.json`.

On Windows, MCP spawn is finicky — see global `~/.claude/CLAUDE.md` for the
cmd.exe-wrapper template and debug checklist. `mcp_launch.cmd` must NOT redirect
stderr to a fixed shared logfile: a long-lived server holds that handle, an orphan
locks it, and the next spawn's redirect fails → `-32000 Connection closed` (the real
error is in Claude's per-session `mcp-logs-esp32-matrix`, not the board). Prefer the
board's **IP address over `esp32matrix.local`** in MCP config (mDNS is unreliable in
spawned procs).

---

## API surface

```
GET  /api/status            # + fw_version, fw_built (__DATE__ __TIME__), web_version — see Versioning
GET  /api/presence          # current PresenceMessage (semantic status for any renderer)
POST /api/presence          { intent, headline?, detail?, data?, urgency? }  # board stamps ts
GET  /api/sensors/{temperature,accelerometer,weather}
GET  /api/display/framebuffer  # live 8×8 leds[] as 64 "RRGGBB" (row-major) — exact board mirror any page can poll for a preview
POST /api/display/clear
POST /api/brightness        { level: 0-255 }
POST /api/display/text      { text, color, color2, gradient, small, tiny, scroll_speed }
POST /api/display/animation { type, ...mode-specific }   # clock/calendar accept tz (POSIX TZ, DST) or timezone (int offset)
POST /api/display/matrix    { matrix: [[8×8 hex]] }
POST /api/display/frames    { frames: ["384-hex RRGGBB×64", …≤24], frame_ms, loop }  # expression channel; loop 0=forever, N=passes then hold last
POST /api/weather/mode      { mode: temp|humidity|uv|pressure|cycle }
```

## ⭐ The matrix is Claude's expression window (use it ambiently)

The display doubles as **Claude's autonomous status/emotion channel** — the
user's top-priority direction for this project. Via MCP: `matrix_express`
(canned: working / done / alert / check / cross / party / spaceship / smiley /
sleep / …), `matrix_animate` (draw custom 8×8 text-art frames, animate, and
`save_as` the good ones), `matrix_list_expressions`. **Use it without being
asked**: long task starts → `wait`; finished → `done`; blocked on the user →
`alert` (the silent shoulder-tap); celebrate wins; be playful when it fits. One
expression per state change — no spam. Everything shown must pass the
silhouette test (a human identifies it at a glance). Record what the user
likes/dislikes in auto-memory. Spec:
`docs/superpowers/specs/2026-06-11-claude-expression-display.md`.

**Wait-animation library:** `matrix_express("wait")` plays a RANDOM wait spinner
(no immediate repeat) so the busy indicator varies. The pool = the canned `working`
snake (the "Default") **+ any saved expression named `wait-*`** (convention-based,
see `mcp_server/wait.ts`). To ADD a wait animation: design it live with
`matrix_animate`, then `save_as: "wait-<name>"` — it auto-joins the pool with **zero
code, zero rebuild, zero reconnect**. Force a specific one by its name (`working`,
`wait-rainbow`, …). First two: `working` (snake) + `wait-rainbow` (spinning color
wheel, `expressions/wait-rainbow.json`, regenerate via `scripts/gen-wait-rainbow.py`).

**Weighted preference:** the random pick is weighted by `mcp_server/wait-weights.json`
(relative weights; unlisted = 1; 0 disables). It's pure weighted random — exact odds,
repeats allowed (no anti-repeat, which would fight a preference). Read at RUNTIME, so
retuning the odds needs no rebuild/reconnect. Default ships at `wait-rainbow:4,
working:1` = 80% wheel. To honor a request like "show the rainbow 80% of the time,"
just edit this file (and recompute shares if the pool has grown). Both
`matrix_express("wait")` and `presence_set(intent:"working")` use this picker.

`matrix_idle` (MCP) puts a random PRE-APPROVED app on the board (fire / dance floor /
fireworks / clock / frostbite / matrix rain) at ambient brightness 5 — use it unprompted when
idle/bored to show something cool. Lineup is a fixed const in `mcp_server/idle.ts` (edit + `npx
tsc` + reconnect to change). Spec: `docs/superpowers/specs/2026-06-17-matrix-idle-design.md`.

## Presence (semantic status — the protocol-in-embryo)

`presence_set` (MCP) emits a **PresenceMessage** — `intent` (working/thinking/done/ok/
celebrate/alert/error/question/info/idle) + optional `headline`/`detail`/`data`
(progress | 1–3 readouts | sparkline) + `urgency`. One call renders on BOTH the 8×8
(canned glyph via the frame path) and the **desktop card** (`/presence-card.html`, polls
`/api/presence`). The board stores the last message at `/api/presence` (RAM). This is the
first slice of the "presence protocol" — one semantic message, many renderers. The 8×8 shows the intent glyph (MCP frame push) for glyph-only presences; when a presence
carries `data`, the board renders it NATIVELY (v0.5) — progress as a bottom-up panel fill,
`series` as a column sparkline, `values` as a cycling 3×5 number, all in the intent's color
(`anim_presence.ino`). The desktop card always renders the full rich message. Spec:
`docs/superpowers/specs/2026-06-17-presence-protocol-v0-design.md`.

## Versioning (know what's actually deployed)

One canonical version in the repo-root **`VERSION`** file (SemVer, started 0.1.0),
stamped into all three independently-deployed artifacts so each self-reports:
- **firmware** → `version.h` `#define FW_VERSION`; `GET /api/status` returns
  `fw_version` + `fw_built` (the compiler's `__DATE__ __TIME__`, auto-updates every
  reflash even without a bump).
- **web bundle** → `data/version.json`, read at boot, reported as `web_version`.
- **MCP server** → `mcp_server/package.json`, read at runtime (no longer hardcoded).

**Bump deliberately:** `npm run bump:patch|minor|major` (root `package.json`) → rewrites
`VERSION`, stamps all three, commits `chore: bump vX.Y.Z`. Then **deploy each artifact to
make it live**: flash (firmware), LittleFS-upload (web), rebuild+reconnect (MCP) — a bump
is *not* live until its artifact is redeployed.

**Check drift:** `npm run check` (terminal) or the **`matrix_version`** MCP tool — both
compare repo `VERSION` to what each artifact reports and flag `⚠ DRIFT`. The general,
reusable discipline lives in the user-scoped `versioning` skill (this repo is its worked
example). Spec: `docs/superpowers/specs/2026-06-16-version-certainty-design.md`.

> Don't hand-edit `version.h` / `data/version.json` — they're generated by
> `scripts/version-stamp.js`. Edit `VERSION` (via `npm run bump:*`) instead.

## Auto-resume (NVS)

The board persists its **last animation** + **brightness** to NVS (`Preferences`,
namespace `matrix`) and restores them on boot — so it powers back up into
whatever it was showing. `handleAnimation` is split into `applyAnimationBody(body)`
(shared by the HTTP handler and the boot-time restore in `setup()`). Clearing the
display (`/api/display/clear`) makes it boot blank. Text/sketch are transient
(not auto-resumed). If you're puzzled why the board "starts showing something" on
power-up — that's this.
