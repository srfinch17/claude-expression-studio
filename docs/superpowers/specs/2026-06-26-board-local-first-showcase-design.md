# board.html — Local-First Showcase (Design)

**Date:** 2026-06-26
**Branch:** `feat/expression-studio` (no merge — the repo cut is the final step of the whole arc)
**Status:** Design approved; ready to plan.
**Sub-project:** Step 2 of the studio pivot (see memory `display-emote-northstar`).
Supersedes the mirror-first `board.html` shipped in Plan 4.1.

---

## 1. Why

`studio/board.html` today is **mirror-first**: it polls the physical board's
`GET /api/framebuffer` every 333 ms and only falls back to the SSE `/events`
stream when the board is unreachable (`board.js` `mirrorGate(boardOnline)` returns
`!boardOnline` — SSE draws only when offline).

But this project is a **renderer-agnostic Claude presence & expression studio**, and
the board is one optional renderer. **Most portfolio visitors have no board and no
live Claude session.** For them the mirror-first page has two problems:

1. A 333 ms poll of a fast C++ firmware animation looks **choppy** (the poll ceiling,
   not the animation, sets the frame rate).
2. With no board present, the page only ever shows the SSE fallback — there's nothing
   beautiful happening by default.

This is **where most people will see the animations**, so it must be smooth and
beautiful *disconnected*. The fix is to **invert the priority**: render the animation
library **natively in JS as the primary path** (smooth, no board, no poll ceiling),
and make the live framebuffer mirror the **special case** that engages only when a
real board is actually connected. Rendering natively dissolves the choppy-fire
problem entirely — the procedural sims run at full rAF rate.

## 2. Identity — the three-surface triad

`board.html` must not become a third overlapping "browse everything" surface. The
three web surfaces have distinct jobs:

| Surface | Role | Form | Audience |
|---|---|---|---|
| `site/index.html` | **The pitch** — narrative scroll ("Give Claude a face"), body-language beats, a small "Poke it" playground, install steps | Marketing story page | First-time visitor |
| `studio/index.html` (Gallery) | **The catalog** — *every* expression + sim at once in tiny 128 px tiles, grouped by rotation role, orphan/approved rings | Dense admin grid | Maintainer wiring/tuning |
| `studio/board.html` | **The face / stage** — ONE big panel; the renderer most people actually *watch*; the board-less "desktop window where Claude emotes," made shareable | Single hero panel | Anyone — and the live target when Claude drives it |

`board.html`'s distinct job: be **the single, full-size, beautiful "Claude's face"
renderer.** Not a grid, not a marketing scroll.

## 3. The state machine (the core)

One `Panel` (`shared/render.js`), three possible sources, strict precedence
**MIRROR > LIVE > AMBIENT**, with a pinned visitor-driven side-state:

| State | Activates when | Drives the panel | Decays? | Status |
|---|---|---|---|---|
| **MIRROR** | last `/api/framebuffer` poll succeeded (board reachable) | `setFrames([framesFromPx(px)], …)` refreshed each poll | **No** — the board is the truth | `● live · board` |
| **LIVE** | an SSE `/events` intent arrived within the last **~25 s** and not MIRROR | `applyEvent(event)` — frame-expression via `setFrames`, firmware via `webSim.render` | **Yes** → AMBIENT after ~25 s of SSE silence | `● live` |
| **PIN** | visitor clicked a library item (and not LIVE/MIRROR) | holds that one anim; auto-advance paused | pre-empted instantly by LIVE/MIRROR | `◉ pinned · <name>` |
| **AMBIENT** | nothing above is driving | ambient scheduler cycles the showcase list | n/a (resting floor) | `○ ambient · <name>` |

**Precedence rationale:** a physical board, when present, is ground truth and never
decays. A live Claude session (no board) latches the face the instant an intent
fires, holds it while the session is warm, then gently drifts back to ambient so a
passive visitor is never trapped on a stale glyph. Ambient is the resting floor.

**Hand-back (decay):** each SSE event stamps `lastSseAt = now`. The arbiter treats
LIVE as active while `now - lastSseAt < DECAY_MS` (~25 000). When it lapses (and no
board mirror), the panel returns to **auto-cycle** — it does **not** restore a prior
pin (simpler; a visitor who wanted that anim can re-pin).

**Pin pre-emption:** an SSE or framebuffer event always wins over a pin. After LIVE
decays, auto-cycle resumes (pin is not restored).

### Pure arbiter

A pure function generalizes today's `mirrorGate`:

```
arbitrate({ mirrorOk, lastSseAt, now, pinned }) -> 'mirror' | 'live' | 'pin' | 'ambient'
  if (mirrorOk) return 'mirror';
  if (lastSseAt != null && now - lastSseAt < DECAY_MS) return 'live';
  if (pinned)  return 'pin';
  return 'ambient';
```

The browser glue (rAF loop, framebuffer poll loop, `EventSource`, click handlers)
stays thin and calls `arbitrate` to decide what to feed the `Panel` — matching
`board.js`'s existing pure-core / `node --test`-guarded-glue split.

## 4. Ambient playlist

The ambient cycle plays a **curated showcase list** — the kinetic-art pieces:
the 15 firmware sims + the scenic saved anims (galaxy, aurora, black-hole, jellyfish,
lava-lamp, and the orphan decorative library). **Communicative glyphs**
(done / alert / smiley / cross / the wait spinners / ask-*) are **excluded from
ambient** — they only appear when Claude actually drives the face — but remain
reachable via click-to-pin. Clean semantic: **ambient = beauty, live = meaning.**

