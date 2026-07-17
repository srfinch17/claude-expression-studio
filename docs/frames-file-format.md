# Baked frames file format (.cfr), draft v1

The contract for baking this repo's animation library into standalone frame files a
firmware "frames player" can loop from LittleFS, so a gift board carries the whole
library with no computer, no studio, and no network. This is the studio half of the
feature: the exporter lives here (`scripts/export-frames.mjs`); the player will be
built later in the firmware repo against this document.

Status: DRAFT. Nothing firmware-side consumes this yet; the format may change until
the player ships.

## Why indexed color

Measured across the full library (71 frame expressions + 15 firmware sims, see
[frames-export-sizes.md](frames-export-sizes.md)):

- 73 of 86 animations use 16 or fewer distinct colors.
- 83 of 86 fit within 256 distinct colors with no loss.
- Only 3 generative sims exceed 256 (dancefloor, liquid, starfield) and get
  quantized (frequency-greedy palette + nearest-color mapping; invisible at 8x8
  panel scale).

So the palette cap is 256 entries and every pixel is exactly one byte. A full
library bake totals about 142 KB, comfortably inside the design goal of well under
500 KB (it must share a 1 MB LittleFS partition with the board's web UI).

## File layout

One file per animation, extension `.cfr`. All multi-byte fields little-endian
(natural for the ESP32). File size = 12 + 3 x palette_size + 64 x frame_count.

| offset | size | field | meaning |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `CFRM` |
| 4 | 1 | version | `1` |
| 5 | 1 | loop | play count: `0` = loop forever, N = play N times then hold the last frame |
| 6 | 2 | frame_count | u16, number of frames (1 to 65535) |
| 8 | 2 | frame_ms | u16, per-frame delay in milliseconds |
| 10 | 2 | palette_size | u16, number of palette entries (1 to 256) |
| 12 | 3 x palette_size | palette | R, G, B byte triples |
| ... | 64 x frame_count | frames | one palette index byte per pixel |

Frame pixel order: row-major, `index = y * 8 + x`, origin top-left, x right, y down.
NOT serpentine (matches the board's `XY()` and the existing frames wire channel).

Colors are logical RGB, exactly what `POST /api/display/frames` carries today. The
player pushes them through the normal `setPixel` -> `matrixShow()` path so global
brightness, calibration correction, and `COLOR_ORDER` apply as usual. No reserved
palette indices: black is not guaranteed to be entry 0 (frequency ordering usually
puts it there, but a player must not assume it).

A parser is a handful of lines of C++: read 12 bytes, validate magic/version/length,
read the palette into a `CRGB[256]`, then stream 64-byte frames. The reference
decoder is `decodeCfr()` in `scripts/export-frames.mjs`.

## Sidecar index

The exporter also writes `index.json` next to the `.cfr` files: an array of
`{ name, file, frames, frame_ms, loop, palette_size, distinct_colors, quantized,
bytes, source, loop_note }` plus `totalBytes` and the format magic/version. The
player MAY use it as the playlist; each `.cfr` is also fully self-describing.

## Loop capture policy

- Frame expressions (saved / canned / bored): exported exactly as authored. They
  are hand-built frame loops already; `loop` carries the authored play count
  (0 = forever, e.g. `done` is a play-once with `loop = 1`).
- Periodic sims (breathe, rainbow, spiral, sun, wave, claudesweep): the exporter
  steps the sim up to 8 seconds and cuts at a detected exact repeat, verified
  against the whole remaining capture, skipping any cold-start warm-up frames. The
  bake loops seamlessly.
- RNG-driven sims (dancefloor, fire, fireworks, fireworks2, frostbite, liquid,
  matrix_rain, snow, starfield): no exact period exists, so the exporter captures a
  6 second window; long enough that the repeat is not jarring.

Per-animation choices are recorded in the `loop_note` column of
[frames-export-sizes.md](frames-export-sizes.md).

## Palette-swap and hue-rotate playback (contract only, no player implementation yet)

Indexed frames make color remapping a palette-table operation: touch up to 256
entries once, never 64 x N pixels.

- **Palette swap:** replace the palette table before playback (a same-length RGB
  list supplied at play time, or a named preset). Frame data is untouched. This is
  how one baked `matrix_rain` becomes the blue/red/purple variants: same indices,
  different table.
- **Hue rotate:** each rotation step, map every palette entry RGB -> HSV, add the
  hue offset, map back (or use FastLED's CHSV wheel for the firmware-native flavor),
  and write the result to the working `CRGB[256]` copy. Keep the original table
  pristine and always rotate from it, so error never accumulates. At 256 entries
  max this is trivially cheap per step; grayscale-ish entries (low saturation)
  rotate harmlessly.

Both options are player-side state; the file format needs nothing extra for them.

## Excluded animations (cannot bake)

Everything that needs live data or sensors at render time. These are firmware-side
or engine-side surfaces, not part of the bakeable library:

| name | why it cannot bake |
|---|---|
| clock | live wall-clock time |
| weather | live weather API data |
| calendar | live date |
| chiptemp | live chip temperature |
| imu | accelerometer-reactive (QMI8658C input) |
| sound | live input-reactive |
| timer_fill / timer_snow / timer_text | driven by a runtime-set countdown |
| solid | not an animation: a runtime-chosen static color (player-native, nothing to bake) |
| scroll text (`/api/display/text`) | arbitrary runtime text |
| presence card / native presence | renders a live semantic PresenceMessage |

All 15 sims in `shared/firmware-sims.js` are self-contained and bake fine.

## Regenerating

```bash
npm run export:frames   # writes frames-out/ (gitignored) + docs/frames-export-sizes.md
npm test                # includes scripts/export-frames.test.js (format, palette, round-trip)
```

Sim captures run under a fixed RNG seed, so exports and the size report are
reproducible run to run.

## Open questions for the firmware half

- Where the files live on LittleFS (`/frames/<name>.cfr` proposed) and how the
  player enumerates them (directory scan vs `index.json`).
- Playlist/shuffle behavior and how the frames player coexists with the idle
  screensaver rotation and the API-driven animations.
- Whether play-once files (loop > 0) should advance the playlist instead of holding
  the last frame.
- Whether pool params variants (e.g. `matrix_rain` color schemes) ship as palette
  presets in the sidecar or as separate bakes (palette-swap makes presets nearly free).
