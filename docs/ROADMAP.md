# Roadmap — ESP32-S3 Matrix

Living backlog. Each item is a one-liner until we start it, then it graduates
into a full spec in `docs/superpowers/specs/`. **Specs are written
just-in-time** (one per feature, when we begin) — not all up front — to save
tokens and avoid designing things we'll redesign anyway.

Status: 🔵 planned · 🟡 spec'd · 🟠 in progress · ✅ done

---

## The big idea: build shared pieces ONCE

Several requested features are the same machinery wearing different hats. The
order below is chosen so we build each shared component once, then every later
feature just consumes it. Three reusable pieces carry most of the work:

### S1 · Brightness widget (per-app brightness control) 🟠 built — pending hardware test
Spec: `docs/superpowers/specs/2026-06-08-per-app-brightness-design.md`.
Shipped as `data/bright.js` (auto-mount or explicit). On index.html + 9 pages
that lacked brightness; the 4 preview-coupled pages (animations/matrix_rain/
emoji/grid_test) intentionally keep their bespoke controls.
A small reusable HTML/JS snippet that hits the existing `POST /api/brightness`.
You want it on **every** app page. Build it once as an include and drop it into
each page — and into every *new* page from the start, so we never retrofit.
**Consumed by:** all pages. **Firmware:** already done (`/api/brightness` exists).

### S2 · Palette + color-picker component 🟢 built
Shipped as `data/palette.js` (global `Palette`): `Palette.mount(el, {count, labels,
defaults, presets, onChange})` renders preset swatch chips + N labeled color
pickers, unified look, self-styled. Spec:
`docs/superpowers/specs/2026-06-09-palette-component-design.md`. Consumers:
Calendar, Sound, **clock** (migrated — 3-color), and **liquid** custom gradient
(migrated — 2-color).

**`animations.html` migration DEFERRED (deliberate, 2026-06-09).** Its 12 effects
wire bespoke pickers into `buildPayload` by element ID, and dancefloor/rainbow use
the 64-preset DF_PAL (not an N-color-picker pattern S2 models). A full rewrite of
that 1100-line file — with no compiler/hardware test loop — is high regression
risk for low benefit (cross-page uniformity is already achieved by the standalone
clock/liquid pages). Revisit only if animations.html is being reworked anyway.

### S3 · 8×8 canvas + matrix-push pipeline
`POST /api/display/matrix` (8×8 hex) already exists on the firmware. A shared JS
"8×8 grid renderer / paint surface" + the POST wrapper means **sketch and emoji
are mostly front-end work** — the board already knows how to display a static
frame. **Consumed by:** sketch (paint→push), emoji (downscale→push), any
"show this image" feature. The image **downscale + color-quantize** routine
(the emoji problem) lives here too and is reused anywhere we shrink an image to
8×8.

> Net effect: once S1–S3 exist, **sketch ≈ S3 paint grid + S1**, and
> **emoji ≈ sketch + the quantizer + image import**. We build the hard part once.

### S4 · `ledsim.js` — brightness-accurate preview model 🟠 built — pending hardware test
Spec: `docs/superpowers/specs/2026-06-08-ledsim-preview-design.md`. Shipped as
`data/ledsim.js` (global `LedSim`) + a `matrixbrightness` broadcast in
`bright.js`. The FastLED dimming + visibility-threshold + gamma math, extracted
from `emoji.html`/`grid_test.html` into one include. **Accurate-dim is opt-in** —
animation previews intentionally stay full-bright (prior UX decision); use
`LedSim` where color fidelity matters. **Consumed by:** emoji, sketch,
calibration. Reference + threshold table: `docs/LED_BRIGHTNESS.md`. The same
threshold (`minVisibleChannel(bri) = ceil(256/(bri+1))`) is what the **emoji
quantizer** must clamp colors above — so S4 and the emoji work share the model.

---

## Recommended order

### Phase 0 — Tooling (now) ✅/🟠
- ✅ Project `CLAUDE.md`, `docs/PITFALLS.md`, dev-loop memory
- 🟠 `add-animation` + `flash-and-verify` skills
- 🔵 Targeted code review of the **liquid module** when we open Phase 2 (find the
  color bug at its root) — prefer per-module reviews as we touch code over one
  whole-repo review (cheaper, more relevant).

### Phase 1 — Shared UI components 🔵
Build **S1 (brightness widget)** first and retrofit existing pages, then **S2**
and **S3** scaffolding. Everything downstream assumes these exist.

