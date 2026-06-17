# S2 · Shared Palette / Color-Picker Component — Design Spec
**Date:** 2026-06-09
**Roadmap:** S2 (shared UI component)

## Overview

One reusable color-palette chooser, `data/palette.js` (global `Palette`), that any
page mounts for an N-color selection (2, 3, 4, …). It renders preset palette
swatches + N labeled color pickers, and reports the chosen colors via a callback.
Goal: stop hand-rolling palette UIs per page and give the whole app a unified
look. First consumer: the Calendar app; retrofittable to clock/liquid/animations.

Self-contained (injected CSS, no framework), served from LittleFS — no firmware
change. Pattern mirrors `bright.js` / `ledsim.js`.

## API

```js
var pal = Palette.mount('#slot', {
  count: 3,                                   // number of color pickers
  labels: ['Hours','Colon','Minutes'],        // optional, per picker
  defaults: ['#ff3300','#ffffff','#00ccff'],  // optional initial colors
  presets: [...],                             // optional; falls back to built-ins
  onChange: function (colors) { ... }         // fires on any change; colors = [hex,...]
});
pal.get();          // -> ['#...', ...] current colors
pal.set([...]);     // programmatically set (fires onChange)
```

`mount()` returns `{ get, set }`. `count` controls how many pickers/colors. If
`defaults` is shorter than `count`, it's padded from the first built-in preset.

## Built-in presets

A curated set, each with ≥4 colors so any `count` up to 4 works (the component
uses each preset's first `count` colors):

```
Fire   #ff2a00 #ff7b00 #ffd000 #fff3a0
Ocean  #003cff #0090ff #00d0ff #bff4ff
Lime   #0a8a00 #5fd000 #b6ff3a #f0ffb0
Plasma #6a00ff #c000ff #ff4ad0 #ffc0f0
Sunset #ff004c #ff5a00 #ffb000 #ffe88a
Ice    #0040a0 #3aa0ff #9fe0ff #ffffff
Mono   #ffffff #bbbbbb #777777 #333333
RGBY   #ff0000 #00ff00 #2060ff #ffe000
```

## UI / behavior

- **Preset row:** each preset is a small chip showing its first `count` colors as
  vertical stripes; click applies them to the pickers and fires `onChange`.
- **Pickers:** a row of `count` `<input type=color>` controls, each with its label
  underneath. Changing one fires `onChange` and clears the active-preset outline
  (manual edit).
- Self-styled with namespaced `.pal-*` classes (dark theme matching the app), so
  it looks identical everywhere.

## Files
- New: `data/palette.js`
- First consumer: the Calendar app (next). Retrofit clock/liquid/animations later
  (noted in ROADMAP) — out of scope here to avoid touching working pages.
- Firmware: none.

## Verification
Mount on a scratch page (or the Calendar page): presets render as striped chips;
clicking one updates all pickers; editing a picker fires `onChange` with the full
color array; `count` of 2/3/4 each render the right number of pickers.
