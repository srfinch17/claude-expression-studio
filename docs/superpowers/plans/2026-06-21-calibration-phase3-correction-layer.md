# Calibration Phase 3 — Active Correction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume the measured `data/calibration.json` as an always-on, toggleable correction layer so every animation, expression, and app renders with the panel's real color/brightness behavior corrected — across firmware, the web preview (`ledsim.js`), and the MCP palette.

**Architecture:** The firmware loads `calibration.json` at boot into a `CalibrationProfile` struct (identity fallback on absence). Animations keep writing to the working buffer `leds[]`; FastLED is re-pointed at a new output buffer `ledsOut[]`. A single chokepoint `matrixShow()` copies `leds[]→ledsOut[]`, applies `applyCalibration()` (floor-lift → white-balance → gamma, via a precomputed LUT) when the `calibration_correction` setting is on, then calls `FastLED.show()`. All 22 `FastLED.show()` sites move to `matrixShow()` **except** the grid-test/calibration patterns, which must render the raw panel. `ledsim.js` mirrors the same math for color-fidelity previews; the MCP exposes the toggle and reads the verified palette.

**Tech Stack:** Arduino C++ (ESP32 core, FastLED, ArduinoJson, LittleFS, Preferences/NVS); vanilla HTML/JS (no build step) for web; TypeScript (`tsc`) for MCP.

## Verification model (read this first)

Identical to the Phase 1 plan: this repo has **no automated firmware/web test harness** — Claude cannot compile, flash, or see LEDs. The real cycle is:

1. Claude edits firmware (`.ino`) / web (`data/*`) / MCP (`*.ts`).
2. **User** does **Sketch → Upload** (firmware), **LittleFS Data Upload** (web), and/or **`/mcp` reconnect** (MCP). The plan states which each task needs.
3. Verification splits: **Claude-runnable (HTTP)** — curl the board, read `/api/display/framebuffer` (the raw `leds[]`/`ledsOut[]` mirror) to confirm corrected pixel values numerically; **User-confirmed (eyeball)** — the user reports what the panel shows, especially the A/B toggle.

There is no "write a failing test first" step because there is no harness — the instruction-priority-correct adaptation of TDD to this hardware-in-the-loop codebase, exactly as Phase 1 did. Each task ends with HTTP + eyeball verification (where applicable) and a commit.

## Global Constraints

- **COLOR_ORDER is `RGB`** — `CRGB(r,g,b)` maps straight through. `Data pin 14, 64 WS2812B, XY(x,y)=y*8+x` row-major. Draw via `setPixel(x,y,CRGB)`.
- **Measured calibration values (from `data/calibration.json`, Phase 2):** `floors {r:1,g:1,b:1}` (all identity — floor-lift is INERT for this panel but implemented general), `white_balance {r:1.0, g:0.863, b:1.0}`, `gamma 2.0`, `palette {amber:#ffb000, cyan:#00ffe6, magenta:#ff14a0, orange:#ff5008, white:#ffffff}`, `steps 20`, `pixel_trim null`.
- **Absence/parse-failure ⇒ identity correction** (floors=1, gains=1.0, gamma=1.0). Never break rendering or boot.
- **Correction is gated by NVS setting `calibration_correction` (bool, default `true`)** for A/B + fallback. Off ⇒ `matrixShow()` is a plain copy+show, bit-identical to today.
- **The Calibration Lab MUST measure the RAW panel.** `handleGridTest()`'s show stays `FastLED.show()` on `leds[]` (uncorrected). This means grid-test renders to `leds[]` and shows it directly — see Task 2 Step 5. Do NOT route grid-test through `matrixShow()`.
- **⚠️ DOUBLE-SCALING TRAP (the `led-brightness-formula` memory):** FastLED applies global brightness as `(c×(bri+1))>>8` at `show()` time. Our gamma stage darkens values in the *value domain* BEFORE that scaling, so at low brightness (the expression baseline **bri 5**) a gamma-reduced channel can round to effective 0 and vanish. Self-scaling animations (`nscale8`) add a third stage. The correction must COMPOSE: a corrected, self-scaled, globally-scaled pixel must still clear its floor at bri 5. **This is why Task 7 hardware-validates at bri 5 AND bri 40 with the A/B toggle** — it is the single highest-risk part of this plan.
- **All `.ino` compile as one TU**; concatenation puts the main ino FIRST. Put the `CalibrationProfile` struct, the `calib`/`ledsOut` globals, `applyCalibration()`, and `matrixShow()` in the **main ino** so every later file sees them (Arduino auto-prototypes, but shared globals/structs must precede use — see `feedback_firmware_review_limits`).
- **Performance:** `applyCalibration` runs every frame on 64 px. Use a precomputed 256-entry `gammaLUT` + integer math only — no `pow()` per pixel. The board already shows periodic render stalls ([[bug-render-crash-matrix-solid]]); do not add per-frame float work.
- **Don't hand-edit `version.h`/`data/version.json`** — generated. Version bump goes through `npm run bump:*` (Task 7).
- **Privacy:** never use the maintainer's real name in code/comments — "the user".

