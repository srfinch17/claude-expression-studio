# LED Calibration Battery → Active Correction Pipeline — Design

**Date:** 2026-06-21
**Status:** Approved design, pending spec review → implementation plan (Phase 1)

## Context

The board renders 64 WS2812B pixels, but what a color you *send* actually *looks
like* on the panel diverges from theory — especially at low brightness, where many
channel values fall below the physical visibility floor. Today we have only a
partial, theoretical picture:

- `docs/LED_BRIGHTNESS.md` documents the FastLED model
  `effective(c, bri) = (c × (bri+1)) >> 8`, LED on when `effective ≥ 1`, and
  `minVisibleChannel(bri) = ceil(256/(bri+1))`. Its **"Empirical observations"
  table is empty** — waiting for real measurements.
- `data/grid_test.html` + `POST /api/grid-test/set` measure **red only** (a red
  ramp and a red brightness-sweep), assuming the formula's floor of 1 and treating
  all channels identically.
- Auto-memory has queued the gap: `color-threshold-calibration` (extend red →
  per-primary; the `frostbite` idle screen reading wrong at low brightness is the
  smoking gun for mismatched per-channel floors), `animation-defaults-pass`, and
  `led-brightness-formula` (the double-scaling trap for self-scaling animations).

**The need.** Run an *extensive* battery of human-eyes calibration tests **once**,
record the results as machine-readable data, and **actively consume that data** to
make every animation, expression, and image render as well as the panel allows.
Two goals, both explicit from the user:

1. **Never do this by hand again** — the measured truth is version-controlled.
2. **Use it to improve output** — the data drives an automatic correction layer, not
   just a reference table.

**Intended outcome.** A repeatable Calibration Lab that produces a single
`data/calibration.json`, plus a correction pipeline (firmware + web preview + MCP)
that applies it so content is "good by default."

## Decisions (from brainstorming)

1. **Active correction layer**, not a passive reference. The data is consumed
   automatically; measuring without applying was explicitly rejected.
2. **Full battery** — all four test bundles: per-channel floors; white balance +
   gamma; secondary/mixed color accuracy; per-pixel uniformity + distinguishable
   steps (the last bundle is the optional "nice to have," still in scope).
3. **Web app captures + computes.** The Lab UI captures eyeball observations in
   fields, does the math live, and writes `data/calibration.json` to the board;
   Claude reads it back and commits the repo copy.
4. **Global, always-on correction** in firmware (gated by a setting, default on, so
   we can A/B and fall back), **followed by a re-review pass** over existing
   hand-tuned content.
5. **One spec (this document) covering the whole pipeline; build the harness first.**
   Phase 1 (the Calibration Lab) is the first implementation plan/PR and is useful
   on its own. Running the tests, the correction layer, and the re-review are later
   plans.

## The contract: `data/calibration.json`

Single source of truth, modeled on `data/version.json` (read by firmware at boot,
served over HTTP, consumed by web + MCP). Shape:

```jsonc
{
  "version": 1,                 // schema version (bump if shape changes)
  "measured_at": "2026-06-21",  // date the battery was last run
  "board": "esp32-s3-matrix",

  // Per-channel ON floor, expressed as the minimum EFFECTIVE value (post-brightness
  // scaling, 0-255) at which that channel is perceptibly lit. Theory says 1 for all;
  // the battery measures whether green/blue/red actually differ.
  "floors": { "r": 1, "g": 2, "b": 1 },

  // Per-channel multiplicative gain to neutralize white. The dimmest channel is the
  // reference (gain 1.0); brighter channels are ATTENUATED (gain < 1.0) — we never
  // amplify past 255. Example: green dominates → green gain < 1.
  "white_balance": { "r": 1.0, "g": 0.70, "b": 0.85 },

  // Perceptual exponent for ramps/fades so gradient steps look evenly spaced.
  "gamma": 2.1,

  // Named colors verified to read as the intended hue, including at low brightness.
  // Becomes the safe palette for expressions/animations/idle screens.
  "palette": { "amber": "#ffb000", "cyan": "#00d0ff", "magenta": "#ff14a0",
               "orange": "#ff6a14", "white": "#ffffff" },

  // Number of brightness levels the eye can actually distinguish on this panel.
  "steps": 24,

  // OPTIONAL per-pixel trim (64 gains, row-major) for LED binning outliers; omitted
  // entirely if uniformity is good enough not to bother.
  "pixel_trim": null
}
```

