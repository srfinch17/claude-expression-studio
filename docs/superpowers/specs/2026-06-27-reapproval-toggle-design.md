# Studio Re-Approval Toggle (Design)

**Date:** 2026-06-27
**Branch:** `feat/expression-studio` (no merge — the repo cut is the final step of the whole arc)
**Status:** Design approved; ready to plan.
**Sub-project:** A small completeness increment on the Studio. The frame-expression editor
auto-flips an edited expression to "pending re-review" (orange) on Save; this adds the missing
inverse — marking an expression **approved** (green) again from within the Studio.

---

## 1. Why

Approval is now data-driven: `studio/approved.json` (engine-owned) holds the approved names, and
saving a frame-expression edit removes the edited name (→ orange). But there is no in-Studio way
to put a name BACK (→ green) — you'd hand-edit `approved.json`. This increment adds the toggle,
closing the **edit → review → approve** loop the frame editor opened.

## 2. What & where

- A **Gallery** approve toggle on each `source:"saved"` tile (the review surface, where the green
  ✓ already shows).
- A **frame-editor** "approve" button in its header, so right after Saving an edit (which
  un-approves) you can re-approve in place without bouncing back to the Gallery.

Both call ONE new engine route. Scope is **saved expressions only** — consistent with the ✎ edit
affordance and the existing approval semantics (canned glyphs / firmware sims aren't reviewable
here).

## 3. The engine route — `POST /api/approval/:name`

Body `{ approved: true | false }`.

1. **Edit-only guard:** if `mcp_server/expressions/<name>.json` does NOT exist → `404 { ok:false,
   errors:["unknown expression"] }`. (Approval is only for real saved expressions.)
2. **Validate body:** `approved` must be a boolean, else `400`.
3. **Update** `studio/approved.json`: idempotently add the name (when `true`) or remove it (when
   `false`). No duplicates; removing an absent name is a no-op.
4. **Regenerate** `studio/gallery-data.json` in-process via `buildGalleryData` (same machinery the
   expression write uses), so the `approved` flag is live.
5. `200 { ok: true, approved }`.

Implemented as `setApprovalValidated(opts)` in `mcp_server/expression-api.ts` (alongside
`writeExpressionValidated`), reusing its path resolution and regen. The route mirrors
`PUT /api/expression/:name` (reads the body via `readBody`, builds the same absolute paths from
`mcpDir`/`mfDir`/`repoRoot`/`base`).

## 4. The pure helper (TDD)

`setApproval(approvedObj, name, approved) -> approvedObj` — returns a NEW `{ approved: string[] }`
with the name added (when `approved` true, no duplicate) or removed (when false), never mutating
the input. Pure, unit-tested. `setApprovalValidated` writes the result with the engine's exact
format (`JSON.stringify(_, null, 2) + "\n"`, matching how `approved.json` is already committed and
written).

## 5. UI — Gallery toggle

On each `source:"saved"` tile, an **approve toggle** control:
- **✓ approved** (green) when the expression is approved; **○ approve** (dim) when not.
- Click → `POST /api/approval/:name { approved: !current }` → on `{ok:true}`, **optimistically**
  flip the tile: toggle its `approved` class and the existing green-✓ badge, and the toggle label.
  (The engine regenerates `gallery-data.json` server-side for persistence; the optimistic flip
  avoids a full gallery re-render.)
- Engine-gated: if the Studio isn't served by the engine (static/read-only), the toggle is hidden
  or inert (no approval changes without the engine).

The existing green-✓ badge stays as the at-a-glance indicator; the toggle is the control.

## 6. UI — frame-editor approve button

A button in the frame-editor header (near Save): **✓ approved** / **approve**, reflecting the
current expression's approval state (read from the loaded `gallery-data.json` `approved` flag).
- Click → `POST /api/approval/:name { approved: !current }` → updates the button state.
- After a **Save** (which un-approves on the server), the editor sets its local approval state to
  `false` so the button shows **approve** — one click re-approves.
- Disabled in read-only mode (no engine) — same gate as Save.

## 7. Architecture, files, tests

- **Modify** `mcp_server/expression-api.ts` — add `setApprovalValidated(opts)`.
- **Modify** `mcp_server/engine-server.ts` — add the `POST /api/approval/:name` route.
- **Create** `scripts/approval.mjs` — the pure `setApproval(approvedObj, name, approved)` helper, a
  tiny standalone `.mjs` (pure, testable without the engine). `setApprovalValidated` dynamic-imports
  it the same way it imports the validator/generator (`import(pathToFileURL(absPath).href)`).
- **Create** `scripts/approval.test.js` — helper unit tests (add idempotent, remove idempotent,
  remove-absent no-op, no input mutation).
- **Modify** `mcp_server/engine-server.test.ts` — route integration test (approve a throwaway
  expression → appears in approved.json + gallery-data approved:true; un-approve → removed; 404 on
  unknown; 400 on a non-boolean body; cleanup in `finally` restoring approved.json + gallery-data
  byte-for-byte, like the existing expression-route test).
- **Modify** `studio/gallery.js` (+ `studio/index.html` CSS) — the Gallery approve toggle.
- **Modify** `studio/frame-editor.html` — the header approve button.
- **Reuse:** the engine's body-read + path-resolution + regen, the validated-write pattern, the
  optimistic-update style. No new runtime dependencies; native ES modules.
- **Tests:** the pure helper unit-tested under `node --test`; the route integration-tested; the
  Gallery toggle + frame-editor button verified visually by the controller on the engine.

## 8. Scope

**In:** the `POST /api/approval/:name` route + pure helper; the Gallery approve toggle (optimistic
flip); the frame-editor approve button (reflects state, re-approves after Save); saved expressions
only.

**Out (later / independent):** approving canned/firmware (not reviewable here); a bulk
approve-all; an approval history/audit; the Pages showcase; the presence-card; the repo cut.
**No merge** — stays on `feat/expression-studio`.

**Build discipline:** the pure helper is TDD'd; the engine route is integration-tested; the UI is
verified visually; `npm test` (incl. `manifest OK`) stays green; any engine test that mutates the
committed `approved.json`/`gallery-data.json` MUST restore them byte-for-byte in `finally` (the
lesson from the expression-route test). The regenerated `gallery-data.json` is a committed
artifact — regenerate + commit when source/approval changes land.

## 9. Open decisions (made; flag to flip)

1. **Both surfaces:** Gallery toggle AND a frame-editor button (chosen) — the editor button avoids
   a round-trip back to the Gallery after an edit.
2. **One route, body-driven:** `POST /api/approval/:name { approved: bool }` (chosen) over two
   routes (approve/unapprove) — one endpoint, idempotent.
3. **Optimistic Gallery update** (chosen) over a full gallery re-render on each toggle.
4. **Saved-only:** approval requires a real saved expression file (404 otherwise), matching ✎ edit.
5. **Pure helper as a standalone `.mjs`** (chosen) so the add/remove logic is unit-tested without
   standing up the engine.