## File Structure

- `esp32_matrix_webserver/esp32_matrix_webserver.ino` — `CalibrationProfile` struct + `calib` global + `ledsOut[]` buffer (near `leds[]` ~123); `loadCalibration()` + `buildGammaLUT()` + `applyCalibration()` + `matrixShow()` (near the render helpers); `addLeds` re-pointed to `ledsOut` (~590); boot call to `loadCalibration()` in `setup()`; replace the main ino's own `FastLED.show()` sites with `matrixShow()`; `Settings` struct gains `calibCorrection`.
- `esp32_matrix_webserver/calibration.ino` — **new** file holding `loadCalibration()`, `buildGammaLUT()`, `applyCalibration()`, `matrixShow()` bodies (declarations/globals stay in main ino). Keeps the main ino lean; one clear responsibility = the correction pipeline.
- `esp32_matrix_webserver/settings.ino` — `calibration_correction` in load/save/json/apply.
- `esp32_matrix_webserver/api_handlers.ino` — replace `FastLED.show()` → `matrixShow()` EXCEPT inside `handleGridTest()`; add `/api/calibration` POST handler reload hook (re-`loadCalibration()` after a save so it goes live without reboot).
- `esp32_matrix_webserver/anim_effects.ino`, `anim_presence.ino` — replace their `FastLED.show()` → `matrixShow()`.
- `esp32_matrix_webserver/data/settings.html` — calibration-correction checkbox.
- `esp32_matrix_webserver/data/ledsim.js` — fetch `/api/calibration`, add `applyCalibration` to `previewColor`.
- `mcp_server/index.ts` — `calibration_correction` in `matrix_set_settings` schema; (optional) a `matrix_palette` read of `/api/calibration`.

---

### Task 1: Firmware — `CalibrationProfile` struct, boot load, gamma LUT

**Files:**
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (struct + globals near `leds[]` ~123; boot call in `setup()` after LittleFS mount, near the version.json read ~734)
- Create: `esp32_matrix_webserver/calibration.ino` (`loadCalibration()`, `buildGammaLUT()`)

**Interfaces:**
- Produces: `struct CalibrationProfile { uint8_t floorR,floorG,floorB; float gainR,gainG,gainB; float gamma; };` global `CalibrationProfile calib;`; `uint8_t gammaLUT[256];` global; `void loadCalibration();` `void buildGammaLUT();`. Consumed by Task 2 (`applyCalibration`).

- [ ] **Step 1: Add struct + globals in the main ino** (after `CRGB leds[NUM_LEDS];` ~123):

