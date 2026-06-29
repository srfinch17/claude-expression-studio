# Studio Frame-Expression Editor (Design)

**Date:** 2026-06-27
**Branch:** `feat/expression-studio` (no merge — the repo cut is the final step of the whole arc)
**Status:** Design approved; ready to plan.
**Sub-project:** A "depth" increment on the Studio Editor (after the binding editor +
its assignment / params-labels increments). Adds in-studio editing of a saved
frame-expression's pixels, frames, palette, and timing — saving back to the source JSON.
Independent of the Pages showcase, the presence-card, and the repo cut.

---

## 1. Why

The Studio can SEE the whole animation library, ASSIGN animations to manifest intents, and
TUNE firmware params/labels — but a saved **frame-expression** (the char-art glyphs in
`mcp_server/expressions/*.json`: goldfish, skull, jupiter, the `wait-*` mascots, …) can only
be created/edited via the MCP `matrix_animate` tool, frame-art typed as text. There is no
visual way to open `goldfish`, nudge a pixel, retime it, and save. This increment adds a
**palette-based 8×8 paint editor** for existing frame-expressions, writing back to the source
JSON through the engine.

**Scope decision (confirmed): edit existing only.** Creating brand-new expressions stays with
`matrix_animate` for now (avoids naming / collision-check / initial-group handling). This slice
is the focused frame editor + save-back.

## 2. The data being edited

A frame-expression file (`mcp_server/expressions/<name>.json`) is:

```json
{
  "description": "…",
  "frames": [ ["........","....O...", … 8 rows × 8 chars], … ],
  "colors": { "O": "#ff6a00", "T": "#ffb024", "E": "#0a0a40", "B": "#cdeeff" },
  "frame_ms": 150,
  "loop": 0
}
```

- `frames`: array of frames; each frame is exactly **8 strings of 8 characters**.
- `colors`: map of **single-char key → hex**. `.` = off; a char with no `colors` entry renders
  as off (per `shared/expressions.js` `resolveFrame`).
- `frame_ms`, `loop` (0 = forever), `description`.

`shared/expressions.js` `resolveExpression(json)` resolves char-art → lit-pixel arrays for the
bloom renderer. The editor edits the **raw char-art form** (preserving the authored format and
keeping diffs small), and previews via `resolveExpression` + the shared `Panel`.

**Char-art is hidden from the user.** The palette panel shows **color swatches**, never letters.
Internally each color is a char; "add color" auto-assigns the next free char. The user paints
with colors; the char-art format is an implementation detail.

## 3. Files & data flow

**New:**
- `studio/frame-editor.html` — the paint UI (DOM glue; verified visually).
- `studio/frame-editor.js` — pure expression-edit ops (unit-tested, no DOM).
- `studio/approved.json` — `{ "approved": [<names>] }`, the engine-owned approval data,
  seeded from today's `APPROVED` set in `scripts/build-gallery-data.mjs`.

**Modified:**
- `scripts/build-gallery-data.mjs` — its core extracted into an importable
  `buildGalleryData({ expressionsDir, manifestPath, approvedPath }) → galleryDataObject`.
  The CLI wrapper and the engine both call it. It reads `approved.json` (the migrated
  approval source) instead of a hardcoded `Set`.
- `mcp_server/engine-server.ts` — one new route, `PUT /api/expression/:name`.
- `studio/gallery.js` (the Gallery) **and** `studio/editor.html` (the binding editor) —
  an **"✎ edit"** affordance on each frame-expression tile → `frame-editor.html?name=<name>`.

**Read path (no new GET):** the editor reads the source expression from the
`studio/gallery-data.json` the studio already loads at boot — it bakes in raw
`frames`/`colors`/`frame_ms`/`loop`/`description` per expression.

