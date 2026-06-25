# Animation Roster — Baseline (Phase A working doc)

Living record of the animation library as we shore it up. Each entry: final state +
the bucket (event) it belongs to. Becomes the spec for Phase B (assignment) and the
data model for Phase C (Studio).

Tiers: **T1** firmware (`anim_*.ino`, reflash) · **T2** canned glyph
(`mcp_server/expressions.ts`, tsc rebuild + reconnect) · **T3** saved JSON
(`mcp_server/expressions/*.json`, live, zero rebuild).

Buckets (events): **wait** (busy spinner, weighted) · **ask** (blocked on user) ·
**done** (turn end) · **bored/idle** (screensaver + whim) · **express** (Claude's
emote whims) · **orphan** (unwired).

## Changes this session

| Animation | Tier | Bucket | Change | Status |
|---|---|---|---|---|
| ask-question | T3 | ask | Fixed the "1→2→back to 1" backtrack at the **source generator** (`gen-ask-icons.py`: `N=12` → `N=len(Q_STROKE)`; it was regenerating the bug). Regenerated → clean 10-frame single sweep, generator-consistent (no drift). Also now serves **ask-confirm** (see below). (End-of-cycle white flash tried + reverted.) | ✅ done |
| task-complete (was ask-confirm) | T3 | orphan (unwired) | Promoted at the source (generator spec `ask-confirm`→`task-complete`, function + description updated), regenerated as `task-complete.json`, deleted stale `ask-confirm.json`. It's the box+green-check animation the user loves, now a standalone **Task Complete** glyph. **Unwired** by choice ("keep both, separate") — shows in studio orphans until assigned an event. | ✅ done |
| ExitPlanMode hook | host | ask | Repointed `ask-confirm` → `ask-question` in live `~/.claude/settings.json` + source `claude-hooks/settings.hooks.snippet.json` (+ mapping comment). The `?` now doubles for question **and** plan-approval/confirm. ⚠️ Takes effect on next Claude Code restart (hooks load at session start). | ✅ done |

## Working mode: Phase A/B COMBINED

Per the user, execute fix + category/wiring change together (one decision, fully
wired) rather than logging assignments for a later Phase B pass. Wiring lives across
the live hook map (`~/.claude/settings.json`), the source snippet, `matrix_signal.py`,
filename/prefix conventions, and `wait-weights.json` — touch the relevant ones in lockstep.

### Resolved (combined execution)
1. ✅ **Checkbox → "Task Complete" (`task-complete.json`), kept SEPARATE.** Left the
   existing turn-end `done` glyph untouched; the checkbox is a standalone completion
   glyph, currently **unwired** (studio orphan) until assigned an event.
2. ✅ **`?` covers both ask roles.** `ExitPlanMode` → `ask-question` (question +
   plan-approval both show the `?`).

### Still open (taxonomy — revisit when it next matters)
- The studio classifier (`shared/catalog.js`) only knows wait / ask / bored / orphan.
  A **done / Task Complete** role (to home `task-complete` + the canned `done`) and an
  **express** role (the canned emotes) should be designed holistically — likely the
  start of Phase C's data model rather than a one-off bolt-on. `task-complete` correctly
  reads as an orphan until then.

| alert | T2 | canned (express) | Redesigned: the old photo-negative blink inverted to lit negative-space and read as an **H**. Now a single orange `!` that **glows** low→high→low (6 baked brightness steps on band centers, A=floor still-lit … F=peak), **never inverts, never off**, `loop:0`. Shape shrunk to rows 1–6 so the `!` is **bordered** top & bottom (no longer runs off the edges). Updated in `expressions.ts` + both `matrix_signal.py` copies (source + `~/.claude/hooks/`). ⚠️ T2: live on the board/MCP only after a `/mcp` reconnect (studio already shows it). | ✅ done |