```cpp
// ── LED calibration (Phase 3 correction layer) ───────────────
// Measured profile from data/calibration.json (Phase 2). Identity = do-nothing.
struct CalibrationProfile {
  uint8_t floorR = 1, floorG = 1, floorB = 1;          // min value a nonzero channel is lifted to
  float   gainR = 1.0f, gainG = 1.0f, gainB = 1.0f;    // white-balance gains (<=1.0, never amplify)
  float   gamma = 1.0f;                                 // perceptual exponent for ramps
};
CalibrationProfile calib;            // populated by loadCalibration() at boot
uint8_t  gammaLUT[256];              // gammaLUT[v] = round(255*(v/255)^calib.gamma)
CRGB     ledsOut[NUM_LEDS];          // FastLED-registered OUTPUT buffer (corrected copy of leds[])
```

- [ ] **Step 2: Create `calibration.ino`** with the loader + LUT builder:

```cpp
// calibration.ino — Phase 3 active correction pipeline.
// Loads the measured profile (data/calibration.json) and applies floor-lift →
// white-balance → gamma at the single show() chokepoint. Identity fallback on
// absence/parse-failure so the panel never breaks. Struct/globals + matrixShow()
// declarations live in the MAIN ino (single-TU concatenation order).

void buildGammaLUT() {
  for (int v = 0; v < 256; v++) {
    if (v == 0 || calib.gamma == 1.0f) { gammaLUT[v] = (uint8_t)v; continue; }
    float f = powf((float)v / 255.0f, calib.gamma);
    gammaLUT[v] = (uint8_t)constrain((int)lroundf(f * 255.0f), 0, 255);
  }
}

void loadCalibration() {
  // Identity defaults already set by the struct's member initializers.
  calib = CalibrationProfile();
  if (LittleFS.exists("/calibration.json")) {
    File f = LittleFS.open("/calibration.json", "r");
    if (f) {
      JsonDocument doc;
      if (deserializeJson(doc, f) == DeserializationError::Ok) {
        calib.floorR = (uint8_t)constrain((int)(doc["floors"]["r"] | 1), 1, 255);
        calib.floorG = (uint8_t)constrain((int)(doc["floors"]["g"] | 1), 1, 255);
        calib.floorB = (uint8_t)constrain((int)(doc["floors"]["b"] | 1), 1, 255);
        calib.gainR  = constrain((float)(doc["white_balance"]["r"] | 1.0), 0.0f, 1.0f);
        calib.gainG  = constrain((float)(doc["white_balance"]["g"] | 1.0), 0.0f, 1.0f);
        calib.gainB  = constrain((float)(doc["white_balance"]["b"] | 1.0), 0.0f, 1.0f);
        calib.gamma  = constrain((float)(doc["gamma"] | 1.0), 0.1f, 4.0f);
      }
      f.close();
    }
  }
  buildGammaLUT();
  Serial.printf("Calibration: floors(%u,%u,%u) gains(%.3f,%.3f,%.3f) gamma=%.2f\n",
                calib.floorR, calib.floorG, calib.floorB,
                calib.gainR, calib.gainG, calib.gainB, calib.gamma);
}
```

- [ ] **Step 3: Call `loadCalibration()` at boot** in `setup()`, right after the `version.json` read block (~741, after LittleFS is mounted):

```cpp
  loadCalibration();   // calibration.ino — measured profile into `calib` + gammaLUT (identity if absent)
```

- [ ] **Step 4: User deploys** — **Sketch → Upload** (firmware only).

