# Studio Editor — Per-Entry Params & Labels (Design)

**Date:** 2026-06-27
**Branch:** `feat/expression-studio` (no merge — the repo cut is the final step of the whole arc)
**Status:** Design approved; ready to plan.
**Sub-project:** A "depth" increment on the Studio Editor (the editor built in the
`2026-06-26-studio-editor-design.md` spec + its iteration 1). Adds per-entry firmware
param and label editing. Independent of the Pages showcase and the repo cut.

---

## 1. Why

The editor reweights/recategorizes/assigns animations over the manifest's `esp32-8x8`
bindings, and round-trips each pool entry's `params`/`label` losslessly — but cannot yet
**edit** them. So tuning a screensaver entry's firmware params (fire intensity, snow speed,
fireworks colors…) or its display label still means hand-editing `shared/manifest.json`.
This increment makes `params` and `label` editable in the UI.

**Key fact:** a pool entry's `params` are **board-consumed** — the `esp32-8x8` renderer
forwards them to the ESP32's `POST /api/display/animation`, where each is parsed ad-hoc with
a default (`doc["intensity"] | 6`, `doc["speed"] | 66`, …). There is no machine-readable
schema in code, and the param vocabulary is large and per-animation. The board tolerates
unknown/absent params (falls back to defaults), so value validation here is light.

## 2. What & where

Editing of each pool **entry**'s `params` (firmware entries only) and `label` (any pool
entry), inline on the entry's tile in `studio/editor.html`. `params` and `label` live on the
entry object `{weight, params, label}`, so they are available on **pool** entries. A single
string binding (e.g. `info: "smiley"`) has nowhere to hang them — the existing **→ pool**
control converts it first; this increment adds no single-binding param support.

## 3. The param schema — `studio/firmware-params.js`

A hand-authored data module mapping each known firmware animation to its editable params:

```
FIRMWARE_PARAMS = {
  fire:        { intensity: {type:"number", min:1, max:10, step:1, default:6},
                 palette:   {type:"enum", options:[...], default:"classic"},
                 sparks:    {type:"number", min:0, max:10, step:1, default:0},
                 tendrils:  {type:"number", min:0, max:10, step:1, default:0},
                 speed:     {type:"number", min:10, max:10000, step:1, default:66} },
  frostbite:   { color: {type:"color", default:"#66ccff"}, sparkle: {type:"number",...}, mist: {...} },
  fireworks:   { color1:{type:"color",...}, color2:{...}, color3:{...} },
  snow:        { speed:{type:"number",...}, confetti:{type:"bool", default:false}, color:{type:"color",...} },
  dancefloor:  { palette:{type:"enum",...}, hold:{type:"number",...} },
  matrix_rain: { theme:{type:"enum",...}, speed:{type:"number",...} },
  clock:       { color1:{type:"color",...}, color2:{type:"color",...}, color3:{type:"color",...} },
  claudesweep: { color:{type:"color",...} },
  // …the param-taking board animations enumerable from api_handlers.ino
}
```

- `type ∈ {number(min,max,step,default), enum(options,default), color(default), bool(default)}`.
- Values are seeded from the board's real defaults/ranges in `api_handlers.ino` and the
  live screensaver pool entries in `shared/manifest.json` (the ground truth for board params).
- **Scope (confirmed):** cover the param-taking animations enumerable from the firmware; any
  firmware/param not in the schema falls back to the **raw-JSON box**, so nothing is ever
  un-editable. Enum option lists are extracted from the firmware at plan time (e.g. `palette`,
  `theme`, calendar `style`).

## 4. UI

On a firmware pool tile, an **"⚙ params"** expander reveals:
- one **typed widget per schema param** — number slider+readout, enum dropdown, color input,
  bool checkbox — pre-filled from the entry's current `params` (falling back to the schema
  default, shown ghosted when unset);
- a **label** text field (also shown for non-firmware pool entries, which have no params);
- an **"advanced (raw JSON)"** toggle showing the full `params` object as editable text
  (parse-guarded) — the escape hatch for unknown firmwares/params.

Editing a widget applies immediately to the in-memory manifest (status → "unsaved changes");
clearing a widget **removes** that param (the board then uses its default). Same explicit
**Save** / **Revert** as the rest of the editor.

## 5. Pure ops (`studio/editor.js`, TDD, lossless)

Each returns a new manifest, never mutates input, and edits only `pool[name]` — converting a
bare-number entry to `{weight, params, label}` as needed and preserving the other fields:

- `setEntryParam(manifest, rendererId, intent, name, key, value)` — set one param.
- `removeEntryParam(manifest, rendererId, intent, name, key)` — delete a param; if `params`
  becomes empty, drop the `params` key.
- `setEntryParamsRaw(manifest, rendererId, intent, name, paramsObj)` — replace the whole
  `params` object (the raw-JSON box); an empty/`{}` object drops the `params` key.
- `setLabel(manifest, rendererId, intent, name, label)` — set `label`; empty/`null` drops it.

Conversion rule (shared helper): when an op needs to write `params`/`label`, an entry that is
currently a bare `number` `w` becomes `{weight: w, …}`; an entry already `{weight, …}` is
edited in place on the clone. A single string binding is out of scope (no entry object).

## 6. Persistence & validation

Same validated **Save** via `PUT /api/manifest`. Param *values* are not server-validated (the
board tolerates unknowns → defaults); the schema widgets give client-side typing, and the
raw-JSON box is **parse-guarded** — invalid JSON shows an inline error and does not apply.
The lossless contract (already shipped) round-trips `params`/`label`; this increment makes
them editable instead of merely preserved.

## 7. Architecture, files, tests

- **Create:** `studio/firmware-params.js` (`FIRMWARE_PARAMS` schema data).
- **Modify:** `studio/editor.js` (the 4 pure ops + a private number→object conversion helper),
  `studio/editor.test.js` (tests per op: conversion from bare number, lossless preservation of
  weight/label/other-params, empty-params/empty-label cleanup), `studio/editor.html` (the
  ⚙ expander, per-type widgets, label field, raw-JSON box wired to the ops).
- **Reuse:** the existing render/Panel/tile machinery, the engine gate, Save/Revert — unchanged.
  Engine untouched.
- **Tests:** pure ops unit-tested under `node --test`; the expander/widgets verified visually
  on the engine-served Studio (controller), user as the taste gate.

## 8. Scope

**In:** schema-driven param widgets + label editing on pool entries, the raw-JSON escape hatch,
the 4 lossless pure ops, the firmware param schema for the enumerable param-taking animations.

**Out (later / independent):** params on single (string) bindings (use → pool first); an
exhaustive schema for every board mode (the raw-JSON box is the catch-all); server-side
validation of param *values*; the `card` renderer; the static Pages showcase; the
installed-`.mcpb` editing/validator packaging; the repo cut. **No merge** — stays on
`feat/expression-studio`.

**Build discipline:** pure `editor.js` ops are TDD'd; the `editor.html` glue is verified
visually; `npm test` stays green; `studio/gallery-data.json` is not a generator input — no
regen. No new runtime dependencies; native ES modules.

## 9. Open decisions (made; flag to flip)

1. **Param editing UI:** schema-driven typed widgets + raw-JSON escape hatch (chosen) over
   free-form-JSON-only or schema-only.
2. **Label scope:** editable on *any* pool entry (chosen), not firmware-only.
3. **Schema scope:** cover the enumerable param-taking animations; raw-JSON box as the
   catch-all (chosen) over an exhaustive schema.
4. **Single bindings:** params/label require a pool entry; convert via → pool (chosen).
