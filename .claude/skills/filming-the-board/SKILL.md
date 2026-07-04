---
name: filming-the-board
description: Use when shooting or processing video (or photos) of the PHYSICAL ESP32-S3 LED panel for the showcase site (site/), capturing a real-board animation clip, filming a whole batch/library of clips in one run, fixing washed-out or too-orange board footage, or adding real-hardware clips (single side-by-side OR a flip-to-twin gallery) to the site. Covers the iPhone capture settings, bare-vs-baffled tradeoff, the ffmpeg white-balance-in-post grade (per palette), adaptive crop, the batch-campaign pipeline (queue + one-run shoot + process.sh), seamless looping, wiring into the Pages build, and Playwright verification.
---

# Filming the physical board for the showcase

A phone camera does NOT see the panel the way your eye does. Three separate things fight
you, and each is fixed in a different place. Diagnose which one you have before reaching
for a knob.

## The three problems (and where each is fixed)

1. **Auto white balance neutralizes the amber (fix in POST).** The stock iPhone Camera
   app auto-white-balances; a scene full of warm amber LED light gets "corrected" toward
   neutral, so the amber ring reads green/white on camera REGARDLESS of board brightness
   or a locked exposure. Stock Camera cannot lock WB. Correct it later with ffmpeg
   `colortemperature`, not in-camera.
2. **Exposure washout / clipping (fix on the BOARD + lock exposure).** Too dim and the
   camera lifts exposure, blowing lit pixels to white and greying the black background.
   Too bright (bri ~40) and the LEDs clip the sensor to white/green. Start around
   brightness ~8-12 (`matrix_set_brightness`) and lock iPhone exposure DOWN (tap-and-hold
   for AE/AF LOCK, drag the sun icon down) so blacks stay black; turn OFF Settings >
   Camera > HDR Video (it lifts shadows). NOTE (2026-07-04 bare-board campaign): bright
   full-panel animations (fire, snow, rainbow, confetti) flood the sensor, so drop those
   to ~5-6 or they clip to white. There is no one number; extract frames and LOOK per clip.
3. **Sideways LED bleed mixes colors (fixable in HARDWARE, but for the showcase you may
   not want to).** Adjacent LEDs bleed into each other so the panel muddies toward one glow
   and per-pixel color is lost. A per-LED baffle/mesh grid (a 3D-printed case with a square
   well over each LED) blocks sideways light so pixels separate and gaps go black. BUT
   (finding, 2026-07-04, tested against the `claudesweep` baseline): for the SHOWCASE the
   BARE panel wins. Its additive bloom MATCHES the browser-canvas twin (both draw through
   `shared/render.js` bloom), so glass and screen read as the same render, which is the
   whole point of the side-by-side. The baffle also funnels light straight into the lens
   (over-exposes, crushes the silkscreen). Shoot bare and let the bloom be the look;
   `claudesweep` stays the baseline you judge every other clip against.

Problems 1 and 2 are the same physics documented in `superpowers:emoting-on-8x8`: warm
hues (red/orange/yellow) collapse toward each other at the panel. The camera just stacks
auto-WB and exposure on top of that.

## Capture recipe (iPhone)

- Board: set brightness (~8-12, lower for bright anims), start the animation
  (`matrix_set_animation` for firmware sims, `matrix_express` for saved-frame expressions),
  `matrix_pin` so the lifecycle hooks (done-check, idle rotation) do not clobber it while
  the user films. Restore brightness 5 and `matrix_unpin` when the shoot is done (see
  `feedback-restore-board-after-testing`).
- Camera: Video mode. Tap-and-hold the board until AE/AF LOCK shows. Drag the sun icon
  DOWN until the background is truly black and the ring is amber, not white.
- Settings > Camera > HDR Video OFF. Flash off. Dim room (the panel is the only light).
- Frame head-on and tight, board filling the frame, straight-on (silkscreen label
  readable). ~5-6 seconds is plenty (the claudesweep ring laps every ~2.5 s).
- You are blind here: you cannot see the board or judge the shot live. Extract frames and
  LOOK (below); let the user reshoot. Getting the camera settings right up front saves
  reshoots (the hardware-round-trip-discipline lesson).

## Process recipe (ffmpeg)

ffmpeg is the tool. Install with `winget install --id Gyan.FFmpeg` if absent; it lands
under `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*/ffmpeg-*/bin/`, NOT on the
current shell's PATH, so invoke it by full path.

