---
name: add-animation
description: Add a new animation/visualization mode to the ESP32-S3 matrix firmware. Use whenever creating a new animated display mode (a new anim_*.ino) so every wiring-up step is done consistently and nothing is skipped.
---

# Add a new animation mode

Adding an animation touches **8 places** (was "6" — two silent-failure spots were
added after they bit us: `KNOWN_ANIMS` and the MCP enum). Skipping any one is the
usual cause of "I built it but it doesn't show up / the page 404s / the API 400s /
Claude can't launch it." Names below assume a mode called `<name>` (e.g. `comet`,
`claudesweep`).

## Before you start
- This skill is the **firmware wiring**. For the *look* — legibility at 64px,
  brightness-5 color, silhouette/motion craft — use **`emoting-on-8x8`** alongside it.
- Read `CLAUDE.md` (hardware facts) and `docs/PITFALLS.md` (traps).
- **`COLOR_ORDER` is RGB** — `CRGB(r,g,b)` maps straight through.
- Draw only via `setPixel(x, y, CRGB)` (bounds-checked). `XY(x,y)=y*8+x`, row-major
  (NOT serpentine), origin top-left.
- **Non-blocking**: no `delay()`. Use `millis()` + frame-state like the other
  `anim_*.ino`. The dispatcher rate-limits via `animationSpeed`/`lastFrameMs`.

## ⚠️ Three traps that have bitten this codebase repeatedly — internalize before coding