**Write path:** through the engine only (the browser can't write files), mirroring the
manifest save pattern.

## 4. The engine route — `PUT /api/expression/:name`

Body = the raw expression JSON `{ description, frames, colors, frame_ms, loop }`.

1. **Edit-only guard:** if `mcp_server/expressions/<name>.json` does NOT already exist →
   `404 { ok:false, errors:["unknown expression"] }`. (No creating new names here.)
2. **Validate** (→ `400 { ok:false, errors:[…] }` on any failure):
   - `name` matches `^[a-z0-9][a-z0-9-]*$`.
   - `frames` is a non-empty array; each frame is exactly 8 strings; each string length 8.
   - every non-`.` character used in any frame has a `colors` entry.
   - every `colors` value matches `^#[0-9a-fA-F]{6}$`.
   - `frame_ms` is a positive integer; `loop` is an integer ≥ 0.
3. **Write** `mcp_server/expressions/<name>.json` (pretty JSON, 2-space indent).
4. **Auto un-approve:** remove `name` from `studio/approved.json` (the "edit → orange" rule,
   now automatic and data-driven instead of a manual build-script edit).
5. **Regenerate** `studio/gallery-data.json` in-process via `buildGalleryData(...)`, so the
   Gallery/editor tiles reflect the edit (and the now-orange approval) immediately.
6. `200 { ok:true }`.

Expression dir resolves from the engine's `mcpDir` (`<mcpDir>/expressions`); `approvedPath` and
the gallery-data path resolve under the served `studio/` base.

## 5. `studio/frame-editor.js` — pure ops (TDD)

All operate on an `expr = { description, frames: string[][], colors: {char:hex}, frame_ms, loop }`,
return a NEW expr, and never mutate the input:

- `blankFrame() → string[]` — 8 strings of `"........"`.
- `paintCell(expr, frameIdx, x, y, char) → expr` — set one cell (char is a palette key or `.`).
- `addFrame(expr, atIdx, copyFromIdx?) → expr` — insert a blank frame (or a copy of `copyFromIdx`).
- `duplicateFrame(expr, idx) → expr` — insert a copy of frame `idx` right after it.
- `deleteFrame(expr, idx) → expr` — remove a frame; **guard: never drop below 1 frame** (no-op).
- `moveFrame(expr, from, to) → expr` — reorder frames.
- `addColor(expr, hex) → { expr, char }` — assign the next free single char (A–Z, skipping
  used chars and `.`), add it to `colors`; returns the new expr and the assigned char.
- `setColor(expr, char, hex) → expr` — recolor an existing palette char.
- `removeColor(expr, char) → expr` — drop a palette char AND blank every cell using it to `.`.
- `setFrameMs(expr, ms) → expr` · `setLoop(expr, n) → expr` · `setDescription(expr, text) → expr`.

Out-of-range indices / unknown chars are no-ops (return an equal new expr), consistent with the
binding editor's op style.

## 6. UI — `studio/frame-editor.html`

Opened as `frame-editor.html?name=<name>`; loads that expression from `gallery-data.json`.

```
┌ Frame Editor — goldfish ──────────────── [Revert] [Save ✓] ┐
│ PALETTE          │   8×8 PAINT GRID (active frame)          │
│ ◉ ███ (brush)    │   ░░░░░░░░   click / drag = paint        │
│ ○ ███            │   ░░░O░░░░   right-click = erase (off)   │
│ ○ ███            │   T░░OOOOB                               │
│ ○ ▢  off/eraser  │   TTOOOEO░                               │
│ [+ add color]    │   TTOOOOO░                               │
│ [recolor][remove]│   ░░░OOO░░                               │
│                  ├─────────────────────────────────────────┤
│ PREVIEW (bloom)  │ FRAMES [▦][▦][▦][▦◉][▦] [+][dup][del]    │
│ frame_ms [150]   │        active = ◉ · drag to reorder      │
│ loop [0]         ├─────────────────────────────────────────┤
│                  │ description [__________________________] │
└──────────────────┴─────────────────────────────────────────┘
```

- **Palette panel:** color swatches (the selected one is the active brush) + an off/eraser.
  "Add color" opens a hex picker → `addColor`. "Recolor" edits the selected swatch → `setColor`.
  "Remove" → `removeColor` (warns it blanks cells). Letters never shown.
- **Paint grid:** the active frame at a comfortable size; click/drag paints with the active
  brush; right-click erases. Each paint → `paintCell`.
- **Frames strip:** thumbnails (rendered via the bloom `Panel` on the resolved frame); click
  selects the active frame; `[+]`/`[dup]`/`[del]` map to `addFrame`/`duplicateFrame`/
  `deleteFrame`; drag to reorder (`moveFrame`).
- **Live preview:** the whole expression animating in the bloom renderer (`resolveExpression`
  + `Panel`), honoring `frame_ms`/`loop`.
- **frame_ms / loop / description** inputs map to the meta setters.
- **Save / Revert + dirty flag** mirror the binding editor. **Engine-gated:** if `/api/expression`
  isn't reachable (no engine), show the same read-only banner the binding editor uses — saving
  requires the engine. Save calls `PUT /api/expression/:name`; on `200` clears dirty and notes
  "saved — now pending re-review (orange)"; on `400`/`404` shows the errors.

## 7. Entry points

A small **"✎ edit"** link on each **frame-expression** tile (NOT firmware sims — those have no
editable source here), in BOTH:
- the **Gallery** (`studio/gallery.js`) — where you browse the whole library; and
- the **binding editor** (`studio/editor.html`) — on the pool tiles and/or palette tiles.

Each links to `frame-editor.html?name=<name>` (new tab or same — implementer's call, default
same-tab with browser back). Firmware sims and canned glyphs are not editable through this tool.

## 8. Approval migration (the "edit → orange" rule, made automatic)

Today `APPROVED` is a hardcoded `Set` in `scripts/build-gallery-data.mjs`, and the rule "editing
an approved expression reverts it to orange" is manual discipline (hand-edit the Set). This
increment makes it data-driven and automatic:

- Seed `studio/approved.json` = `{ "approved": [<the current APPROVED names>] }`.
- `build-gallery-data.mjs` (now `buildGalleryData`) reads `approved.json` for the per-expression
  `approved` flag — producing the SAME flags as today (verified by test).
- The engine's expression save removes the edited name from `approved.json` → the regenerated
  `gallery-data.json` shows it orange.
- **Re-approval is out of scope** (no approve-button UI this slice); `approved.json` is edited
  elsewhere when an expression is signed off again.

## 9. Architecture, files, tests

- **Pure logic** (`studio/frame-editor.js`) is fully unit-tested under `node --test`: paint;
  every frame op including the ≥1-frame delete guard; palette add (char assignment) / remove
  (cell-blanking) / recolor; meta setters; **immutability of the input** on every op.
- **Generator** (`buildGalleryData`) gets a focused test: same `approved` flags as the pre-
  migration build for the real library; reads `approved.json`.
- **Engine route** tested in `mcp_server/engine-server.test.ts`: valid write round-trips the
  file; validation rejects a malformed payload (`400`); unknown name → `404`; the saved name is
  dropped from `approved.json`; `gallery-data.json` is regenerated.
- **UI** (`frame-editor.html`) is browser glue — verified visually on the engine-served Studio
  (controller), user as the taste gate. No unit test.
- **Reuse:** the shared `Panel` + `resolveExpression` for grid/thumbnail/preview rendering; the
  engine's existing static-serving + validated-write pattern; the binding editor's engine-gate +
  dirty-flag UX. No new runtime dependencies; native ES modules.
- `studio/gallery-data.json` is a committed generated artifact: after the migration + any source
  edit it must be regenerated and committed (the engine regenerates it live; the repo copy is
  committed when source changes).

## 10. Scope

**In:** opening an existing frame-expression; editing pixels (palette paint + eraser), the
palette (add/recolor/remove color), frames (add/duplicate/delete/reorder), `frame_ms`, `loop`,
`description`; live bloom preview; save-back through the engine with validation; automatic
un-approve on save; the `approved.json` migration; "✎ edit" entry points in the Gallery and the
binding editor; the `buildGalleryData` refactor.

**Out (later / independent):** creating new expressions (stays with `matrix_animate`); a
re-approval / approve-button UI; editing firmware-sim or canned glyphs; per-renderer or
presence-card concerns; the static Pages showcase; the `.mcpb` packaging of this tool; the repo
cut. **No merge** — stays on `feat/expression-studio`.

**Build discipline:** pure `frame-editor.js` ops and the generator are tested; the
`frame-editor.html` glue is verified visually; `npm test` (incl. `manifest OK`) stays green;
the regenerated `gallery-data.json` is committed. No new runtime dependencies; native ES modules.

## 11. Open decisions (made; flag to flip)

1. **Edit vs create:** edit existing only (chosen); new expressions stay with `matrix_animate`.
2. **Approval on save:** auto un-approve via an engine-owned `studio/approved.json` (chosen) over
   warn-and-manual.
3. **Where the editor lives:** a dedicated `studio/frame-editor.html` + pure `frame-editor.js`
   (chosen) over a modal inside `editor.html`.
4. **Entry points:** both the Gallery and the binding editor (chosen).
5. **Read source:** from the already-loaded `gallery-data.json` (chosen) over a new engine GET.
6. **Paint model:** palette color swatches, chars hidden/auto-assigned (chosen) over exposing
   char-art or free-RGB-with-palette-rederivation.