| question (canned) | T2 | RETIRED | Removed from `CANNED` + the tool-desc list. The animated `ask-question` supersedes it. presence `question` intent now falls back to `smiley` until rehomed. | ✅ done |
| check (canned) | T2 | RETIRED | Plain green checkmark removed from `CANNED` + tool-desc list. Redundant with the `task-complete` checkbox. presence `ok` intent remapped `check`→`ok` (the OK-text glyph). | ✅ done |
| done (canned) | T2 | RETIRED (from library) | Photo-negative blinking checkmark removed from `CANNED` + tool-desc list (read as redundant). presence `done` intent falls back to `smiley` until rehomed. ⚠️ **The Stop/turn-end hook still plays its own `matrix_signal.py` copy of `done`** (which also arms the idle watcher) — left functional on purpose; turn-end needs a new home (likely `task-complete`). **Open for the post-batch talk.** | ⚠️ partial |
| cross | T2 | canned (express) | Redesigned to match `alert`: a smaller red **X inside a red border**, glowing low→high→low (6 baked red steps, A=floor still-lit … F=peak), never inverts/off, `loop:0`. `expressions.ts` only (no `matrix_signal.py` copy exists for cross). | ✅ done |
| _tests_ | — | — | Updated `presence.test.ts` (cannedFor fallbacks) + `build-gallery-data.test.js` (orphan set now includes `task-complete`; on-demand sample → `sparkle`). 66/66 green. | ✅ done |

## Open items for the post-batch talk
- **Turn-end home.** `done` is retired as an icon, but the Stop hook still fires the old
  photo-negative `done` (and arms idle). Decide its replacement — `task-complete` is the
  obvious candidate. Repointing = edit `matrix_signal.py` (both copies) so `done` plays the
  saved `task-complete`, OR change the Stop signal. Idle-arming must stay intact.
- **Presence fallbacks.** `done`/`question` intents fall back to `smiley`. If you want them
  to render the new animated glyphs, presence needs to map intents to SAVED expressions
  (currently CANNED-only) — a small extension, worth doing when we wire homes.

