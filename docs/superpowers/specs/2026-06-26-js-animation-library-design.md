# Complete the JS Animation Library — Design

**Date:** 2026-06-26
**Branch:** `feat/expression-studio`
**Status:** Approved (brainstorming → spec)

## Context & motivation

This project has crystallized from "an ESP32 matrix coding thing" into a **renderer-agnostic
Claude presence & expression studio** (a primary portfolio piece). The board is now *one
optional renderer*; the web surfaces (board.html, the Studio Gallery, the site) are where most
people will actually see the animations. See the north-star: the long game is one semantic
expression library rendering on any display.

The **real asset** is a portable JS animation library. Today, 7 of the board's decorative C++
animations have JS ports in `shared/firmware-sims.js` (claudesweep, frostbite, fire, matrix_rain,
snow, fireworks, dancefloor). The remaining decorative animations live *only* in C++ on the board,
so the web surfaces can't show them — and when the board *is* mirrored, fast C++ animations look
choppy through the framebuffer poll. Completing the library removes both limits: every animation
renders natively in JS, smoothly, on every surface, with no board required.

This is **sub-project 1** of a larger sequence (library → board.html local-first showcase →
studio/presence maturity → repo cut). It is intentionally self-contained: it ports animations and
makes the registry auto-extensible. It does **not** touch board.html, manifest intent bindings, or
the repo structure — those are later sub-projects.

## Scope

**In scope — port these 8 decorative animations** (the C++ `anim_<name>.ino` files that have no JS
port yet):

`comet`, `liquid`, `rainbow`, `spiral`, `starfield`, `sun`, `wave`, `breathe`.

**Out of scope:**
- Data / utility / text displays: `clock`, `weather`, `calendar`, `presence`, `timer_*`, `solid`,
  `sound`, `imu`, `chiptemp`. These are functional readouts, not showcase animations.
- board.html consuming the new sims / going local-first (sub-project 2).
- Binding the new firmware names to manifest intents (the names already exist in
  `shared/firmware-names.js`; *binding* them is later/optional).
- The repo split.

## Fidelity approach (decision C)

Each sim is a **faithful port of the C++ animation logic** — same motion, same color intent —
emitting per-cell RGB. The **bloom Panel renderer** (`shared/render.js`) supplies the web beauty
(glow, bleed) uniformly. Consequences:

- One codebase; the animation's *identity* is consistent on every surface.
- The web version looks richer than a bare board *for free*, because the renderer adds the bloom —
  the sim itself does not diverge or fork.
- The hi-res "chunky-8×8" aesthetic stays a pure renderer concern (cell size + glow), untouched here.

The C++ `anim_<name>.ino` source is the **reference** for each port: read it, match its algorithm,
motion, palette, and timing. Where the C++ relies on FastLED helpers (`scale8`, `nscale8`,
`fill_rainbow`, `CHSV`, `random8`, etc.), reuse the JS equivalents already in `firmware-sims.js` or
add a minimal helper alongside them.

## The sim contract (matches the existing 7)

Every sim is a factory:

```js
function make<Name>(opts = {}) {
  // ...closure-captured state...
  return {
    frame_ms: opts.frame_ms || <default>,
    frame() {
      const px = [];
      // ...advance state, push lit pixels...
      px.push({ x, y, r, g, b });   // x,y in 0..7 ; r,g,b in 0..255
      return px;                    // the next frame's lit pixels
    },
  };
}
```

Then registered in the `FIRMWARE_SIMS` map at the bottom of the file:

```js
export const FIRMWARE_SIMS = {
  claudesweep: makeClaudeSweep,
  // ...existing 7...
  comet: makeComet,
  liquid: makeLiquid,
  rainbow: makeRainbow,
  spiral: makeSpiral,
  starfield: makeStarfield,
  sun: makeSun,
  wave: makeWave,
  breathe: makeBreathe,
};
```

`opts` carries optional overrides (`frame_ms`, palette/color, intensity, etc.) mirroring the C++
parameters where they exist; defaults must produce a good-looking animation with no opts (the
Gallery and board.html call them with none).

**Shared helpers** already present in `firmware-sims.js` and reusable: `hexToRGB`, `scale8`,
`nscale8`, plus the per-sim palette tables. Add new helpers next to these only when a port needs
one not already available (e.g. an HSV→RGB if `rainbow`/`sun` need hue math).

## Extensibility — the registry becomes the single source

Two facts make new sims nearly free to add:

1. All 8 target names are **already in `shared/firmware-names.js`** (verified), so the manifest, the
   resolver, and the Python hook already classify them as firmware names. No name-registry changes,
   no Python-mirror edits.