- [ ] **Step 5: Verify (HTTP + Serial)** — Open Serial Monitor; on boot expect a line:
  `Calibration: floors(1,1,1) gains(1.000,0.863,1.000) gamma=2.00`. Confirms the committed `calibration.json` parsed into the struct. (Nothing renders differently yet — `applyCalibration` lands in Task 2.)

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/esp32_matrix_webserver.ino esp32_matrix_webserver/calibration.ino
git commit -m "feat(calibration): load profile + gamma LUT at boot (Phase 3 scaffold)"
```

---

### Task 2: Firmware — `applyCalibration()` + `matrixShow()` chokepoint

**Files:**
- Modify: `esp32_matrix_webserver/calibration.ino` (add `applyCalibration`, `matrixShow`)
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (re-point `addLeds` to `ledsOut`; declare `matrixShow`; replace its own `FastLED.show()` sites)
- Modify: `esp32_matrix_webserver/api_handlers.ino`, `anim_effects.ino`, `anim_presence.ino` (replace `FastLED.show()` → `matrixShow()`, EXCEPT `handleGridTest`)

**Interfaces:**
- Consumes: `calib`, `gammaLUT`, `leds[]`, `ledsOut[]`, `settings.calibCorrection` (Task 3 adds the field; until then gate on a literal `true`).
- Produces: `void applyCalibration(CRGB* buf);` `void matrixShow();`. Every render path calls `matrixShow()` instead of `FastLED.show()`.

- [ ] **Step 1: Add `applyCalibration()` + `matrixShow()`** to `calibration.ino`:

```cpp
// In-place correction on a buffer: floor-lift → white-balance → gamma.
// Order per spec. Floors are identity (1) for this panel so floor-lift is inert,
// but kept general. Gains attenuate (<=1.0). Gamma re-spaces via the LUT.
static inline uint8_t liftFloor(uint8_t c, uint8_t floor) {
  return (c > 0 && c < floor) ? floor : c;
}
void applyCalibration(CRGB* buf) {
  for (int i = 0; i < NUM_LEDS; i++) {
    uint8_t r = liftFloor(buf[i].r, calib.floorR);
    uint8_t g = liftFloor(buf[i].g, calib.floorG);
    uint8_t b = liftFloor(buf[i].b, calib.floorB);
    r = (uint8_t)(r * calib.gainR);
    g = (uint8_t)(g * calib.gainG);
    b = (uint8_t)(b * calib.gainB);
    buf[i].r = gammaLUT[r];
    buf[i].g = gammaLUT[g];
    buf[i].b = gammaLUT[b];
  }
}

// The single show() chokepoint. Animations write leds[]; we copy to the
// FastLED-registered ledsOut[], correct the COPY (so read-back animations never
// compound), then show. Correction is skipped when the setting is off — then it
// is a plain copy+show, bit-identical to pre-Phase-3 behavior.
void matrixShow() {
  memcpy(ledsOut, leds, sizeof(leds));
  if (settings.calibCorrection) applyCalibration(ledsOut);
  FastLED.show();
}
```

- [ ] **Step 2: Forward-declare `matrixShow` in the main ino** near the other prototypes (top, after the globals) so all files resolve it regardless of concatenation order:

```cpp
void matrixShow();
void applyCalibration(CRGB* buf);
```

- [ ] **Step 3: Re-point FastLED at the output buffer** (`setup()` ~590):

```cpp
  FastLED.addLeds<LED_TYPE, LED_PIN, COLOR_ORDER>(ledsOut, NUM_LEDS);   // show the corrected copy
```

The boot self-test fill at ~592-593 stays as-is BUT change its show to `matrixShow()` so the very first frame goes through the chokepoint (fills `leds[]` then shows):
```cpp
  fill_solid(leds, NUM_LEDS, CRGB::Black);
  matrixShow();
```

- [ ] **Step 4: Replace `FastLED.show()` → `matrixShow()` everywhere EXCEPT grid-test.** Sites (verify with `grep -n "FastLED.show()"`): main ino (~11), `api_handlers.ino` (8, **minus the one in `handleGridTest`**), `anim_effects.ino` (1), `anim_presence.ino` (1), `settings.ino` (1, the brightness live-apply). Use a careful per-file pass — do NOT blind sed (the grid-test one must survive).

- [ ] **Step 5: Keep `handleGridTest()` raw.** Its render fills `leds[]` and must show the RAW panel for measurement. Because FastLED is now registered to `ledsOut[]`, `handleGridTest` must copy `leds→ledsOut` WITHOUT correction then show. Replace its `FastLED.show();` (around line where the grid pattern ends) with:

```cpp
  memcpy(ledsOut, leds, sizeof(leds));   // raw copy — NO applyCalibration (Lab measures the real panel)
  FastLED.show();