1. **Single-translation-unit ordering** (the #1 trap — see `docs/PITFALLS.md`). All
   `.ino` concatenate (main `esp32_matrix_webserver.ino` FIRST, then alphabetical).
   Arduino auto-prototypes **functions** but NOT **globals / `#define`s / structs**.
   So:
   - Any variable your `handleAnimation` branch or `loop()` dispatch must SEE goes in
     the **main ino** (alongside `solidColor`, `cometColor1`). A global defined in your
     later-sorting `anim_<name>.ino` is invisible to the earlier-concatenated
     `api_handlers.ino`/main `loop()` → compile error.
   - Keep mode-internal state as **file-local `static`** in `anim_<name>.ino`.
   - If `handleAnimation` must reset your animation, call a **non-static function**
     (e.g. `void reset<Name>()`), NOT a file-local static — the function is
     auto-prototyped and cross-file visible; the static is not.
   (This cost two compile-fix cycles on the settings/idle work; pre-empting it made the
   next animation compile first try.)

2. **`speed` is milliseconds-per-frame, NOT a 1–5 scale.** The firmware reads
   `animationSpeed = constrain(doc["speed"] | 66, 10, 10000)` (ms/frame). The MCP tool
   maps a human 1–5 to ms via `msMap = {1:150, 2:100, 3:66, 4:40, 5:20}`. **Your control
   page MUST do the same mapping before POST** — posting a raw `2` becomes 2ms→clamped
   to 10ms ≈ 100fps (a blizzard). This exact bug has shipped twice. Copy the `MS` table
   into the page's JS and send `speed: MS[sliderValue]`.

3. **Brightness-5 floor (only if it'll run as a wait/idle indicator).** Ambient
   indicators render at FastLED global brightness 5, which DOUBLE-scales with your
   per-pixel `nscale8`. A dim "baseline"/trail color must keep its **weakest channel**
   above the visibility threshold or it vanishes / shifts hue at bri 5 (e.g. amber's
   green needs a per-pixel value ≳ 63/255 to survive). Verify via
   `GET /api/display/framebuffer` AND your eyes at bri 5 — the framebuffer is pre-global-
   scaling, so it can look fine while the panel reads black. See the LED-brightness-
   formula memory.

## The 8 steps

1. **New file `esp32_matrix_webserver/anim_<name>.ino`** — mode state as file-local
   `static` (NOT cross-file globals — see trap 1); a `run<Name>Frame()` /
   `step<Name>Frame()` that renders ONE frame into `leds[]`. Clear what you need each
   frame. Mirror an existing `anim_*.ino`.

2. **Shared globals → main ino.** Any color/param your handler sets that the frame fn
   reads goes in `esp32_matrix_webserver.ino`'s globals block (e.g. `CRGB <name>Color;`).

3. **Dispatch branch** in `esp32_matrix_webserver.ino` `loop()` — grep `animationName ==`;
   add `else if (animationName == "<name>") step<Name>Frame();`.

4. **Register in `KNOWN_ANIMS`** (api_handlers.ino, ~the string array near the top of the
   handlers). **If you skip this, every `<name>` POST returns 400** ("unknown animation
   type") — the #1 silent failure for a new mode.

5. **HTTP handler** in `api_handlers.ino` → `handleAnimation()`/`applyAnimationBody()` —
   parse the mode's params from the JSON body, set the main-ino globals, and (if it has
   internal state to reseed) call your `reset<Name>()` function. `animationName`/
   `animationSpeed` are set by the shared path.

6. **Control page `data/<name>.html`** — clone an existing page (e.g. `snow.html`) to get
   the shared chrome (`.wrap` → `← Home` `.back` → colored `h1` → `.layout`). Include the
   shared brightness widget (`<script src="bright.js" data-auto></script>` + a
   `<div id="brightnessSlot"></div>`) + palette/picker if it has colors. **Speed = fps
   slider → ms** (`Math.round(1000/fps)`), never raw (trap 2). Live preview at FULL
   brightness — never dim the canvas / no `ledsim.js` for animation previews (the board
   slider only POSTs). Launch button POSTs `{ "type":"<name>", ... }`.

7. **Hub card — in `data/animations.html`, NOT the index.** The UI is hub-based: the index
   is a flat grid where "Animations" is a hub card. A new animation's card goes in
   `animations.html`'s `.anim-grid` as a **link-out card**, exactly like fire/liquid/snow:
   ```html
   <a href="/<name>.html" class="anim-card-link">
     <div class="anim-card"><span class="icon">…</span>
       <div class="name">…</div><div class="desc">…</div></div>
   </a>
   ```
   Do NOT add it to `index.html` (cards placed there get moved — see web-ui-structure).
   (System/config pages go in `system.html` instead.)

8. **MCP enum** in `mcp_server/index.ts` — add `<name>` to the `matrix_set_animation`
   `type` enum array AND a one-line description (params + meaning). Without this, Claude
   can't launch it by name. (README features row: optional, keep current.)

## Optional: wire it as an idle pick and/or a wait indicator
- **Idle screensaver:** add `<name>` to `IDLE_APPS_DEFAULT` (firmware `settings.ino`) AND
  `IDLE_APPS` (`mcp_server/idle.ts`) — keep the two aligned. (Existing boards keep their
  stored `idle_apps` CSV until toggled on the settings page.)
- **Busy/wait pool (type-aware):** add `<name>` to `WAIT_ANIMATIONS` in `mcp_server/wait.ts`
  AND `claude-hooks/matrix_signal.py` (+ its `~/.claude/hooks/` live copy). A firmware-
  animation wait pick must fire `POST /api/display/animation {type, transient:true}` — the
  **`transient` flag skips NVS auto-resume** so a busy-indicator launch doesn't make the
  board boot into it forever. Weight it in `wait-weights.json` (additive; don't erode
  existing weights). Both `index.ts` call sites of `resolveWait()` — `matrix_express("wait")`
  AND `presence_set("working")` — must handle the firmware-anim pick or the presence path
  shows a blank panel. See the wait-animation-library memory.

## Finish
- Needs **both** a Sketch upload (firmware) **and** a **LittleFS Data Upload** (because
  `data/` changed); MCP enum/idle/wait edits need a **`/mcp` reconnect**. Bump the version
  if it's a real feature (`npm run bump:minor`) and redeploy all changed artifacts.
- The controller can drive most verification over HTTP (launch it, read
  `/api/display/framebuffer`); the bri-5 *look* and any persistence/power-cycle test are
  the user's eyes. **Restore the board's prior brightness + display after testing.**
- Do not claim it works until confirmed on hardware. If a non-obvious trap bit us, append
  to `docs/PITFALLS.md`.