**Sync rule (critical).** The board writes this file to LittleFS at runtime, but a
later **LittleFS Data Upload** from the repo overwrites *all* web files. So after a
calibration run, Claude **`GET /api/calibration`** and commits the **exact bytes**
to the repo `data/calibration.json`, keeping board and repo copies identical. The
repo copy is also what ships to other installs.

**Defaults / absence.** If `calibration.json` is missing or unparseable, firmware
falls back to identity correction (floors = 1, gains = 1.0, gamma = 1.0, no trim) —
i.e. current behavior. The feature must degrade to "do nothing," never break the
panel.

## Phase 1 — the Calibration Lab (build & ship first)

Evolve `data/grid_test.html` into **`data/calibrate.html`** — a wizard with one
section per test. Each section provides: a **"show pattern on board"** button, the
**eyeball protocol** on screen, **input field(s)** for the observation, and a
**live-computed derived value**. The existing red ramp / brightness-sweep become the
red case of the per-channel-floors section (no capability lost; `grid_test.html`
either redirects to the Lab or is retired — decide in the plan).

### Tests and what each yields

- **Per-channel floors (R, G, B, + combos).** Two patterns per channel: a *ramp*
  (channel increasing across the 64 cells) to find the first lit cell, and a
  *brightness sweep* (full channel, dim down) to find the cutoff level. From the
  reported cutoff, compute the **effective-value floor** for that channel. The
  current red logic is the template.
- **White balance.** Show R, G, B patches at equal effective value side by side;
  user reports relative brightness (e.g. "green brightest, then blue, then red") or
  tunes each patch until they match. Solve per-channel **gains** (dimmest = 1.0).
- **Gamma.** Show a single-channel ramp of N evenly-spaced *values*; user adjusts an
  exponent slider until the *perceived* steps look evenly spaced. Record the
  **exponent**.
- **Secondary / mixed colors.** Show amber, cyan, magenta, orange, white at high and
  low brightness; user confirms each reads as the intended hue or nudges the hex.
  Record the **verified palette**.
- **Per-pixel + steps (optional).** Single-pixel addressing to walk the 64 and flag
  brighter/hue-shifted outliers → optional `pixel_trim`. A level-discrimination
  pattern to count **distinguishable steps**.

### Firmware additions (Phase 1)

- Extend the `/api/grid-test/set` family (or a sibling `POST /api/calibrate/pattern`)
  to render the new patterns: per-channel ramps and sweeps (G, B, combos), equal-
  effective-value patches for white balance, gamma ramps, and single-pixel
  addressing. Static render, no animation loop, same as the current grid test.
- **`POST /api/calibration`** — write the supplied JSON body to LittleFS as
  `calibration.json` (best-effort; report ok/err).
- **`GET /api/calibration`** — return the current `calibration.json` (or the
  identity default if absent).
- Reuse the existing **`resumeBri` separation** so calibration brightness (often
  255) never persists to NVS as the boot value (browns out USB — see PITFALLS).

### Capture/compute (Phase 1, JS in `calibrate.html`)

Per test, gather observations into fields, compute derived values live (the page
already has the FastLED math via `ledsim.js`), assemble the full `calibration.json`
object, and `POST /api/calibration` to save. Show the assembled JSON for sanity.

### Phase 1 verification (stands alone)

- Each test renders the correct pattern on the board (user confirms).
- Entering observations produces sane derived values (spot-check the math).
- Saving writes a valid `calibration.json`; `GET /api/calibration` returns it;
  Claude commits the repo copy and the two are byte-identical.
- No NVS/boot-brightness regression (board still boots at its normal brightness).

## Later phases (specified here, separate plans)