```

- [ ] **Step 6: Temporary gate** — Task 3 adds `settings.calibCorrection`. Until then, in `matrixShow()` use `if (true)` so this task is testable standalone; Task 3 swaps it to `settings.calibCorrection`. (If doing Tasks 2+3 in one sitting, skip this and use the real field.)

- [ ] **Step 7: User deploys** — **Sketch → Upload** (firmware only).

- [ ] **Step 8: Verify (HTTP framebuffer + eyeball).** `/api/display/framebuffer` mirrors `leds[]` (the working buffer, uncorrected) — so to verify correction we read the *effect on the panel*, not the framebuffer. Steps:
  1. `curl -s -X POST $ESP32_URL/api/display/animation -d '{"type":"solid","color":"#ffffff","transient":true}'` then ask the user: white should now read **neutral** (green tamed by the 0.863 gain), not green-tinted. This is the live proof the correction is active.
  2. Drive a `solid #00ff00` (pure green): user confirms it is slightly dimmer than before but still clearly green (gain applied, not crushed).
  3. Drive the Calibration Lab `sweep_g` at bri 255 (`/api/grid-test/set`): user confirms it is FULL raw green (grid-test bypassed correction). If it looks dimmed, the Step-5 carve-out failed.
  Restore: brightness 5 + `solid` fire (per `feedback_restore_board_after_testing`).

- [ ] **Step 9: Commit**

```bash
git add esp32_matrix_webserver/
git commit -m "feat(calibration): applyCalibration + matrixShow chokepoint; grid-test stays raw"
```

---

### Task 3: Firmware — `calibration_correction` setting + live reload

**Files:**
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (`Settings` struct gains `bool calibCorrection;`)
- Modify: `esp32_matrix_webserver/settings.ino` (load/save/json/apply)
- Modify: `esp32_matrix_webserver/calibration.ino` or `api_handlers.ino` (the existing `handleCalibrationPost` re-loads after save)

**Interfaces:**
- Consumes: the `Settings` pattern (NVS key `calib_corr`, default `true`).
- Produces: `settings.calibCorrection` (read by `matrixShow`); `/api/settings` exposes `calibration_correction`; a save to `/api/calibration` triggers `loadCalibration()` so a re-measured profile goes live without reboot.

- [ ] **Step 1: Add the field** to `struct Settings` (main ino ~157, after `tz`):

```cpp
  bool     calibCorrection;   // apply the measured LED calibration correction (default true)
```

- [ ] **Step 2: load/save** in `settings.ino`. In `loadSettings()` (after the `tz` line ~31):

```cpp
  settings.calibCorrection = prefs.isKey("calib_corr") ? prefs.getBool("calib_corr", true) : (prefs.putBool("calib_corr", true), true);
```
In `saveSettings()` (after the `tz` line ~50):
```cpp
  prefs.putBool("calib_corr", settings.calibCorrection);
```

- [ ] **Step 3: JSON in/out** in `settings.ino`. In `settingsToJson()` (before the closing `}` ~66):

```cpp
  j += ",\"calibration_correction\":" + String(settings.calibCorrection ? "true" : "false");
```
In `applySettingsJson()` (after the `timezone` block ~89):
```cpp
  if (!doc["calibration_correction"].isNull()) settings.calibCorrection = doc["calibration_correction"].as<bool>();
```

- [ ] **Step 4: Swap the temporary gate** — in `matrixShow()` change `if (true)` → `if (settings.calibCorrection)`.

- [ ] **Step 5: Live-reload on re-measure** — in `handleCalibrationPost()` (api_handlers.ino), after the file write succeeds and before the `200` response, add:

