# Baked frames file format (.cfr / .cfrpack), v1

The contract for baking this repo's animation library into standalone frame files a
firmware "frames player" can loop from LittleFS, so a gift board carries the whole
library with no computer, no studio, and no network. This is the studio half of the
feature: the exporter lives here (`scripts/export-frames.mjs`); the firmware player
consumes it as of firmware v0.14.0 (`peckworks-esp32s3matrix`).

Status: SHIPPED. Changes to either format now need a version bump + both-sides
coordination, not a free edit.

## Firmware limits

The firmware frames player caps `frame_count` at **160 frames per animation**
(the exporter fails the export, not the gift recipient, if a bake exceeds this;
the contract's u16 field can technically hold up to 65535, but the player rejects
anything over 160). The largest current library entry is `fire` at 150 frames.

## Why indexed color

Measured across the shipped, curated bake (71 animations after dropping the 15-name
list below, see [frames-export-sizes.md](frames-export-sizes.md)):

- 56 of 71 animations use 16 or fewer distinct colors.
- 68 of 71 fit within 256 distinct colors with no loss.
- Only 3 generative sims exceed 256 (dancefloor, liquid, starfield) and get
  quantized (frequency-greedy palette + nearest-color mapping; invisible at 8x8
  panel scale).

So the palette cap is 256 entries and every pixel is exactly one byte. The shipped
bake totals 136,624 payload bytes across the 71 `.cfr` blobs (133.4 KB), packed into
a single ~136 KB `library.cfrpack` (see below), comfortably inside the design goal of
well under 500 KB (it must share a 1 MB LittleFS partition with the board's web UI).

## File layout

One file per animation, extension `.cfr`. All multi-byte fields little-endian
(natural for the ESP32). File size = 12 + 3 x palette_size + 64 x frame_count.

| offset | size | field | meaning |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `CFRM` |
| 4 | 1 | version | `1` |
| 5 | 1 | loop | play count: `0` = loop forever, N = play N times then hold the last frame |
| 6 | 2 | frame_count | u16, number of frames (1 to 65535; firmware player rejects over 160, see Firmware limits above) |
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

The exporter also writes `index.json`: an array of `{ name, file, frames, frame_ms,
loop, palette_size, distinct_colors, quantized, bytes, source, loop_note }` plus
`totalBytes` and the format magic/version. It is written MINIFIED (no
pretty-print), it is one of the two files that ship to the board (the other is
`library.cfrpack`, below). The gallery reads it as the playlist; each `.cfr` blob
inside the pack is also fully self-describing.

Loose `.cfr` files (one per animation, `frames-out/<name>.cfr`) are still written
by the exporter for dev inspection, but are NOT copied to the board: only
`library.cfrpack` + `index.json` ship.

## .cfrpack v1

The archive format that actually ships to the board: one file, little-endian,
holding every curated `.cfr` blob unmodified. Firmware `loadCfr(name, ...)` opens
`/frames/library.cfrpack`, validates the header, linear-scans the table for `name`
(the library is small enough that linear is fine), validates that entry's
offset/length are in-bounds, then runs the existing `.cfr` validation/decode
against the blob at that offset. Reference encoder/decoder:
`encodePack()` / `decodePack()` in `scripts/export-frames.mjs`.

| offset | size | field |
|---:|---:|---|
| 0 | 4 | magic ASCII `CFRP` |
| 4 | 1 | version = 1 |
| 5 | 1 | reserved = 0 |
| 6 | 2 | count u16 |
| 8 | 40 x count | table entries |
| ... | ... | payloads: each a COMPLETE, unmodified `.cfr` blob |

Table entry (40 bytes): `name` 32 bytes, ASCII `[a-z0-9_-]`, zero-padded (spec cap
31 chars + NUL; longest shipped name is 14 characters); `offset` u32 from file
start; `length` u32. Entries sorted by byte order (plain code-unit comparison
of the ASCII names), reproducible across machines and locales. Offsets must be
ascending, non-overlapping, in-bounds, and each payload must itself validate as
`.cfr` v1 (the firmware re-uses the existing per-blob validation).

The reference decoder (`decodePack()` in `scripts/export-frames.mjs`) rejects
duplicate names, non-ascending order, zero-length payloads, and a table that
overruns the file, all up front at decode time. The firmware does not do this
global pass: `loadCfr()` only validates the looked-up entry's offset/length
bounds, for the one name being looked up, at lookup time. If the pack is
missing or a lookup fails validation, that baked play returns 400 and the
display is left untouched (fail-safe); the gallery still renders from
`index.json`, but tiles fail visibly.

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

## Curation (dropped from the shipped bake)

Separate from "cannot bake" below: these 15 animations CAN bake fine, but were
dropped from the shipped `library.cfrpack` by user curation (LittleFS was full at
87 loose files; the pack format plus this drop list freed the flash headroom). The
drop list lives as a committed exclude file, `scripts/frames-exclude.json`, read by
the exporter: an excluded name is skipped from every output (loose `.cfr`,
`index.json`, `library.cfrpack`, the size report), and the export FAILS if a listed
name is not actually found in the library (typo protection, so a refresh can never
silently resurrect or silently drop the wrong animation).

`cross`, `ok`, `wink`, `yawn`, `thumbsup`, `done`, `jack-o-lantern`, `working`,
`wait-logo-boot`, `wait-logo-breathe`, `wait-logo-chase`, `wait-logo-ripple`,
`wait-orbit`, `bounce`, `shooting-star`.

The drop is bake-only. The studio's wire channel (hooks, wait pools,
`matrix_express`) still carries all 15 live; nothing is deleted from the source
library, `shared/manifest.json`, or the gallery source data.

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
npm run export:frames   # writes frames-out/ (gitignored, incl. library.cfrpack + index.json)
                         # + docs/frames-export-sizes.md (committed)
npm test                # includes scripts/export-frames.test.js (cfr + cfrpack format,
                         # palette, round-trip, curation/exclude guards)
```

Sim captures run under a fixed RNG seed, so exports and the size report are
reproducible run to run. `frames-out/` holds the curated 71-animation set: the
15 dropped names never write a loose `.cfr`, never enter `index.json`, and never
enter `library.cfrpack`.

## Resolved (were open questions, now shipped behavior)

- Files live at `/frames/library.cfrpack` + `/frames/index.json` (2 files, not one
  per animation); the player looks names up in the pack table, not a directory scan.
- Play-once files (`loop > 0`) hold the last frame; they do not advance a playlist.
  Moot for the current shipped bake anyway: `done` was the only `loop != 0` entry
  and it is one of the 15 curated out, so no shipped baked file currently plays once.

## Still open for the firmware half

- Playlist/shuffle behavior and how the frames player coexists with the idle
  screensaver rotation and the API-driven animations.
- Whether pool params variants (e.g. `matrix_rain` color schemes) ship as palette
  presets in the sidecar or as separate bakes (palette-swap makes presets nearly free).