| heart | T2 (+ bored copy) | bored (express) | Replaced the static heart with the **beating** version from `site/index.html` (2 frames: expand → contract/dip, `frame_ms:520`, ~1s lub-dub). Updated canned `expressions.ts` (the gallery's data source) + `bored_animations/heart.json` for parity. | ✅ done |
| claude-idle ("corner guy") | T3 | orphan | **Investigated, no extraction needed.** The studio's desk-companion ("little guy in the corner") is fed `claude-idle` — already a saved expression + already in the gallery (orphan group). Its bob-sibling = `wait-claude` (already in wait group). Both mascot animations are already real/listed; `claude-idle` only *looks* separate because it's unwired (orphan). Becoming "a normal listed entry like the rest" = giving it a home → deferred wiring pass. | ✅ already done |

## v1 NEW animation library — build log

Built via the `building-8x8-animations` skill (animator subagent → contact-sheet render →
main-agent critic gate). Saved frame-expressions in `mcp_server/expressions/`. Unwired (the
event assignment is the later reset pass). Order: easy → hard, learning between waves.

| # | Animation | Wave | Status |
|---|---|---|---|
| 1 | goldfish (+bubbles) | pilot | ✅ v3 — orange body, swishing gold forked tail, dark eye, cyan bubbles |
| 2 | reticle (PreToolUse lock-on) | 1 | ✅ green brackets snap in → cyan/white lock pulse → loop |
| 3 | stamp (PostToolUse) | 2 | ✅ B+ (polish candidate) — drop → impact-flash → green check |
| 4 | hourglass | 2 | ✅ A — cyan glass / amber sand / gold neck-stream, drains + flips |
| 5 | lightning | 3 | ✅ B+ (polish flag: cloud reads star-ish) — jagged bolt + white flash |
| 6 | bloom | 3 | ✅ A — gold bud unfurls 4 magenta petals (X, gapped), holds, closes |
| 7 | crystal-ball | 3 | ✅ A− — violet orb w/ highlight+shadow (round), teal mist swirls, stand cropped |
| 8 | skull (purple eyes) | 4 | ✅ A — bone skull, sockets/nose/teeth, purple eyes pulse |
| 9 | lighthouse beam | 4 | ✅ A− — tower+red band, amber beam sweeps + white-hot toward viewer |
| 10 | sunrise | 4 | ✅ B (polish flag: rise scales up oddly) — settled corner sun + twinkling rays good |
| 11 | soundwave (rainbow EQ) | 4 | ✅ A− — full-rainbow bars roll like music |
| 12 | warp-portal | 5 | ✅ B+ — cyan/magenta/yellow rings bloom out → center ready-glow |
| 13 | dusk | 5 | ✅ A — banded violet→magenta→orange sky, white-hot sun sinks + rises |
| 14 | fireflies | 5 | ✅ A− — spaced yellow-green + amber dots drift + blink on black |
| 15 | swarm-merge | 5 | ✅ A− — 4 distinct dots march in → white merge flash → settle |
| 16 | ringed-planet | 5 | ✅ B+ — banded gas-giant, drifting red spot, cyan ring + shimmer |
| 17 | inchworm | 6 | ✅ A− — green worm + yellow head, bunch-arch-stretch inch, wraps |
| 18 | ufo | 6 | ✅ A− — silver saucer, round green dome, chasing lights, flies across |
| 19 | confetti | 6 | ✅ A− — pops from lower-left, rainbow arc, settles, re-fires |
| 20 | compactor | 6 | ✅ A− — steel bar crushes multicolor field into a strip, refills (~3 rows vs "2") |
| 21 | aurora | 6 | ✅ A− — green→cyan→violet curtains undulate over a starfield |

**🎉 LIBRARY COMPLETE — built 21, refined to 19, all demo-grade.** All saved frame-expressions
in `mcp_server/expressions/`, all in the studio gallery (orphan group, awaiting the wiring pass).
Overview montage: `scratchpad/LIBRARY.png`. Generators kept in scratchpad (not committed).

### Refinement pass (2026-06-24, user notes after eyeballing)
- **Removed:** `stamp` (cut entirely), `lighthouse` (didn't read as a lighthouse). 21 → 19.
- **Renamed/reworked:** `ringed-planet` → **`jupiter`** (dropped the ring; banded gas giant + glowing red/orange Great Red Spot).
- **Reworked:** bloom (petals = fuller clusters, not lines) · crystal-ball (glint → proper twinkle: flare + `+` + fade) · goldfish (bubbles rise straight up from the mouth, no buzzing) · fireflies (smooth glow ramps + smooth Lissajous drift) · sunrise (rays emanate + sparkle, blue ocean horizon row) · compactor (random scattered field + piston-driven white bar → 3-row stack) · confetti (real particle sim: random spray from corner, glitter, varied fall + settle, ~2× pieces) · dusk (sun starts high + sinks through full board, then twinkling stars) · hourglass (sand drains neck-first + falls + piles floor-up, no top-cling) · lightning (one CONNECTED crack + whole-scene glow-up on strike) · skull (lower-left rebuilt symmetric) · ufo (classic green-tractor-beam COW abduction; red/yellow lights removed).
- **Slowed:** inchworm (130→175) · swarm-merge (110→155) · warp-portal (90→140).
- **Aurora:** removed the stray white "stars" (key `#484840`) in cols 2/4/6.
- **No change (user-approved):** claude-idle, idea, task-complete, soundwave.
- Skill `building-8x8-animations` gained 5 lessons from this pass (smooth-glow/twinkle, particle
  gravity, flash-lights-scene, pacing, + main-agent-as-critic). 66/66 tests green.

### Refinement round 2 (2026-06-24, second user eyeball)
- **DONE / approved (11):** aurora, bloom, claude-idle, crystal-ball, fireflies, goldfish, idea,
  inchworm, soundwave, swarm-merge, task-complete. Tracked in `scripts/build-gallery-data.mjs`
  `APPROVED` set → studio renders a **green ✓ + green frame** on those cards (verified via Playwright).
- **Fixed:** compactor (dots PUSHED down by the bar, crush-stack>3→2) · confetti (full-width
  flutter-down like New Year's) · dusk (sky slides down to full black, THEN stars) · hourglass
  (orange-only, grain-by-grain fall, RESET not flip) · jupiter (red↔orange pulsing spot in the
  lower-right) · lightning (bolt emerges from the cloud's underside) · skull (jaw tapered in) ·
  sunrise (SIMPLIFIED — round sun rising from blue water with radiating rays) · ufo (symmetric
  dome, cone beam, cow present from f0, head shifted).
- **Slowed:** reticle (80→120), warp-portal (140→185).
- Skill gained the "simplify when a rework gets worse" lesson. 66/66 tests green.

### Refinement round 3 (2026-06-24)
- **Approved added (now 14 ✓):** hourglass, reticle, ufo (joining the prior 11).
- **Fixed:** compactor (dots pile BOTTOM-row-first, pushed by the bar; 2 cycles each w/ a
  different random scatter so the loop doesn't repeat) · confetti (REDONE: continuous
  multicolor fall from the top accumulating at the bottom — no upward launch) · dusk (stars
  now flare→`+`→hold→fade IN PLACE, no jumping; sun-sink/sky-slide kept) · jupiter (reframed:
  WINDOW onto the lower-right curved limb of a big banded Jupiter, glowing red spot) · sunrise
  (rays are now SINGLE detached sparkle dots, no connected 2px lines) · warp-portal (REDONE:
  nested colored square rings rippling outward; center spawns a new color each frame; no
  static white core).
- **skull — rebuilt BY HAND (main agent)** after repeated subagent misses: wide rounded
  cranium, two clear 2×2 purple glowing eye sockets (baked pulse), nose notch, teeth + tapered
  chin. Reads cleanly. `scratchpad/gen_skull_v2.py`.
- 66/66 tests green. Still-open for user review (orange ring, no ✓): compactor, confetti,
  dusk, jupiter, lightning, skull, sunrise, warp-portal.

**Polish-pass candidates (end): ✅ ALL RESOLVED.** stamp — rebuilt the slam (off-panel → hits top → slams to center → wide squash on impact). lightning — replaced the scattered-star "cloud" with a connected dark-blue storm-cloud mass the bolt cracks out of. sunrise — pinned the rising sun to the right edge at constant size (no center blob / scale jump). All re-rendered + critic-passed; 66/66 green.

## Skill learning log (what each wave taught `building-8x8-animations`)

- **Wave 0 (goldfish):** self-critique is too lenient on taste → main agent must be an
  INDEPENDENT critic via the rendered PNG. **The frame is a WINDOW** (crop a big subject;
  don't cram a whole one into 64px → blob). *(folded into skill)*
- **Wave 1 (reticle):** **Negative space carries the read (anti-blob)** — dense uniform fill
  blobs; converging elements that touch fuse and lose identity; keep gaps/holes. *(folded
  into skill)*
- **Wave 2 (stamp, hourglass):** **Loop seam — don't duplicate endpoints** (a trailing
  frame ≈ f0 freezes/double-beats the seam). **Conserve the quantity** in fill/drain/particle
  motion (sand in = sand out; capacity mismatch = pixels glitching out). *(folded into skill)*
- **Wave 3 (lightning, bloom, crystal-ball) + CONSOLIDATION:** **Shading sells volume** —
  highlight in one corner + shadow in the opposite makes a blob read as a 3D sphere/dome
  (gold for planet, UFO dome). Reviewed the whole skill for coherence; it's tight, no
  redundancy to trim. *(folded into skill)*
- **Wave 4 (skull, lighthouse, sunrise, soundwave):** **Detached emission** — a beam/ray/
  stream not touching its source floats (lighthouse beam). **Subject changed scale mid-move**
  — the sunrise sun ballooned then cropped; hold size while traveling. *(both → skill Common
  Mistakes)*
- **Wave 5 (warp-portal, dusk, fireflies, swarm-merge, ringed-planet):** **Every frame must
  visibly advance** — modular/lerp math made identical consecutive frames (warp f0==f2 flicker;
  swarm dots crept), reading as stall not motion. *(→ skill Common Mistakes)*
- **Wave 6 (inchworm, ufo, confetti, compactor, aurora) — the hard ones, skill PLATEAUED as
  predicted:** **Wrap-copy crossing subjects** (inchworm left a dead gap at the edge seam) and
  **dedupe the palette** (aurora minted 50+ keys → crash). Both niche → Common Mistakes. Pure
  ballistic physics flung confetti off-panel + lost mass → authored/clamped paths conserve
  better (reinforced existing "conserve" rule). No new *core* principles — the 5-wave skill
  now catches the general failures; only animation-specific tweaks remained. *(skill converged)*

## Roster (earlier edits to EXISTING expressions)

_(the rows above this section, plus the open items, are the edits to pre-existing glyphs)_