**Why a curated list, not a derivation:** `gallery-data.json`'s `group` field does
not cleanly separate scenic from glyph — the `wired` group holds showpieces
(galaxy, aurora, black-hole, swarm-merge) *and* glyphs (smiley, done, cross, party,
confetti). "Scenic" is a taste judgment. So the showcase list is an explicit,
hand-curated array of names in a small committed file **`studio/showcase.js`**,
seeded from firmware + scenic saved anims and trivially tunable by the user (the
final taste gate). This also avoids any change to the `gallery-data.json` generator,
so no regeneration/commit coupling.

**Two render paths** (both already proven in `studio/gallery.js`):
- **Firmware sim:** `FIRMWARE_SIMS[name](opts)` → `panel.setStepper(() => sim.frame(), sim.frame_ms)` (continuous, procedural).
- **Frame-expression** (saved/canned): `resolveExpression(entry)` → `panel.setFrames(frames, frame_ms)` (looping).

`board.html` swaps which it feeds the single `Panel`. Firmware default params
(`FW_DEFAULTS` in gallery.js, currently only the original 7 sims; the other 8 fall
back to `{}`) are duplicated minimally in board.html or `{}`-defaulted — a shared
`firmware-defaults` module is an optional nice-to-have, not required.

**Scheduling:** each showcase item shows for ~6–8 s, then advances; order is shuffled
with no immediate repeat (a small pure advance/shuffle helper).

**Data sources:** firmware sim names from `FIRMWARE_SIMS` (JS) and/or
`gallery-data.json` `data.firmware[]`; saved/canned frame data from
`gallery-data.json` `data.expressions[]` (each entry carries `frames`, `colors`,
`frame_ms`, `loop`, `group`, `approved`). `board.html` already has read-access to
`./gallery-data.json` via the engine static server (and via repo-root
`python -m http.server`).

## 5. Interaction & status

- **Click-to-pin strip:** a thin row of library items (dots/names) below the panel.
  Clicking pins that anim (auto-advance paused). The **whole library** is reachable
  here — including the communicative glyphs excluded from ambient. A "↻ resume"
  affordance releases the pin back to auto-cycle.
- **Status pill:** honest 3/4-way readout — `○ ambient · <name>`, `● live`,
  `● live · board`, `◉ pinned · <name>`.
- **`prefers-reduced-motion`:** holds a single static frame; no cycling
  (matches `gallery.js` and `site/index.html`).

## 6. Hi-res chunky scaling

Mostly free in `Panel`: `cell = canvas.width / 8`, and the bloom (halo + hot core)
scales to `cell`. Use a generous hero canvas (internal ~720², displayed
`min(82vmin, 720px)`). 8×8 *logic*, big soft pixels — the deliberate chunky-retro
aesthetic, no new render code.

## 7. Architecture, files, tests

**Reused unchanged:**
- `shared/render.js` `Panel` (setFrames / setStepper / tick / draw / `--glow` bleed).
- `shared/firmware-sims.js` `FIRMWARE_SIMS`; `shared/expressions.js` `resolveExpression`.
- `studio/board.js` decoders `framesFromPx` / `framesFromWire` / `applyEvent`.
- `shared/renderers/web-sim.js` `makeWebSimRenderer` (for SSE animation events).
- Engine routes (`engine-server.ts`): `GET /api/framebuffer` proxy + `/events` SSE —
  **untouched**; it already serves the `studio/` + `shared/` tree and both data routes.

**New pure logic (unit-tested under `node --test`, no DOM):**
- `arbitrate({ mirrorOk, lastSseAt, now, pinned })` → active source.
- `buildAmbientPlaylist(galleryData, firmwareKeys, showcaseNames)` → ordered ambient
  list (scenic only) + the full pin list (everything).
- a pure advance/shuffle helper (no-immediate-repeat).
These live alongside the existing pures in `studio/board.js` (or a sibling module
imported by it), keeping the test-safe import guard pattern.

**New thin glue (in `board.html`, not unit-tested — like today's poll loop):**
- ambient scheduler (timer → advance → feed `Panel`),
- click-to-pin handlers and status-pill updates,
- the rAF + framebuffer-poll + `EventSource` wiring, all calling `arbitrate`.

**New data:** `studio/showcase.js` — hand-curated scenic name array.

**Files touched:**
- rewrite `studio/board.html` (layout: hero panel + pin strip + status; wiring),
- extend `studio/board.js` (arbiter + playlist + advance pures; keep existing exports),
- add `studio/showcase.js`,
- add/extend `studio/board.test.*` (or the existing board test) for the new pures.

**Verification:** `npm test` stays green (full suite). Visual checks via the running
local server (Playwright / Chrome) in the subagent-visual-loop; the user is the final
taste gate (`feedback-subagent-visual-loop`).

## 8. Scope

**In scope:** invert `board.html` to local-first per the state machine above; ambient
showcase; click-to-pin; hi-res hero panel; keep the mirror + SSE as the live special
cases.

**Out of scope (later plans / unchanged):** the Studio **editor** (old Plan 6), the
Pages showcase (old Plan 5), any `shared/manifest.json` changes, firmware changes, the
repo cut. **No merge** — stays on `feat/expression-studio`.

**Build discipline:** no `gallery-data.json` generator input changes → no regen
needed. If any later step *does* touch a generator input, regenerate
(`npm run build:gallery`) and `git add` the artifact in the same commit.

## 9. Open decisions (made; flag to flip)

1. **Showcase list home:** committed hand-curated `studio/showcase.js` (chosen) vs.
   auto-derived from `group`. Chosen for honesty + user tuning.
2. **Post-decay behavior:** return to auto-cycle (chosen) vs. restore a prior pin.
   Chosen for simplicity.
3. **Status wording:** the 3/4-way pill above.
4. **Decay window:** ~25 s of SSE silence before LIVE → AMBIENT (tunable constant).
5. **Ambient dwell:** ~6–8 s per item (tunable constant).