2. **The one fix that delivers auto-extension:** `scripts/build-gallery-data.mjs` line 6 currently
   hardcodes the Gallery's firmware list:

   ```js
   const FIRMWARE = ["claudesweep","frostbite","fire","matrix_rain","snow","fireworks","dancefloor"];
   ```

   Change it to derive from the registry:

   ```js
   import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
   const FIRMWARE = Object.keys(FIRMWARE_SIMS);
   ```

   After this, **registering a sim in `FIRMWARE_SIMS` is the only step** needed for it to appear in
   the Gallery (and any future surface that enumerates the registry). That is the "add one
   animation, it shows up everywhere" promise, made real.

   (Order in the generated `gallery-data.json` will follow `FIRMWARE_SIMS` insertion order; that is
   acceptable — the Gallery groups by role, not by this array's order.)

## Testing

Each new sim gets unit tests in `shared/firmware-sims.test.js`, mirroring the existing pattern
(`assertInBounds` + stepping a full cycle):

- **In-bounds:** every pixel `x,y ∈ [0,8)`, `r,g,b ∈ [0,255]`, across a full animation cycle
  (step ~60 frames).
- **Sane shape:** `frame_ms` is a number; `frame()` never throws across the cycle.
- **Not dead:** not all-black after warm-up (at least some lit pixels once the animation is running).
- **Per-sim signature** (one assertion that would fail if the port were wrong), e.g.:
  - `comet`: a single bright head pixel exists, and its position changes between frames.
  - `rainbow`: hue advances — a sampled pixel's color differs across frames.
  - `starfield`: pixel count grows/varies as stars spawn (not a constant fill).
  - `wave`/`liquid`/`spiral`/`sun`/`breathe`: lit-pixel set changes frame-to-frame (it animates).

A registry-coverage test asserts every key in `FIRMWARE_SIMS` produces a valid stepping sim, so a
future addition can't silently ship untested.

## Visual review loop

Build/critique uses the proven animator-subagent + main-agent-critic loop, board-free. Because
these sims are **generative** (stateful, RNG-driven) rather than static frames-JSON, the existing
`scripts/render-contact-sheet.py` (frames-JSON → PNG) does not fit. Add:

**`scripts/render-sim-sheet.mjs`** — imports a sim factory from `shared/firmware-sims.js`, steps it
N frames (default ~12, at the sim's `frame_ms`), and renders a labeled contact-sheet PNG (an 8×8
cell grid per frame, optionally with a light glow to approximate the Panel). Usage:
`node scripts/render-sim-sheet.mjs <name> [frames]`. This is the artifact the animator produces and
the critic reads — reusable for the new 8 and the existing 7.

The **live Studio Gallery** (which renders the sims through the real bloom Panel, and after the
line-6 fix shows the new ones automatically) is the final human eyeball before the user signs off.

## Build, files, and integration

- **Modify:** `shared/firmware-sims.js` (8 new `make*` factories + register in `FIRMWARE_SIMS`).
- **Modify:** `shared/firmware-sims.test.js` (tests for the 8 + the registry-coverage test).
- **Modify:** `scripts/build-gallery-data.mjs` (line 6 → derive `FIRMWARE` from the registry).
- **Create:** `scripts/render-sim-sheet.mjs` (generative-sim contact sheet).
- **Regenerate:** `studio/gallery-data.json` via `npm run build:gallery` (generated artifact —
  never hand-edited).
- **Reference (read-only) — verified C++ source per animation:**
  | animation | C++ file |
  |---|---|
  | `comet` | `esp32_matrix_webserver/anim_comet.ino` |
  | `liquid` | `esp32_matrix_webserver/anim_liquid.ino` |
  | `rainbow` | `esp32_matrix_webserver/anim_effects.ino` |
  | `wave` | `esp32_matrix_webserver/anim_effects.ino` |
  | `breathe` | `esp32_matrix_webserver/anim_effects.ino` |
  | `spiral` | `esp32_matrix_webserver/anim_gradient.ino` |
  | `starfield` | `esp32_matrix_webserver/anim_gradient.ino` |
  | `sun` | `esp32_matrix_webserver/anim_gradient.ino` |

  (Each also has its dispatch branch in `esp32_matrix_webserver.ino` showing the params it reads.)

No changes to: the firmware, the MCP server, the manifest, `shared/firmware-names.js`, the Python
hook, board.html.

## Sequencing

One sim per task (port + unit tests + sim-sheet render), independent of each other, batched in
waves via the animator loop. Suggested order — simplest math-driven first, building confidence in
the contact-sheet workflow, then the particle/physics ones:

1. `rainbow`, `breathe`, `wave` (deterministic gradient/oscillation math)
2. `sun`, `spiral` (radial/rotational)
3. `comet`, `starfield`, `liquid` (particles / noise)

The `build-gallery-data.mjs` line-6 fix lands as its own small first task (so subsequent sims
auto-appear in the Gallery as they're built).

## Success criteria

- All 8 sims registered in `FIRMWARE_SIMS`, each a faithful port emitting in-bounds per-cell RGB.
- `shared/firmware-sims.test.js` green for all 15 sims + the registry-coverage test; full suite green.
- `npm run build:gallery` lists 15 firmware sims; the Studio Gallery renders all 15 live.
- Each new sim approved by the user via the render/critique loop (and added to the Gallery's
  `APPROVED` set if/when it earns the green ✓ — though firmware sims are not currently in that set;
  the set governs *saved expressions*, so this is optional and noted, not required).
- No regression to the existing 7, the firmware, the manifest, or board.html.
