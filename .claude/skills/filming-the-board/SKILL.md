---
name: filming-the-board
description: Use when shooting or processing a video (or photo) of the PHYSICAL ESP32-S3 LED panel for the showcase site (site/), capturing a real-board animation clip, fixing washed-out or too-orange board footage, or adding real-hardware clips to the site. Covers the iPhone capture settings, the ffmpeg white-balance-in-post grade, square crop + centering, small looping MP4 + poster encode, wiring into the Pages build, and Playwright verification.
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
2. **Exposure washout / clipping (fix on the BOARD + lock exposure).** Too dim (board
   bri ~5) and the camera lifts exposure, blowing lit pixels to white and greying the
   black background. Too bright (bri ~40) and the LEDs clip the sensor to white/green.
   Shoot at brightness ~15 (`matrix_set_brightness 15`). Also lock iPhone exposure DOWN
   (tap-and-hold for AE/AF LOCK, drag the sun icon down) so blacks stay black, and turn
   OFF Settings > Camera > HDR Video (it lifts shadows).
3. **Sideways LED bleed mixes colors (fix in HARDWARE).** Adjacent LEDs bleed into each
   other so the panel muddies toward one glow and per-pixel color is lost. A per-LED
   baffle/mesh grid (a 3D-printed case with a square well over each LED) blocks sideways
   light so only perpendicular light reaches the camera: pixels separate, gaps go black,
   colors stop mixing. A baffled board films far cleaner and needs a much lighter grade.

Problems 1 and 2 are the same physics documented in `superpowers:emoting-on-8x8`: warm
hues (red/orange/yellow) collapse toward each other at the panel. The camera just stacks
auto-WB and exposure on top of that.

## Capture recipe (iPhone)

- Board: `matrix_set_brightness 15`, start the animation, `matrix_pin` so the lifecycle
  hooks (done-check, idle rotation) do not clobber it while the user films. Restore
  brightness 5 and `matrix_unpin` when the shoot is done.
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

**Grade = gentle white-balance warm.** Proven grade for the bri-15 unbaffled board:
```
colortemperature=temperature=4600,eq=saturation=1.18:contrast=1.06
```
- Do NOT crank saturation to "fix" the color. High saturation CLIPS the bright ring to
  green and flattens the light-ring-vs-redder-mascot contrast into a uniform dark orange
  (the exact "it's so orange" failure). Keep the ring LIGHT amber and the mascot
  (`#ff5008`) a distinct redder orange.
- Warmer = lower Kelvin. 3200 was too hot; ~4600 keeps the ring light. A baffled board
  should need even less (maybe just a crop and a whisper of warmth).

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
acceptable). Target well under ~400 KB.

## Wire into the site

- Assets live in `site/assets/`. `scripts/build-pages.mjs` copies `site/assets/` to the
  bundle root, so reference them as `./assets/...` in `site/index.html` (these are NOT
  rewritten, unlike the `../studio` and `../shared` sibling paths). Its test asserts they
  land in the bundle.
- Video element: `<video poster="./assets/...webp" loop muted playsinline>`; set `.src`
  and call `.play()` from JS gated on `prefers-reduced-motion` so reduced-motion holds the
  poster still. Do NOT use the `autoplay` attribute (can't gate it for reduced-motion).
- The browser "twin" plays the SAME animation via the shared firmware sim:
  `drive(mk(canvas, deviceEl), 'claudesweep')` (the site already imports `FIRMWARE_SIMS`).
  One shared port means it is genuinely the same code on glass and in a canvas.
- `scripts/check-links.mjs` guards firmware links: any link to `peckworks-esp32s3matrix`
  (repo OR its Pages site) must say "firmware" in its anchor text, and the showcase must
  self-link. It runs in `npm run check`.

## Verify (do not trust "it looks right")

- Build to a TEMP dir OUTSIDE Dropbox (`buildPages({outDir})`): Dropbox locks
  `pages-dist/*.mp4` and `rmSync` throws EPERM on the next rebuild.
- Serve it, drive with Playwright, and PIXEL-SAMPLE: read `video.paused/readyState/
  currentTime` and `getImageData` on the canvas to confirm both actually animate (the
  trust-raw-data / live-instrumentation lessons: verify the real runtime, not the code).
  Screenshot the section and Read it.
- Push to master deploys Pages; confirm the run succeeds and `curl` the live asset for 200.

Related craft: `superpowers:emoting-on-8x8` (why warm hues collapse on the panel),
`superpowers:building-8x8-animations` (rendering + contact-sheet critique). The board's
real-color science lives in the `color-threshold-calibration` memory; restore the board
after testing per `feedback-restore-board-after-testing`.
