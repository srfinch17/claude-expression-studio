# Board HTTP API, the contract this repo depends on

The studio (the engine in `mcp_server/` and the hooks in `claude-hooks/`) drives a
physical ESP32-S3 matrix **only** over HTTP. There is **no shared code** between this
repo and the firmware, this document is the loose, one-directional contract.

**Implemented by:** the [`peckworks-esp32s3matrix`](https://github.com/srfinch17/peckworks-esp32s3matrix)
repo (firmware + onboard web UI). The board's full API surface is documented there in
`docs/API.md`; the subset below is what the studio actually calls.

Base URL = `ESP32_URL` (default `http://esp32matrix.local`). The board is optional, 
every consumer degrades gracefully when it is unreachable (the engine falls back to its
in-memory store + the no-board SSE virtual board).

## Endpoints consumed

| Method | Path | Body / notes |
|---|---|---|
| GET  | `/api/status` | version + heap telemetry; used for reachability + drift checks |
| POST | `/api/brightness` | `{ level: 0-255 }` |
| POST | `/api/display/frames` | `{ frames: ["384-hex"…≤24], frame_ms, loop }`, the frame-expression channel |
| POST | `/api/display/animation` | `{ type, transient?, …params }`, firmware animations; `transient:true` skips NVS auto-resume |
| GET  | `/api/display/framebuffer` | live 8×8 `leds[]` as 64 `"RRGGBB"` (row-major), the mirror source |
| GET  | `/api/presence` | current `PresenceMessage` |
| POST | `/api/presence` | `{ intent, headline?, detail?, data?, urgency? }`, pure store on the board (no render) |
| POST | `/api/idle/arm` | arm the idle screensaver countdown (fired by the Stop hook) |

`shared/firmware-names.js` decides whether a resolved render takes the
`/api/display/animation` path (firmware sim) or `/api/display/frames` path (frame
expression). If this contract changes on the firmware side, update this file and the
engine/hook HTTP I/O to match.
