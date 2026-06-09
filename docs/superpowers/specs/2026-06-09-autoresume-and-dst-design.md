# Auto-Resume (Preferences/NVS) + DST Timezones — Design Spec
**Date:** 2026-06-09

Two firmware-only QoL features using the ESP32 Arduino 3.x core (no hardware).

## 1. Auto-resume the last display on boot
Today the board boots to a blank matrix until commanded, and all settings live in
the browser. Use `Preferences` (NVS) so the board remembers and restores itself.

**What's persisted (NVS namespace `matrix`):**
- `bri` (uint8) — saved in `handleBrightness`.
- `kind` (string) — `"anim"` (resume it) or `"off"` (stay blank).
- `animbody` (string) — the raw JSON body of the last `/api/display/animation`.

**Writes:**
- `handleBrightness` → `putUChar("bri", brightness)` (NVS skips no-op writes, so
  slider drags don't wear flash).
- `handleAnimation` → `putString("kind","anim")` + `putString("animbody", body)`.
- `handleClear` → `putString("kind","off")`.
- Text/sketch-matrix are transient — not persisted (board resumes the last
  *animation*, or stays blank after a Clear). Documented, intentional.

**Restore (end of `setup()`, after WiFi is up so clock/calendar NTP works):**
```
brightness = prefs.getUChar("bri", brightness); FastLED.setBrightness(brightness);
if (prefs.getString("kind","") == "anim") {
  String b = prefs.getString("animbody","");
  if (b.length()) applyAnimationBody(b);   // re-applies via the shared path
}
```

**Refactor:** `handleAnimation()` splits into `bool applyAnimationBody(const String&)`
(parse + apply all mode globals, returns false on bad JSON) and a thin HTTP wrapper
that persists + responds. `applyAnimationBody` is reused by the boot-restore.

When a browser later opens a page, `bright.js` re-POSTs its own brightness — the
browser wins when present; resume is for headless power-up.

## 2. DST-aware timezones (`configTzTime`)
The clock/calendar used a fixed UTC offset (`configTime`) — no DST. Add a shared
helper that prefers a POSIX TZ string (auto-DST), falling back to the integer
offset for the MCP / old callers:
```
static void startNtp(JsonDocument& doc) {
  const char* tz = doc["tz"] | "";
  if (strlen(tz) > 0) { clockTZ = String(tz); configTzTime(clockTZ.c_str(), "pool.ntp.org", "time.nist.gov"); }
  else { clockTimezone = doc["timezone"] | -7; configTime((long)clockTimezone*3600L, 0, "pool.ntp.org", "time.nist.gov"); }
}
```
clock + calendar handlers call `startNtp(doc)`. Web `clock.html` + `calendar.html`
get a TZ dropdown sending POSIX strings (Phoenix `MST7` default; US zones with
DST like `MST7MDT,M3.2.0,M11.1.0`, plus UTC/UK/CET/JST/Sydney). The whole body is
persisted, so resume restores the right TZ too.

## Files
- `esp32_matrix_webserver.ino`: `#include <Preferences.h>`, globals `Preferences prefs`
  + `String clockTZ`, `prefs.begin("matrix",false)` + restore block in setup().
- `api_handlers.ino`: `startNtp` helper; `handleAnimation` refactor; persist in
  handleBrightness/handleAnimation/handleClear; clock+calendar use `startNtp`.
- `data/clock.html`, `data/calendar.html`: TZ dropdown → `tz` param.

## Verify (flash)
Power-cycle after setting an animation → board boots back into it at the saved
brightness. Clear → boots blank. Pick a DST zone → time is correct (and shifts
correctly across a DST boundary).
