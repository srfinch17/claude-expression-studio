# Claude Expression Display — Design Spec
**Date:** 2026-06-11
**Priority:** ⭐ TOP — the user's stated "natural evolution" of the project.

## Vision
The matrix becomes **Claude's autonomous expression window** — an ambient,
silent channel where Claude shows what it's doing (working spinner), what it
needs (blinking alert = input wanted), what happened (check / thumbs-up), or
just personality (animated spaceship). Claude uses it **without being asked**,
the way a person uses facial expressions. Workflows first; storytelling,
teaching, play — all fair game. Everything shown must be **readable by a human
at 8×8** ("the silhouette test"); user preferences get learned over time.

## Architecture (three layers)

### 1. Firmware — frame-sequence player
`POST /api/display/frames`
```json
{ "frames": ["<384 hex chars = RRGGBB × 64 px, row-major>", ...],
  "frame_ms": 150, "loop": 0 }
```
- 1–24 frames; `loop: 0` = repeat forever, `N` = play N passes then **hold the
  last frame** (how "blink twice then show ✓" works).
- Plays via the standard animation dispatch (`animationName = "frames"`,
  `stepFramesFrame()` in `anim_frames.ino`); buffer is a static
  24×64 CRGB (≈4.6 KB). **Transient** — not persisted for auto-resume.
- Colors are CRGB-direct (board is RGB order). Channels must respect the
  visibility threshold (`docs/LED_BRIGHTNESS.md`) at typical brightness.

### 2. MCP server — Claude's drawing/expression interface
Claude never writes hex. It draws **text-art**: 8 strings × 8 chars per frame +
a `colors` legend (`.` = off). The server converts to the wire format.

Tools:
- **`matrix_express { name }`** — play a canned or saved expression. The tool
  description carries the usage doctrine (below) + the canned catalog.
- **`matrix_animate { frames, colors, frame_ms, loop, save_as?, description? }`**
  — draw custom frames; `save_as` persists it to the library for reuse.
- **`matrix_list_expressions {}`** — canned + saved, with descriptions.

Canned library lives in `mcp_server/expressions.ts` (curated, pre-vetted).
Saved expressions are JSON files in `mcp_server/expressions/` — **committed to
git** so good drawings survive and sync.

### 3. Doctrine — how Claude knows when to use it
Lives in the tool descriptions (read every session) + repo `CLAUDE.md`:
- Long task starting → `working`. Done → `done` (blink + ✓). Blocked on the
  user → `alert` (loops until replaced). Success/celebration → `party`/`check`.
  Playful beats welcome when the moment fits (`spaceship`).
- Custom drawings: bold silhouette, ≤3 colors, dark background, must read at a
  glance. When the user reacts (likes/dislikes), record it in auto-memory.
- Don't spam: one expression per state change, not per step.

## Out of scope (parking lot)
- Web-page frame editor for humans (sketch.html covers single frames).
- Auto-resume of expressions; sound; >24 frames; per-frame durations.

## Verification (flash + restart Claude Code for new tools)
1. `matrix_express { name: "smiley" }` → static smiley appears.
2. `working` loops; `alert` blinks indefinitely; `done` blinks then holds ✓.
3. `matrix_animate` with 2 custom frames animates; `save_as` then
   `matrix_express` by that name replays it; file appears in
   `mcp_server/expressions/`.
4. Silhouette test on hardware: each canned glyph identifiable by a human at
   default brightness 40.