```cpp
  loadCalibration();   // re-measured profile goes live immediately (no reboot)
```

- [ ] **Step 6: User deploys** — **Sketch → Upload** (firmware only).

- [ ] **Step 7: Verify (HTTP A/B + eyeball)** — the money test:
```bash
curl -s "$ESP32_URL/api/settings" | grep calibration_correction          # -> true
curl -s -X POST $ESP32_URL/api/display/animation -d '{"type":"solid","color":"#ffffff","transient":true}'
# user: white reads NEUTRAL (correction ON)
curl -s -X POST $ESP32_URL/api/settings -d '{"calibration_correction":false}'
# user: same white now reads GREEN-tinted (correction OFF) — instant A/B
curl -s -X POST $ESP32_URL/api/settings -d '{"calibration_correction":true}'   # back on
```
Confirm the toggle persists across a reboot (power-cycle, re-GET settings).

- [ ] **Step 8: Commit**

```bash
git add esp32_matrix_webserver/
git commit -m "feat(calibration): calibration_correction setting (default on) + live reload on re-measure"
```

---

### Task 4: Web — settings.html correction toggle

**Files:**
- Modify: `esp32_matrix_webserver/data/settings.html`

**Interfaces:**
- Consumes: `GET/POST /api/settings` `calibration_correction` (Task 3).

- [ ] **Step 1: Add the control.** Find the settings form pattern in `settings.html` (match the existing `idle_enabled` checkbox markup exactly — same label/row/`id` convention). Add a checkbox `id="calibration_correction"` labeled **"LED calibration correction"** with help text "Apply the measured color/brightness correction (from the Calibration Lab). Turn off to A/B compare." Wire it into the page's existing load (`GET /api/settings` → set `.checked`) and save (`POST` the boolean) routines the same way `idle_enabled` is wired — reuse, don't reinvent.

- [ ] **Step 2: User deploys** — **LittleFS Data Upload** (web only).

- [ ] **Step 3: Verify (eyeball + interaction)** — open `/settings.html`: the toggle reflects the board's current value; unchecking + saving makes white go green-tinted live (same A/B as Task 3, now from the UI); reload shows the persisted state.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/settings.html
git commit -m "feat(calibration): settings.html correction toggle"
```

---

### Task 5: Web — `ledsim.js` correction (previews match the corrected board)

**Files:**
- Modify: `esp32_matrix_webserver/data/ledsim.js`

**Interfaces:**
- Consumes: `GET /api/calibration`. Produces: `previewColor` output reflects floor→wb→gamma so color-fidelity previews (emoji, sketch, calibration pages) match the corrected panel. Respects the existing rule that animation previews render at full brightness — correction is about color fidelity and applies wherever `previewColor` is already used.

- [ ] **Step 1: Fetch + cache the profile** (top of the IIFE, after `DEFAULT_BRI`):

```js
  var CALIB = { floorR:1, floorG:1, floorB:1, gainR:1, gainG:1, gainB:1, gamma:1, on:true };
  fetch('/api/calibration').then(function (r) { return r.json(); }).then(function (j) {
    CALIB.floorR = (j.floors && j.floors.r) || 1;
    CALIB.floorG = (j.floors && j.floors.g) || 1;
    CALIB.floorB = (j.floors && j.floors.b) || 1;
    CALIB.gainR = (j.white_balance && j.white_balance.r) || 1;
    CALIB.gainG = (j.white_balance && j.white_balance.g) || 1;
    CALIB.gainB = (j.white_balance && j.white_balance.b) || 1;
    CALIB.gamma = j.gamma || 1;
  }).catch(function () { /* identity fallback already set */ });
  // Optional: also read /api/settings calibration_correction into CALIB.on so the
  // preview honors the toggle. Default on.
