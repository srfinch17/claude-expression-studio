# Studio Editor — Manifest Binding Editor (Design)

**Date:** 2026-06-26
**Branch:** `feat/expression-studio` (no merge — the repo cut is the final step of the whole arc)
**Status:** Design approved; ready to plan.
**Sub-project:** Step 3 of the studio pivot (see memory `display-emote-northstar`) — the
"Studio + presence mature" step, scoped to its first and primary piece: the **manifest
editor** (old "Plan 6"). The static Pages showcase (old Plan 5) and deeper presence work
are independent, later pieces.

---

## 1. Why

The Expression Trigger Manifest (`shared/manifest.json`) is the single source of truth
mapping **moment → intent → renderer animation**. Today the *only* way to retune which
animation fires for an intent, or its weight in a pool, is to hand-edit the JSON. The
Studio's original vision always had a "Console / Hook Factory" ring — a GUI to **reweight,
recategorize, and assign** animations over that manifest. This is the user's stated actual
goal, and the next step of the studio pivot.

The substrate is already built (Plan 4): the engine serves `GET /api/manifest` and a
**validated** `PUT /api/manifest` (`mcp_server/manifest-api.ts` `writeManifestValidated`
runs every write through the same `scripts/check-manifest.mjs` validator the CI gate uses,
so the Studio can never persist a manifest that would fail `npm run check:manifest`). The
resolver reads the manifest at **runtime**, so a saved edit changes Claude's *next*-intent
behavior with no rebuild/reflash. The editor is the UI that drives this existing path.

## 2. Identity — where it fits

A dedicated **intent-centric configuration surface** (`studio/editor.html`), distinct from
the other studio surfaces:

| Surface | Role |
|---|---|
| `studio/board.html` | **Watch** — the single live "face" renderer |
| `studio/index.html` (Gallery) | **Browse** — the whole library animating, grouped read-only |
| `studio/editor.html` (NEW) | **Configure** — reweight / recategorize / assign over the manifest |

It edits the **`renderers.esp32-8x8`** bindings only. `web-sim` *inherits* esp32-8x8, so the
virtual board reflects edits for free; the `card` renderer (text glyphs) is out of scope.

## 3. The edit model

The screen lists **every intent** from `manifest.intents` (so even unbound intents appear
as empty drop-targets), each as a section showing its binding:

- A **single binding** (`intent → "name"`) shows one tile.
- A **pool binding** (`intent → {pool: {...}}`) shows each member as a small animating tile
  + a **weight slider** + the member's **live % of the pool** (weight / pool-sum), so the
  user can target a proportion ("rainbow ~80%"). Pool-level **noRepeat** toggle and
  **brightness** number are shown when present/applicable.

A **library tray** holds every animation in the library (saved/canned frame-expressions
from `gallery-data.json`, firmware sims from `FIRMWARE_SIMS`), with **orphans** (animations
referenced by no binding) visually flagged.

**Operations** (each a pure transform over the manifest object):

| Operation | Effect on the manifest |
|---|---|
| Reweight | change a pool member's weight integer |
| Move / recategorize | remove a name from one intent's binding, add to another's pool |
| Add / bind orphan | add a name (drag from tray) into an intent's pool |
| Remove | remove a name from a pool (or clear a single binding) |
| single → pool | dragging a 2nd animation onto a single-binding intent converts it to `{pool: {old: 1, new: 1}}` |
| pool → single | explicit collapse of a 1-member pool back to a string binding |
| noRepeat / brightness | set the pool-level `noRepeat` boolean / `brightness` number |

**Lossless round-trip (critical):** the editor reads the *whole* manifest and edits only
membership, weights, and the two pool options. Every other field — existing per-entry
`params` and `label`, the `intents` vocabulary, `harnesses`, the `card` renderer, pool
entries it didn't touch — is preserved byte-for-byte on write. A newly-added pool entry is
written as the shorthand `{weight: N}` (or bare number); the renderer falls back to default
params. The editor must NOT drop or rewrite fields it doesn't manage.

## 4. Persistence & degradation

- **Load:** `GET /api/manifest` → the live manifest object.
- **Save:** the validated `PUT /api/manifest`. On `{ok:false, errors}`, surface the
  `errors[]` to the user and keep the unsaved edits. On `{ok:true}`, the write has happened
  and Claude's next-intent behavior reflects it immediately (runtime read).