### Phase 2 — run the battery
A paced, eyes-on session at the board (the user's preferred watch-it-demo style):
walk every Lab test, capture observations, save `calibration.json`, commit. Also
fold in the batched hardware-eye tests memory already queued alongside this
(`frostbite` at bri 5, expression color tuning, remaining animated-expression
silhouette checks) since the user is already at the board.

### Phase 3 — the correction layer (consumes `calibration.json`)
- **Firmware:** load `calibration.json` at boot into a struct (identity fallback on
  absence). Add a final **`applyCalibration(leds)`** stage immediately before each
  `FastLED.show()` (or a single chokepoint show wrapper) doing, in order:
  **floor-lift → white-balance → gamma**. Gate on a new NVS setting
  **`calibration_correction`** (bool, default `true`), so it can be toggled for A/B
  and fallback. Add the key to the settings table + `data/settings.html` + the MCP
  settings tools.
- **Web preview:** add the same correction to `ledsim.js` so previews match the
  corrected board (fetch `calibration.json` over HTTP, like other data files).
  Respect the existing rule that animation previews render at full brightness — the
  correction is about color fidelity, applied where `LedSim` is already used.
- **MCP:** read `calibration.json` (from the board or repo) so palette-aware tools
  (expressions, idle params) prefer verified-safe colors.

**Mind the double-scaling trap** (`led-brightness-formula` memory): self-scaling
animations already apply `nscale8` before FastLED's global scale. The correction
layer is a *third* stage — verify it composes correctly (a corrected, self-scaled,
globally-scaled pixel must still clear its floor). Confirm on hardware at bri 5.

### Phase 4 — re-review pass across the ENTIRE board-app suite
With correction on, walk **every app the board renders** — not just animations.
Because the correction layer is global + always-on, it changes the look of
*everything*, so the review scope is the full suite: the `anim_*` animations
(`KNOWN_ANIMS` in `api_handlers.ino` + cards in `data/animations.html`), the
expressions (`expressions.ts` + saved `expressions/*.json`, including the `wait-*`,
`ask-*`, idle, and Claude-mascot sets), presence rendering (`anim_presence.ino`),
the clock/calendar/weather/sound/sketch/emoji apps, the idle screensaver lineup, and
the grid/calibration patterns themselves. Confirm each still reads well; re-tune any
that regressed; delete now-redundant hand-tuned floors the correction layer subsumes
(e.g. claudesweep's manual amber floor). Apply the lessons learned (the verified
palette, per-channel floors, gamma) as the new defaults everywhere.

**This completes the project and marks v1.0.0** — see the milestone note below.

## Milestone: this is v1.0.0

Per the user (2026-06-21): finishing this calibration end-to-end — measured,
lessons learned, and the correction implemented/re-reviewed across the **entire
suite of board apps** — is the intended **v1.0.0** stopping point. It is the natural
"the board looks as good as the hardware allows, everywhere" line to reach **before**
the next thrust (building out the broader docs/specs and the RAG corpus this repo
will feed). So: Phases 1-4 of this spec, fully shipped and hardware-verified, →
`npm run bump:major` to 1.0.0.

## Files touched (by phase)

- **Phase 1:** `data/calibrate.html` (new, evolves `grid_test.html`);
  `data/calibration.json` (new, committed after first run); `api_handlers.ino`
  (pattern rendering + `POST`/`GET /api/calibration`); route registration in
  `esp32_matrix_webserver.ino`; `data/system.html` (Lab card); `docs/LED_BRIGHTNESS.md`
  (point the empirical section at `calibration.json`).
- **Phase 3:** `esp32_matrix_webserver.ino` (boot load + show-time
  `applyCalibration`), settings plumbing (`api_handlers.ino`, `data/settings.html`,
  MCP settings tools); `data/ledsim.js`; MCP palette consumers.
- **Phase 4:** the `anim_*.ino` set + `mcp_server/expressions.ts` as needed.

## Risks / non-goals

- **Risk: correction changes hand-tuned content.** Mitigated by the default-on
  toggle (instant fallback) + the Phase 4 re-review.
- **Risk: runtime LittleFS write.** Small file, best-effort, identity fallback on
  failure; never blocks rendering.
- **Non-goal:** correcting per-pixel by default. `pixel_trim` is optional and
  omitted unless uniformity is visibly bad.
- **Non-goal:** changing the brightness *model* — we still use FastLED's
  `(c×(bri+1))>>8`; the battery measures reality on top of it and the correction
  layer adjusts the values we feed in.