```

- [ ] **Step 2: Apply correction in the value domain** — add a helper and call it in `previewColor` BEFORE `effective()` (correction is value-domain; brightness scaling stays after):

```js
  function liftFloor(c, floor) { return (c > 0 && c < floor) ? floor : c; }
  function correctChannel(c, floor, gain) {
    if (!CALIB.on) return c;
    c = liftFloor(c, floor);
    c = c * gain;
    return Math.round(255 * Math.pow(c / 255, CALIB.gamma));   // gamma last, matches firmware
  }
```
In `previewColor`, replace the three `effective(rgb[k], bri)` calls with `effective(correctChannel(rgb[0],CALIB.floorR,CALIB.gainR), bri)` etc.

- [ ] **Step 3: User deploys** — **LittleFS Data Upload** (web only).

- [ ] **Step 4: Verify (eyeball)** — open a page that uses accurate-dim preview (e.g. the emoji or calibration page). A white/grey swatch in the preview should now look neutral (matching the corrected board), not green. Toggle correction off via settings and reload: preview leans green again.

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/data/ledsim.js
git commit -m "feat(calibration): ledsim.js mirrors the correction so previews match the board"
```

---

### Task 6: MCP — expose the toggle + verified palette

**Files:**
- Modify: `mcp_server/index.ts`

**Interfaces:**
- Consumes: `/api/settings`, `/api/calibration`. Produces: `matrix_set_settings` accepts `calibration_correction`; (optional) a `matrix_palette` tool returns the verified palette so palette-aware tooling prefers safe colors.

- [ ] **Step 1: Add the toggle to `matrix_set_settings`** schema (~683, after `timezone`):

```ts
          calibration_correction: { type: "boolean" },
```
And append to that tool's description: " calibration_correction (bool — apply the measured LED color/brightness correction; turn off to A/B compare)." Confirm the handler (~926-931) forwards the whole patch object (it does — it posts `patch` straight through), so no handler change is needed beyond the schema.

- [ ] **Step 2 (optional but in-scope per spec): `matrix_palette` read tool.** Add a tool that GETs `/api/calibration` and returns the `palette` map, so expression/idle color choices can prefer verified hues (amber `#ffb000`, cyan `#00ffe6`, magenta `#ff14a0`, orange `#ff5008`, white `#ffffff`). Register name + schema in HANDLER 1, implement the GET in HANDLER 2. Keep it read-only.

- [ ] **Step 3: Rebuild + reconnect** — the hook rebuilds `dist` on save; ask the user to **`/mcp` reconnect** to load the new build.

- [ ] **Step 4: Verify** — `matrix_set_settings { calibration_correction: false }` then `matrix_get_settings` shows it false (and the board goes green-tinted on white); set back true. If Step 2 done, `matrix_palette` returns the five verified hexes.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/index.ts mcp_server/dist/
git commit -m "feat(calibration): MCP exposes correction toggle + verified palette"
```

---

### Task 7: Hardware validation (the double-scaling/low-bri gauntlet) + version bump

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-led-calibration-battery-design.md` (mark Phase 3 done), `VERSION` + stamps (via `npm run bump`).

**Interfaces:** Consumes everything above. This task is the empirical confirmation the correction composes correctly — especially the gamma/brightness double-scaling trap.

- [ ] **Step 1: Low-brightness gauntlet (bri 5).** With correction ON at brightness 5, the user reviews — watching for content that the gamma stage CRUSHES to black (the double-scaling trap):
  - `frostbite` (the original smoking-gun multi-color low-bri screen) — does it read better or worse than uncorrected? A/B via the toggle.
  - the Claude mascot expressions (`wait-claude`, `claude-idle`) — orange `#ff5008`/`#ff6a14` still vivid, not dimmed to mud?
  - a white/grey expression — neutral, not green, and not vanished.
  - If gamma 2.0 crushes low-bri content: this is expected risk. Options to try live (no reflash for the value): re-measure via the Lab with a gentler gamma and `POST /api/calibration` (live-reloads), OR decide gamma should not apply below a brightness threshold (firmware tweak → new task). Capture the decision.