**Pick the take by LOOKING, not by probe data.** Extract a frame or a contact sheet and
Read it:
```
ffmpeg -ss 2 -i clip.mov -frames:v 1 -vf scale=460:-1 frame.jpg
# contact sheet: scale+pad each clip frame, hstack/vstack into ONE jpg to Read
```
iPhone clips are portrait stored as 1920x1080 + a rotation flag; ffmpeg auto-rotates
before filters, so crop against the DISPLAY orientation (1080x1920).

**Grade = gentle white-balance warm.** Proven single-clip grade for the amber `claudesweep`
on the bare board:
```
colortemperature=temperature=4600,eq=saturation=1.18:contrast=1.06
```
- Do NOT crank saturation to "fix" the color. High saturation CLIPS the bright ring to
  green and flattens the light-ring-vs-redder-mascot contrast into a uniform dark orange
  (the exact "it's so orange" failure). Keep the ring LIGHT amber and the mascot
  (`#ff5008`) a distinct redder orange.
- Warmer = lower Kelvin. 3200 was too hot; ~4600 keeps the ring light.

**Grade PER PALETTE for a mixed library.** One warm grade is right for amber anims but
tints blues/greens dirty. The batch campaign (below) picks a tier per clip:
```
warm    colorchannelmixer=gg=0.9,colortemperature=temperature=4700,eq=saturation=1.14:contrast=1.06
default colortemperature=temperature=5400,eq=saturation=1.12:contrast=1.05
cool    colortemperature=temperature=6300,eq=saturation=1.12:contrast=1.06
```
- `warm` (amber/orange/yellow that films green: fire, sun, volcano, lava-lamp, goldfish,
  jupiter, claude-idle): the `gg=0.9` green-channel trim goes ONLY here, it kills the green
  cast on pure-warm scenes and would drain real greens elsewhere.
- `cool` (blues/whites: snow, starfield, galaxy, frostbite, crystal-ball, meteor).
- `default` (multicolor/mixed: aurora, rainbow, fireworks, most expressions).
- Judge the tier by LOOKING at a frame, not by the name.

**Crop square + center:** `crop=1080:1080:0:<y>` on the rotated frame; sweep `<y>` and
preview to center the board (equal top/bottom margin, label visible). Then `scale=512:512`.

**Encode a small looping MP4 + poster.** MP4 H.264 is universal, skip WebM (it encoded
bigger at this size):
```
ffmpeg -ss 0.5 -t 5.04 -i clip.mov -vf "<grade>,crop=1080:1080:0:<y>,scale=512:512" \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 25 -preset slow \
  -movflags +faststart board-sweep.mp4
ffmpeg -ss 2 -i clip.mov -frames:v 1 -vf "<grade>,crop...,scale=512:512" \
  -c:v libwebp -quality 82 board-sweep-poster.webp
```
~5.04 s = 2 ring laps (the ring loops seamlessly; the mascot bob/blink will not perfectly,
acceptable). Target well under ~400 KB. For a clip whose animation is NOT periodic, do not
just trim, it will jump-cut on loop; use the crossfade loop in the batch pipeline below.

## Filming the whole library (batch campaign)

The proven way to add MANY clips at once (a 2026-07-04 run shot all ~47 studio-front-page
animations). Two halves: a one-take capture the user drives, then a batch process you drive.

**Capture (user films in one unbroken run):**
- YOU queue the animations and hand the user a NUMBERED list in the order you will pop them
  onto the board (`matrix_set_animation` / `matrix_express`, one at a time, `matrix_pin`
  each). The user films each, says "next", you advance. The camera stays FIXED (they aim
  for a consistent zoom, e.g. 2x); you pick up any framing slack in post via the crop.
- The user then drops all raw `.mov` files in one folder; clip timestamp order == the order
  you gave. Raw footage is big, keep it OUT of git (`.gitignore` the source dir, e.g.
  `LiveBoardClips/`).
- **Do NOT trust the position-to-name mapping.** Redos, skips, a rejected push (the board
  caps expressions at 24 frames, a 32-frame anim is refused), or a forgotten clip all shift
  the order. VERIFY each clip against its name: render a reference thumbnail from the
  animation's frames in `studio/gallery-data.json` (frames + char->hex color map, `.`=off)
  and visually match it to the clip. A count-check plus thumbnail-match caught a skipped
  clip, two reshoots, and one missed animation in the 47-clip run.

**Process (write a `process.sh` in your scratchpad following these stages, one ffmpeg pass
per clip, driven by a `clip#:name:tier` spec list you assemble from the verified mapping):**
- **Adaptive cropdetect.** Board brightness varies wildly across anims, so a fixed
  `cropdetect` limit fails: bright full-panel anims flood a low threshold (box = whole
  frame), dim ones need a low one. Loop the limit up (0.12 -> 0.40) and take the first that
  isolates the board (detected width in a sane band, e.g. <=760px on a 1080-wide frame).