### Phase 2 — Liquid/fluid fixes 🟠 built — pending hardware test + IMU calibration
Spec: `docs/superpowers/specs/2026-06-08-liquid-fixes-design.md`. Color bug fixed
(reuses fire's `activePalette`), physics reworked to a 2D gravity-projection
closed container, custom top/bottom gradient added. **First flash is an IMU
axis-calibration pass** — see the spec's "VERIFY ON HARDWARE" mapping block.
Actively annoying, and self-contained (firmware physics + color). Three parts:
1. **Color bug** — the 4 color selectors don't work / colors wrong. Root-cause
   first (suspect palette→CRGB mapping or an assumption fighting the RGB order;
   see PITFALLS). Get the 4 fixed selectors working correctly.
2. **Physics** — currently sloshes only to ~45° then stops. Should behave like a
   **closed container**: tip past 45° and the fluid spills onto the next edge in
   the rotation (gravity vector follows full 360° tilt, not clamped to one axis).
3. **Gradient mode** — top layer vs bottom layer different colors (uses **S2**
   palette pickers, clock-style) to show frothiness. Full per-page color
   selector can come later; for now the 4 presets + gradient.

### Phase 3 — Static-image apps (share the most) 🟠 in progress
- **Sketch app** 🟠 built — pending hardware test. `data/sketch.html`: 8×8 paint
  grid (mouse+touch), swatches, eraser, ledsim board preview, POSTs
  `/api/display/matrix`. Reuses bright.js + ledsim.js. Spec:
  `docs/superpowers/specs/2026-06-09-sketch-app-design.md`.
- **Emoji app** 🟠 built — pending hardware test. Added a **vibrance/saturation
  punch** (HSV) + a Vibrance slider to `emoji.html`: averaging to 8×8 desaturates
  colors into gray soup, so we push saturation (and lift dim cells) toward bold,
  fewer hues that read at 8×8 — exactly the "degrade quality so it shrinks
  better" the user asked for. Reuses the existing downscale + normalize pipeline.

### Phase 4 — Calendar app 🟠 built — pending hardware test
Spec: `docs/superpowers/specs/2026-06-09-calendar-app-design.md`. Firmware
`anim_calendar.ino` (4 styles: scroll / bignum / grid / clock) reusing the
clock's NTP + the font helpers; web `calendar.html` hub with style buttons +
**S2 palette** (its first consumer) + brightness widget; home Calendar card; MCP
`calendar` mode. Reuses clock NTP + S1/S2.

### Phase 5 — Sound/vibration visualizer 🟠 built — pending hardware test
Spec: `docs/superpowers/specs/2026-06-09-sound-visualizer-design.md`. Firmware
`anim_sound.ino`: VU bar driven by IMU vibration-energy (baseline-subtracted
magnitude → fast-attack/slow-release level + peak hold), gradient + S2 colors;
web `sound.html` (S2 palette + sensitivity + brightness); home Sound card; MCP
`sound` mode. Beat/energy visualizer only — not a spectrum EQ (see note below).

---

## Feature notes

### Sound visualizer — feasibility (you asked for input)
**Honest verdict: a beat/vibration-energy visualizer is plausible; a real
frequency-band equalizer is not, with this sensor.**
- Audio is 20 Hz–20 kHz. The accelerometer's usable sample rate here is the
  animation poll rate (~tens of Hz). Nyquist: polling at ~60 Hz lets you resolve
  vibration only up to ~30 Hz — nowhere near a music spectrum. **No FFT EQ.**
- It *can* feel **low-frequency structural vibration**: rest the board on/near a
  speaker or resonant surface and bass/kick will physically shake it. So a
  **"lights pulse/spread to the bass"** mode (track accel-magnitude variance over
  a short window → map to brightness/spread/color) is realistic and fun.
- If you ever want a true spectrum EQ, that needs a real mic — a ~$1 I2S MEMS mic
  (e.g. INMP441) wired to spare GPIO. That's a hardware add, not software.
- **Recommendation:** ship it as a *beat/energy* mode with honest framing; leave
  the door open for an I2S mic upgrade later.

### Per-app brightness
Every app page gets the **S1** widget. No firmware change — `/api/brightness`
already exists. This is the cheapest high-value win; do it in Phase 1.

---

## Parking lot (not yet sequenced)
- Full per-page color selector for liquid (beyond the 4 presets + gradient)
- I2S microphone hardware mod for true audio spectrum