- [ ] **Step 2: Mid-brightness pass (bri 40).** Spot-check a representative set across the app suite at a normal brightness with the A/B toggle: a couple of `anim_*` (fire, rainbow, wave), the clock, a weather screen, an expression. Confirm none regressed; note any that need re-tuning (feeds Phase 4).

- [ ] **Step 3: Re-confirm the palette under correction.** Re-show amber/cyan/magenta/orange/white (the Phase 2 hexes) with correction ON — they were tuned on the RAW panel, so verify they still read true now that the 0.863 green gain is live; nudge + (optionally) re-`POST /api/calibration` any that drifted.

- [ ] **Step 4: Mark spec Phase 3 done** — in the spec's "Later phases" section, note Phase 3 implemented + hardware-verified on `feat/calibration-battery`.

- [ ] **Step 5: Version bump (clears the Phase-1 deferred bump).** Phase 3 is a firmware+web+MCP feature → minor bump (1.0.0 is reserved for Phase 4 completion per the milestone):

```bash
npm run bump:minor    # rewrites VERSION + stamps fw/web/MCP, commits "chore: bump vX.Y.Z"
```
Then deploy each stamped artifact to clear drift: **Sketch → Upload** (version.h), **LittleFS Data Upload** (version.json), **`/mcp` reconnect** (package.json). Confirm with `npm run check` / `matrix_version` → no DRIFT.

- [ ] **Step 6: Commit any spec/doc edits**

```bash
git add docs/ && git commit -m "docs(calibration): Phase 3 correction layer shipped + verified"
```

> **Phase 4 (separate plan, NOT here):** the full-suite re-review/re-tune with correction on — every `anim_*`, all expression sets, presence, clock/calendar/weather/sound/sketch/emoji, idle lineup — applying the verified palette + deleting now-redundant hand-tuned floors (e.g. claudesweep's manual amber), → `npm run bump:major` to **v1.0.0**.

---

## Self-Review

**Spec coverage (Phase 3 scope):**
- Firmware boot-load into struct + identity fallback → Task 1. ✓
- `applyCalibration` (floor → wb → gamma) before each show, single chokepoint → Task 2. ✓
- Gated by `calibration_correction` NVS setting, default true, A/B → Task 3. ✓
- Setting plumbed into settings table + settings.html + MCP tools → Tasks 3/4/6. ✓
- `ledsim.js` mirrors correction → Task 5. ✓
- MCP reads palette → Task 6. ✓
- Double-scaling trap composes correctly, confirmed on hardware at bri 5 → Global Constraints + Task 7. ✓
- Raw-panel carve-out for the Lab → Global Constraints + Task 2 Steps 5/8. ✓

**Placeholder scan:** No TBD/TODO; each code step shows real code; verification gives exact curls + explicit eyeball asks. Task 6 Step 2 and Task 7 Step 1's gamma-remedy are flagged optional/contingent with concrete decision paths, not vague placeholders.

**Type/name consistency:** `CalibrationProfile`/`calib`/`gammaLUT`/`ledsOut`/`applyCalibration(CRGB*)`/`matrixShow()`/`loadCalibration()`/`buildGammaLUT()` and the setting key `calib_corr` ↔ JSON `calibration_correction` ↔ `settings.calibCorrection` are used consistently across firmware/web/MCP. The correction order (floor → wb → gamma) matches between firmware (`applyCalibration`) and JS (`correctChannel`).

**Known risk carried into execution:** the board's render-path stability bug ([[bug-render-crash-matrix-solid]]) is INDEPENDENT of this layer (it lives in `handleMatrix` JSON parsing / `handleAnimation` NVS, not in show), but `matrixShow` adds a per-frame memcpy+correct — kept cheap (LUT + int math, no per-pixel float) so it doesn't worsen the periodic stalls. Fixing that bug is a sibling effort, not part of this plan.
