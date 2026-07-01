---
name: building-8x8-animations
description: Use when building, generating, or refining a frame-expression animation for the ESP32-S3 8x8 LED matrix (a new saved-expression JSON in mcp_server/expressions/) — especially when producing several and you want to render-and-critique them without the board or a human's eyes. Covers the generator-script method, the PNG contact-sheet preview loop, the legibility rubric, and parallel animator/critic dispatch.
---

# Building 8x8 animations

**REQUIRED BACKGROUND:** Use superpowers:emoting-on-8x8 for the legibility craft
(silhouette test, brightness bands, motion-carries-meaning). This skill is the
*production loop* that makes that craft repeatable and parallelizable — because every
candidate gets RENDERED TO AN IMAGE you can actually look at.

## Core principle

You cannot judge a 64-pixel animation blind. The contact-sheet renderer turns a
frames-JSON into a PNG (every frame, upscaled, with bloom) so an agent can
**build → render → LOOK → critique → iterate** with no hardware and no human in the
loop until final sign-off.

## The loop (one animation)

1. **Write a generator script**, don't hand-place pixels. A throwaway Python script that
   emits the JSON nails timing, loops cleanly via modular time, and is re-rollable.
   Hand-placing 24×64 cells is error-prone.
2. **Emit the saved-expression JSON**: `{ "description", "frames": [ ["8 chars"×8]×N ],
   "colors": {"A":"#rrggbb",…}, "frame_ms", "loop" }`. `.` = off. ≤24 frames.
3. **Render it**: `python scripts/render-contact-sheet.py <file>.json -o sheet.png`
4. **Read the PNG and score it against the rubric** (below). Be honest — find the flaw.
5. **Iterate** the generator until it passes. Re-render each time.
6. **Save** to `mcp_server/expressions/<name>.json`. (Main agent regenerates the gallery
   once at the end via `npm run build:gallery` — don't do it per-animation in parallel —
   **and `git add studio/gallery-data.json` in that commit**: it is a *committed generated
   artifact*, so changing source without committing the regen leaves the live Gallery stale.
   Proven 2026-06-26: 8 sims passed every per-task review but didn't appear in the Gallery
   because the regenerated `gallery-data.json` was never committed.)

## Generative sims (continuous color, code-driven)

The frames-JSON above is for hand-/script-authored char-art (a small palette via the
`colors` map). A **generative sim** — a `make<Name>(opts) → {frame_ms, frame()}` factory in
`shared/firmware-sims.js` that emits per-cell RGB (the firmware-sim ports of `anim_*.ino`) —
can't be char-art (continuous color). Same build→render→LOOK→critique loop, different dump:

```
node scripts/dump-sim-frames.mjs <name> [frames] -o /tmp/<name>.json   # steps the registered sim → raw-RGB wire frames
python scripts/render-contact-sheet.py /tmp/<name>.json -o /tmp/<name>.png   # raw-RGB branch renders it
```

`dump-sim-frames` reads `FIRMWARE_SIMS[name]`, so register the sim first. `render-contact-sheet.py`
auto-detects a raw frame (a 384-char hex string = 64 `RRGGBB`, row-major) vs char-art. The sim
emits raw per-cell RGB; the sheet (and the real Panel) add the bloom — keep glow OUT of the sim.

## Legibility rubric (the critic checklist)

- **Silhouette:** can you name the subject from frame 0 at a glance? One bold subject.
- **Scale is a choice — the frame is a WINDOW, not a box.** The subject need NOT fit
  whole. A tiny complete thing *or* a bold CROPPED portion of a bigger thing both work, as
  long as the visible part is unmistakably *that thing* — a fish's head + eye + mouth reads
  as "fish" with the tail off-frame; a planet can overflow all four edges. Cramming a whole
  subject into 64px usually yields a blob; going bigger and letting the edges crop reads
  better and lets each feature (eye, mouth, gill) land at a legible size. Pick the scale
  that maximizes recognizability, not the one that fits. **BUT for an ICONIC subject (a
  planet, a logo, a symbol) the whole flashcard form is what the brain matches** — render
  Jupiter as a banded disc + red spot, not an arty limb crop. Crop only when the cropped
  part is still unmistakably the thing.