- **Revert:** re-`GET` and discard local edits.
- **In dev**, the engine's `mfDir` is `shared/`, so a Save overwrites the committed
  `shared/manifest.json` — the live source the hooks/MCP read (repo-first) — producing one
  clean git diff to commit.

**Engine-gated, mirroring board.html's probe pattern:**
- Opened **from the engine** (the URL `matrix_studio` returns) → `GET /api/manifest`
  succeeds → full edit + save.
- Opened **from the static `:8766` server** (no API routes) → the `GET` 404s → fall back to
  a **read-only** rendering of `shared/manifest.json` (fetched as a static file) with a
  banner: *"Editing needs the live engine — launch the Studio via `matrix_studio`."*

No engine changes are needed — Plan 4's `GET/PUT /api/manifest` routes already exist
(`mcp_server/engine-server.ts`).

## 5. Test-fire (included in v1)

Each intent gets a **▶** control that performs a **client-side weighted pick** over its
current (possibly-unsaved) pool — reusing `resolver.js`'s weighted picker — and plays the
chosen animation in a small **preview canvas** in the editor (pure resolve + `Panel`,
reusing the same tile frame-data). Firing repeatedly lets the user *watch the weight
distribution play out* without a board. This closes the edit→see loop that makes reweighting
tangible. It is read-only (no manifest write, no board I/O) and degrades fine in the static
read-only mode (it can still preview the on-disk manifest's pools).

## 6. Architecture, files, tests

**New files:**
- `studio/editor.js` — **pure** manifest-edit operations over a manifest object, no DOM.
  Exact surface (names are the contract for the plan):
  - `reweight(manifest, rendererId, intent, name, weight) -> manifest`
  - `addToPool(manifest, rendererId, intent, name, weight=1) -> manifest`
  - `removeFromPool(manifest, rendererId, intent, name) -> manifest`
  - `moveAnim(manifest, rendererId, fromIntent, toIntent, name) -> manifest`
  - `singleToPool(manifest, rendererId, intent) -> manifest`
  - `poolToSingle(manifest, rendererId, intent) -> manifest`
  - `setPoolOption(manifest, rendererId, intent, key, value) -> manifest` (key ∈ {noRepeat, brightness})
  - `computeOrphans(manifest, rendererId, allNames) -> string[]`
  - `poolPercentages(binding) -> {name: percent}` (weight / pool-sum, rounded)
  - `bindingEntries(binding) -> Array<{name, weight}>` (normalizes string | number | object pool forms)
  All are pure (return a new manifest / value; do not mutate the input), so they unit-test
  with plain objects and round-trip untouched fields losslessly.
- `studio/editor.html` — thin DOM glue: `GET`/`PUT` fetches, the engine probe + static
  read-only fallback, the intent/pool/tray layout, drag-and-drop and slider handlers (each
  calling an `editor.js` op and re-rendering), weight % display, and the test-fire preview.
  Browser glue — verified visually, not unit-tested (matches board.html).

**Reused unchanged:**
- `shared/resolver.js` — `effectiveBindings` (inheritance-merged bindings) and the weighted
  picker (for test-fire).
- `shared/catalog.js` — `bindingNames` (names a binding references) for orphan computation.
- `shared/render.js` `Panel`, `shared/firmware-sims.js` `FIRMWARE_SIMS`,
  `shared/expressions.js` `resolveExpression`, `studio/gallery-data.json` (tile frame-data).
- `mcp_server/engine-server.ts` `GET/PUT /api/manifest` + `manifest-api.ts`
  `writeManifestValidated` — **no change**.

**Tests:**
- `studio/editor.test.js` — unit tests for every `editor.js` op: correct edits, lossless
  preservation of `params`/`label`/`intents`/other-renderers, single↔pool transitions,
  orphan computation, percentage math, and the normalization of all three pool-entry forms
  (`number`, `{weight}`, `{weight,params,label}`).
- `editor.html` glue verified visually on the engine-served Studio: GET renders the live
  manifest; an edit + Save round-trips (re-GET shows the change); a deliberately-invalid
  edit surfaces the validator `errors[]`; the static `:8766` open shows the read-only banner;
  test-fire plays a weighted pick.

## 7. Scope

**In scope:** the editor over `esp32-8x8` bindings (reweight / move / add / remove /
bind-orphan / single↔pool / noRepeat / brightness), live UI + explicit validated Save +
Revert, engine-gated with a static read-only fallback, and inline client-side test-fire.

**Out of scope (later / independent):** per-entry `params`/`label` editing; intent-vocabulary,
fallback-chain, and moment→intent authoring; the `card` renderer; the static **Pages**
showcase (old Plan 5); **packaging the validator into the installed `.mcpb`** so a distributed
user can edit (v1 targets the **dev engine writing `shared/manifest.json`** — the maintainer's
real workflow; the installed bundle already degrades with a clear "validator unavailable"
error from `writeManifestValidated`); the repo cut. **No merge** — stays on
`feat/expression-studio`.

**Build discipline:** pure `editor.js` ops are TDD'd; the `editor.html` glue is verified
visually on the engine-served Studio; `npm test` stays green; `studio/gallery-data.json` is
not a generator input here, so no regen. No new runtime dependencies; native ES modules.

## 8. Open decisions (made; flag to flip)

1. **Editor surface:** dedicated `studio/editor.html` (chosen) vs. editing in the Gallery.
   Chosen for a clean browse/configure split and the intent-grain the Gallery lacks.
2. **Edit scope:** bindings + pool options only (chosen) — no params/labels/vocab/moments.
3. **Save model:** live UI + explicit validated Save + Revert (chosen) — not auto-save.
4. **Test-fire:** included in v1 (chosen) as a client-side weighted-pick preview.
5. **Target:** dev engine + `shared/manifest.json` (chosen); installed-`.mcpb` editing is a
   follow-on (needs the validator packaged).

---

## Iteration 1 — post-first-test feedback (2026-06-27)

v1 was built and live-tested; the user approved the direction and the per-category test
preview / weights / brightness / noRepeat, and asked for the following changes before the
next test run. The intent-pool editing, validated Save, engine gate, and lossless contract
are unchanged.

1. **Palette of mini-preview tiles (replaces the text chips).** The right-hand tray becomes a
   **persistent palette of ALL animations**, each a small **live-animating tile** the same
   size as the test-fire preview (~46px) **+ its name**, draggable. A one-word chip is too
   ambiguous to categorize from — you need to see the motion. Dragging a palette tile **COPIES**
   it into a category (assign); the tile **stays in the palette** (an animation can be bound to
   several events — the existing `assign` no-op-on-duplicate guard already supports this).

2. **Assignment legend (replaces "orphan").** Each palette tile gets a **colored border** —
   **green = available** (bound to 0 events), **orange = assigned** — plus a **`(N)` count** of
   how many events it's bound to (since one animation can serve many). A small legend
   ("● available  ● assigned (N)") replaces the orphan ring/label. The category pool tiles are
   unchanged.

3. **Precise category descriptions.** Each intent shows a real "fires when…" description of the
   circumstance that triggers it, derived from the harness moment map
   (`manifest.harnesses["claude-code"].moments`, `hook:*` → intent) and Claude Code hook
   semantics — e.g. `awaiting-input`: *"Fires when Claude requests a human decision; the harness
   pauses until you answer (AskUserQuestion / plan approval)."* Hook-fired intents name their
   trigger; discretionary intents (`celebrate`/`fatal`/`screensaver`) and fallback-only intents
   are labeled as such. These curated strings live in a new editor data module
   (`studio/intent-info.js`), with the manifest `doc` as fallback for any unlisted intent.

4. **Layout rebalance.** Categories are vertically expensive while most hold only 1–2 animations,
   and the palette is cramped. Make the **palette wider** (it's the working area) and the category
   sections **more compact**. Keep the test preview, sliders, brightness, and noRepeat.

**New pure helper (TDD):** `assignmentCounts(manifest, rendererId, allNames) -> {name: count}` in
`editor.js` — count of distinct intents whose binding references each name (via `bindingNames`
over `effectiveBindings`). Drives the palette color + `(N)`. (`computeOrphans` stays; orphans =
count 0.)

**Files this iteration touches:** `studio/editor.js` (add `assignmentCounts` + test), new
`studio/intent-info.js` (curated descriptions), `studio/editor.html` (palette mini-tiles + color/
count + descriptions + layout). Build discipline unchanged.