- **Board is square, bottom-anchored.** Set crop side = detected width and anchor to the
  BOTTOM of the lit box (`sy = cy + ch - side`) because the USB-C cable and its glow sit
  ABOVE the board; clamp to stay in-frame. Add a small margin (~5%). Then `scale=512:512`.
- **Per-palette grade** (warm/default/cool strings above), tier chosen per clip.
- **Seamless loop:** for periodic anims, find the exact period with a frame-accurate PSNR
  scan (`select=eq(n\,M)` compared to frame 0; `claudesweep` = 55 frames) and trim to it.
  For non-periodic anims, CROSSFADE the loop: `split` the segment, `xfade` the tail back
  over the head with `offset = Dseg - 2*X` so both ends resolve to the same source frame and
  the seam is frame-identical (no jump-cut). `X ~= 0.4s`.
- Encode `libx264 -crf 26 -preset medium -movflags +faststart` + a WebP poster from a mid
  frame; all clips landed <400 KB.

## Wire into the site

- Assets live in `site/assets/`. `scripts/build-pages.mjs` copies `site/assets/` to the
  bundle root, so reference them as `./assets/...` in `site/index.html` (these are NOT
  rewritten, unlike the `../studio` and `../shared` sibling paths). Its test asserts they
  land in the bundle.
- Video element: `<video poster="./assets/...webp" loop muted playsinline>`; set `.src`
  and call `.play()` from JS gated on `prefers-reduced-motion` so reduced-motion holds the
  poster still. Do NOT use the `autoplay` attribute (can't gate it for reduced-motion).
- The browser "twin" plays the SAME animation via `drive(mk(canvas, deviceEl), name)`, one
  render path for BOTH kinds: firmware sims (`FIRMWARE_SIMS[name]`) and saved-frame
  expressions (`LIB[name]`, loaded from `studio/gallery-data.json`). `drive()` returns false
  for a name with no sim/expression (e.g. `clock` has a firmware anim but no JS sim), let the
  tile fall back to video-only. One shared port means it is genuinely the same code on glass
  and in a canvas.
- **Two site patterns:** the `#hardware` **side-by-side** (one big board VIDEO `||` its live
  canvas twin, an "=" between), and the `#gallery` **flip-to-twin wall** (PR #19): a dense
  grid of every board clip where each tile is the video (tag `glass`) and FLIPS on hover/tap
  (CSS `rotateY(180deg)`) to its live browser twin (tag `screen`). For a 40+ clip wall, lazy
  everything or the page chokes: an `IntersectionObserver` sets each `video.src` + `.play()`
  only near the viewport (posters hold otherwise; ~18 decode at once, not all 47), and mount
  each twin canvas on FIRST hover, not up front.
- `scripts/check-links.mjs` guards firmware links: any link to `peckworks-esp32s3matrix`
  (repo OR its Pages site) must say "firmware" in its anchor text, and the showcase must
  self-link. `scripts/check-emdash.mjs` scans ALL tracked text (this skill included), so no
  em-dashes anywhere, even inside a JS string or an `aria-label`. Both run in `npm run check`.

## Verify (do not trust "it looks right")

- Build to a TEMP dir OUTSIDE Dropbox (`buildPages({outDir})`): Dropbox locks
  `pages-dist/*.mp4` and `rmSync` throws EPERM on the next rebuild.
- Serve it, drive with Playwright, and PIXEL-SAMPLE: read `video.paused/readyState/
  currentTime` and `getImageData` on the canvas to confirm both actually animate (the
  trust-raw-data / live-instrumentation lessons: verify the real runtime, not the code).
  Screenshot the section and Read it.
- Push to master deploys Pages; confirm the run succeeds and `curl` the live asset for 200.
- **Large-asset push gotcha (Windows).** Pushing many MB of video at once can fail with
  git-over-schannel `SEC_E_MESSAGE_ALTERED` + "unable to rewind rpc post data" (the default
  `http.postBuffer` ~1MB overflows and the retry cannot rewind the stream). Fix once, local
  to the repo: `git config http.postBuffer 524288000`. Guard-in-the-repo, not a reminder.

Related craft: `superpowers:emoting-on-8x8` (why warm hues collapse on the panel),
`superpowers:building-8x8-animations` (rendering + contact-sheet critique). The board's
real-color science lives in the `color-threshold-calibration` memory; restore the board
after testing per `feedback-restore-board-after-testing`.
