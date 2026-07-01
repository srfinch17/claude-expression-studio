# Firmware-name reservation + unified expression catalog

## Problem

Two animation registries share a flat name space with no coordination:

- **Firmware-native modes** (a fixed set of 26 names in `shared/firmware-names.js`,
  e.g. `fireworks`, `fireworks2`, `comet`) play via `POST /api/display/animation`
  (`matrix_set_animation`).
- **Studio frame-expressions** (saved JSON in `mcp_server/expressions/`) play via
  `POST /api/display/frames` (`matrix_express` / `matrix_animate save_as`).

Two concrete issues:

1. **Resolver-shadowing footgun (the real bug).** `decideRender` routes any name in
   `FIRMWARE_NAMES` down the firmware path. So a *saved* studio animation named the
   same as a firmware mode (e.g. `fireworks2`) is unreachable through the manifest,
   the resolver always picks the firmware mode.
2. **No single catalog.** `matrix_list_expressions` lists only canned + saved
   frame-expressions, never the firmware-native set, so "play fireworks 2" is
   ambiguous and the firmware modes are invisible to that tool.

There is no actual collision today (`fireworks-3` is not a firmware name). This is
preventive.

## Decision

Reserve the firmware namespace on write, and surface it in the catalog. Explicitly
NOT full `fw:` / `studio:` prefix namespacing: the firmware set is fixed and closed,
so *reservation* beats *qualification* (reserving 26 names is O(1) forever; prefixes
tax every reference and require a parity-sensitive resolver/manifest migration). The
firmware set is already an implicit namespace via `isFirmwareName`/`decideRender`;
this makes that boundary explicit and safe without foreclosing prefixes later if a
genuine second overlapping source ever appears.

## Design

### 1. Reservation guard (create path)

`matrix_animate` with `save_as` is the canonical create path. After sanitizing the
save name (`[a-z0-9-]`, as today), if it is a firmware name, refuse the *save* with a
clear message. The animation still plays, only the save is blocked, so the user can
re-run with a different name without re-describing.

- The sanitizer strips underscores, so the four underscore firmware names
  (`matrix_rain`, `timer_*`) can never be produced by a save and can't collide;
  `isFirmwareName(sanitized)` catches every reachable collision and harmlessly ignores
  the rest.
- The studio editor write path (`expression-api.ts`) is **edit-only** (404s unknown
  names) and no existing expression has a firmware name, so it cannot introduce a
  collision, no change needed there. Deliberate, not an oversight.

Closing the create path means no saved anim can share a firmware name, which removes
the resolver-shadowing footgun without touching the parity-tested resolver.

### 2. Unified catalog

`matrix_list_expressions` gains a firmware-native section (sourced from
`shared/firmware-names.js`) above canned + saved. Presentation only; no prefixes in
stored identifiers.

### 3. Structure

Pure, tested helpers in a new `mcp_server/expression-catalog.ts` (matching the
`presence.ts` / `settings.ts` / `pin-flag.ts` extraction pattern):

- `reservedSaveError(sanitizedName, isFirmware) -> string | null`
- `formatCatalog({ firmwareNames, canned, saved }) -> string`

`loadEngine` gains `firmwareNames` (sorted `[...FIRMWARE_NAMES]`) so the handler can
build the section from the single source. Handlers call the pure helpers.

## Testing

- `expression-catalog.test.ts`: `reservedSaveError` refuses reserved names, allows
  kebab studio names (`fireworks-3`, `campfire`); `formatCatalog` emits all three
  sections, includes the firmware section, handles empty saved.
- Existing `firmware-names.test.js` already guards the 26-name set and `isFirmwareName`.

## Out of scope

Full `fw:`/`studio:` prefix namespacing (revisit only if a second overlapping
animation source appears). No resolver/manifest/hook changes. No migration.
