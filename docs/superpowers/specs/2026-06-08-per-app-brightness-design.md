# S1 · Per-App Brightness Widget — Design Spec
**Date:** 2026-06-08
**Roadmap item:** S1 (shared UI component)

## Overview

A single reusable brightness control that drops into every app page, so you can
adjust brightness without navigating back to the main page. Implemented as the
project's **first shared web include** (`data/bright.js`) — one source of truth
for the slider, the power-safety lock, debounced POSTs, and persistence.

**No firmware changes.** The `onNotFound` handler in
`esp32_matrix_webserver.ino` already streams any LittleFS file with the right
MIME type (`.js → application/javascript`), and `POST /api/brightness` already
exists. This is a pure web-UI change → only a **LittleFS Data Upload** is needed,
no sketch reflash.

---

## Design decision: one global brightness (Model A)

The board has exactly **one** physical brightness (the global FastLED
`brightness`, set by `/api/brightness`). Only one mode runs at a time. So:

- **Chosen — Model A (single global value):** every page's widget reads/writes
  the *same* brightness, shared via one `localStorage` key. Open any app page →
  the slider shows the current board brightness and you can tweak it in place.
  This fully satisfies "don't make me go back to the main page," and brightness
  never surprises you by jumping when you switch apps.
- **Rejected for v1 — Model B (per-app remembered brightness):** each app
  remembers its own preferred level and pushes it on launch. More moving parts,
  surprising jumps between apps, and the hardware can't hold independent values
  anyway. Parking it; revisit only if you explicitly want per-mode presets.

### Cleanup this also achieves
Today there are **two** divergent brightness implementations:
- `index.html` — rich version: 0–255 slider, safe/hot heat track, high-bright
  **lock**, debounced POST, persistence (`matrix_brightness` /
  `matrix_highbright`).
- `animations.html` — its own ad-hoc version under a different key
  (`sun_brightness`), no lock.

S1 replaces both with the shared widget on a single key. The `sun_brightness`
key and animations.html's bespoke brightness code are removed.

---

## The power-safety lock (must preserve)

index.html clamps brightness to **≤100 unless explicitly unlocked** (checkbox →
`matrix_highbright='1'`), because all 64 LEDs near full white can pull ~3–4 A and
brown out the board (see `docs/PITFALLS.md`). This safety logic **must** live in
the shared widget — consolidating it is actually safer (one place to get it
right) than today's state where animations.html has no lock at all.

Behavior:
- Default locked. Slider hard-caps at 100; values >100 are clamped on input.
- Unlock checkbox lifts the cap to 255 and persists in `matrix_highbright`.
- Re-locking while >100 snaps back to 100 and re-POSTs.

---

## Shared module: `data/bright.js`

A self-contained script (logic + injected CSS, single file) exposing a small
global. No build step, no framework — plain ES5/ES6 that the ESP32 serves as-is.

### Public API
```js
// Mount the widget into a container element and wire it up.
MatrixBright.mount('#brightnessSlot', {
  onStatus: (msg, isError) => setStatus(msg, isError)  // optional
});
```

`mount()`:
1. Injects the widget markup into the target: value readout, range input
   (0–255), safe/hot heat track, and the "unlock high brightness" checkbox.
   Markup/classes mirror index.html's current control so it looks identical.
2. Injects a `<style>` block (once) for `.mb-*` classes so any page gets the
   styling without a separate CSS file.
3. On load: reads `matrix_brightness` (default 10) and `matrix_highbright`,
   applies the lock cap, sets the slider, and POSTs the current value once so the
   board matches the UI (same as index.html's `initBrightness`).
4. `oninput`: clamp to lock, update readout, persist to `matrix_brightness`,
   **debounce 250 ms**, then `POST /api/brightness {level}`; report via
   `onStatus` if provided (silent if not).
5. Exposes `MatrixBright.get()` / `MatrixBright.set(v)` for pages that want to
   read/sync the value (e.g. a preview canvas dimming to match).

### localStorage keys (standardized)
- `matrix_brightness` — last value (0–255)
- `matrix_highbright` — `'1'` if the high-bright cap is unlocked

### POST shape (unchanged)
`POST /api/brightness` → `{ "level": 0-255 }`

---

## Page integration (per page)

Each app page gets a one-time edit:
1. Add a container where the control should appear:
   `<div id="brightnessSlot"></div>`
2. Before `</body>`: `<script src="bright.js"></script>` then
   `MatrixBright.mount('#brightnessSlot', { onStatus });`
3. Remove any page-local brightness slider/handler (notably animations.html's
   `sun_brightness` block).

### Pages to retrofit
All control pages: `animations.html`, `clock.html`, `emoji.html`, `fire.html`,
`imu.html`, `liquid.html`, `matrix_rain.html`, `temp.html`, `text.html`,
`timer.html`, `weather.html`, `weather2.html`, `grid_test.html`.

### index.html
Replace its inline brightness block with `MatrixBright.mount(...)` too, so there
is genuinely one implementation. Its existing markup becomes the widget's
template, so the main page looks unchanged.

> Placement convention: put the slot near the top of each page's controls (above
> mode-specific options) so it's consistently reachable.

---

## New / modified files

**New**
- `data/bright.js` — the shared widget (logic + injected styles)

**Modified (web only)**
- `data/index.html` — swap inline brightness for the widget
- All 13 app pages listed above — add slot + script, remove ad-hoc brightness
- `docs/PITFALLS.md` — note the shared-include pattern if anything bites
- `README.md` — mention per-page brightness (optional)

**Firmware:** none.

---

## Verification (hardware)

After a LittleFS Data Upload (no reflash needed):
1. Open two different app pages — both sliders show the same current value.
2. Move the slider on an app page → LEDs dim/brighten without leaving the page.
3. Reload → value persists. Cross-page → value is consistent.
4. Lock behavior: capped at 100 by default; unlock allows up to 255; re-lock
   snaps back to 100 and re-applies.
5. Board unreachable → `onStatus` reports the error (where the page wires it).

---

## Out of scope
- Per-app remembered brightness (Model B) — parked.
- Any firmware change to `/api/brightness`.
- Extracting S2 (palette) / S3 (canvas) — separate roadmap items, though
  `bright.js` establishes the shared-include pattern they'll follow.