- **Negative space carries the read (anti-blob).** Gaps and holes are FEATURES, not
  waste. Two failure modes, same cause: (a) a dense uniform fill reads as a blob (give the
  body internal contrast / a hole / a taper); (b) separate elements that converge until they
  TOUCH fuse into one shape and lose their identity (keep a 1px gap between them — e.g. a
  reticle's four brackets must never close into a solid box). When in doubt, subtract pixels.
- **Shading sells volume.** To make a sphere / dome / rounded body read as 3D instead of a
  flat disk, put a bright highlight in one corner (the light source) and fall off to a darker
  shade in the opposite corner. Highlight + opposite shadow = roundness (crystal ball, planet,
  UFO dome).
- **Motion carries it:** the meaning reads from movement across frames, not static detail.
  Translate/bob the whole shape ±1px; never deform it. Keep a blank margin row for room.
- **Color separates by CHANNEL, not hue.** At low brightness red/orange/yellow collapse.
  For distinct shades use white-hot / yellow / red, or push hues apart. Use the infinite
  palette — these should be colorful, not monochrome unless the concept demands it.
- **Glow & twinkle = baked brightness steps, never on/off.** Pin glow levels to band centers
  so they survive bri 5: `64 · 107 · 149 · 192 · 235` (+255 peak); never rely on FastLED
  dimming, and a glow that "never turns off" floors at ≥64 on its dominant channel. For "alive"
  breathing (fireflies, eyes, embers) fade UP and DOWN through those steps — a hard on/off blink
  reads cheap. A star/sparkle TWINKLE = a point flares to peak, lights a 4-pixel `+` around it,
  then fades back to a dim point (in a FIXED spot — a twinkle doesn't move).
- **Loops seamlessly:** the player returns to frame 0 automatically, so do NOT make the
  last frame a duplicate (or near-duplicate) of frame 0 — that freezes/double-beats the seam
  (one held "rest" frame max). Also no jump or backtrack (classic bug: a tracer with more
  frames than path pixels replays early ones at the seam).
- **Bursts/explosions flicker** if you morph a shape — use a steady-motion field instead
  (drift/sweep/fall), shifting every row by 1 each frame over N frames.
- **Smooth flow needs a SMALL per-frame change; a full-panel swap strobes.** To read as
  gliding/flowing rather than blinking, change little between frames: either move ONE element
  across a black field (max spatial separation — on 8x8 two filled rings 1px apart just merge),
  OR fill the panel but advance a fine CONTINUOUS gradient one small step per frame (a 24-hue
  ramp flowing outward reads as flow; four contrasting colors swapping reads as a strobe).
- **Natural events want IRREGULAR timing.** Lightning, twinkles, blinks, embers read as alive
  when the gaps between events vary (pseudo-random: flash, wait 2, flash, wait 4…). A fixed
  A/B/A/B period reads mechanical — a "bounce," not a storm.
- **Particle physics: gravity, scatter, conserve.** Falling things ACCUMULATE from the floor
  up (a drain empties the BOTTOM first; the upper layer sinks to follow — grains don't cling to
  the top); a pushed pile fills the bottom row first; particles scatter irregularly (never tidy
  rows/lines) and settle at varied speeds — don't fake them as "filling rows." CONSERVE the
  count: what leaves one place must arrive at another, or pixels read as glitching out.
- **A flash lights the whole scene.** When something cracks/flashes (lightning strike,
  explosion), lift the BACKGROUND and nearby elements a brightness step on the flash frame —
  the environment reacting is what sells the impact.
- **Payload light:** prefer few frames + sparse lit pixels.

## Generator pattern (one good example)

```python
# inchworm.py — emit a JSON the renderer + board both eat. Modular time => clean loop.
import json
W=8
COL={"A":"#7CFC00","B":"#FFD400"}  # body green, head yellow — separate channels
def frame(t):
    g=[["." for _ in range(8)] for _ in range(8)]
    x=(t)%11-2                      # crawl left→right, exit, repeat
    hump = 1 if (t%2) else 0        # 2-step bunch/stretch = "inching"
    for i,(dx,c) in enumerate([(0,"A"),(1,"A"),(2,"B")]):
        px=x+dx
        if 0<=px<8: g[4-(hump if i==1 else 0)][px]=c
    return ["".join(r) for r in g]
frames=[frame(t) for t in range(11)]
json.dump({"description":"green/yellow inchworm crawling across, repeats off-frame",
           "frames":frames,"colors":COL,"frame_ms":140,"loop":0},
          open("mcp_server/expressions/inchworm.json","w"),indent=2)
```

Then: `python scripts/render-contact-sheet.py mcp_server/expressions/inchworm.json` → look.

## Running a batch (animator + critic, escalating waves)

Independent files → no contention; build each as its own saved JSON.

- **Animator** (general-purpose subagent): invoke this skill, build the generator, render,
  self-critique, iterate, save the JSON, return the JSON + sheet paths + a rubric self-assessment.
- **The independent critic is usually the DISPATCHING/main agent.** Self-critique is too
  lenient on taste — animators rate their own muddy work "PASS." The dispatcher renders +
  READS each PNG and gates it: cheaper and higher-quality than a separate critic subagent.
  (Spawn a dedicated critic subagent only when the dispatcher can't view images.)
- **Escalating waves, easy→hard** (1, 2, 3, 4, 5…): parallel WITHIN a wave; BETWEEN waves,
  fold the wave's GENERALIZABLE lessons into this skill (refactor, don't append) so the harder
  waves inherit the wisdom. Expect the skill to plateau after ~3 waves (then widen the waves).
- **Polish/rework by CONTINUING the same animator** (warm context — it still holds its generator
  + design intent), not a fresh spawn: send it the ONE specific flaw + "keep everything else." A
  rework of an existing piece is still animator work (delegate) — just route it back to the agent
  that built it.
- **Check the name doesn't collide** before saving, across TWO namespaces:
  (1) other saved/canned/wait-/bored expressions — a match gets mis-grouped and may silently
  auto-fire in that rotation instead of showing for review; and (2) the **firmware-native**
  animation modes (`fire`, `rainbow`, `fireworks`, `fireworks2`, `comet`, `sun`, `frostbite`,
  `matrix_rain`, `clock`, … — the full set is `shared/firmware-names.js`). A saved JSON named
  `fireworks2` doesn't override the firmware mode but makes "play fireworks 2" ambiguous, since
  the resolver routes firmware names down a different path than frame-expressions. Pick a name
  outside both sets (a rename = write the new file + delete the old).
- **Review discipline:** track sign-off with a visible marker (an `APPROVED` set → green ✓); and
  when an approved piece is later EDITED, REMOVE it from approved so it returns to review — edits
  invalidate prior sign-off.

Proven at scale: this loop built + refined ~40 animations across many parallel waves in one session.
The dispatcher collects the JSONs, runs `npm run build:gallery` ONCE, and presents the contact
sheets for the human's at-a-glance sign-off — the one thing no automated loop replaces (taste).

If sign-off happens on the **live board** (not just the contact sheet), pin the piece before you
end the turn: firing a `loop:0` animation and handing off lets the Stop hook's `done` checkmark
and the idle rotation clobber it, so the human sees a checkmark instead. `matrix_pin` to hold,
`matrix_unpin` to release (superpowers:emoting-on-8x8 has the details).

## Common mistakes

| Mistake | Fix |
|---|---|
| Photo-negative "blink" | Often reads as a different shape (inverted `!` → `H`). Use a brightness glow instead. |
| Linear brightness scaling | Dim steps drop below threshold and collapse to one color. Quantize to band centers. |
| Hand-placing pixels | Use a generator; re-roll cheaply; loops stay exact. |
| Edges clipped | Leave a blank border row/col if the subject shouldn't touch the panel edge. |
| Judging without rendering | Always render + Read the PNG. Blind = broken. |
| Detached emission | A beam/ray/stream/spark/bubble not touching its source reads as a floating object. Anchor emissions to their origin. |
| Subject changes scale mid-move | A traveling subject that grows/shrinks reads as teleporting/inconsistent. Hold its size while it moves unless the size change IS the animation. |
| Crossed/overlapping paths blob out | Multiple symmetric curves drawn together (e.g. a textbook double-ellipse atom) overlap into a box/blob at 8px. Use ONE clean path (e.g. a single tilted ellipse + 2 orbiting points) and let motion carry the rest. |
| Frames don't advance | Capped lerps / modular periods can make consecutive frames identical (e.g. f0==f2) → reads as flicker or a stall, not motion. Verify each frame visibly differs from the last; if two look the same, the motion isn't there. A duplicate frame mid-travel reads as a herky-jerky stutter — move one even step per frame. |
| Unwanted white glare | A non-white subject set very light (cream, pale blue) blooms to white and can form a glare blob/stripe. Reserve true white for actual highlights; keep everything else below the bloom threshold. |
| Inner feature washes into the body | A carved face / window / glowing detail only reads if it out-contrasts the body on EVERY frame, not just the bright peak. Keep the BODY dark/muted and the FEATURE bright, and don't let body highlights share the feature's color — a jack-o-lantern needs a DARK pumpkin so the glowing face pops, not a bright pumpkin with yellow patches that compete with the face. |
| Dead gap at the loop seam (crossing subject) | A subject that exits one edge and re-enters the other leaves the panel empty in between, unless you stamp a WRAP-COPY (draw it at both x and x±8) and size the loop period to the full travel span. |
| Too many palette colors | Minting a unique color key per cell (instead of deduping by hex) bloats the palette and can choke the parser. Quantize hue × brightness to a small fixed set; reuse keys. |
| Too fast | When unsure, go SLOWER (raise frame_ms). Readable/calm reads better than frantic — especially ambient pieces and emotes. |
| Over-built / a rework got WORSE | Stop adding — SIMPLIFY to the core silhouette + one clear motion (a sunrise = a circle rising from the horizon with rays, not a busy blob). Subtract detail until it reads cleanly; reach for a real reference photo for organic subjects (skull, animal, planet). |
