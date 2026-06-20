# "Claude Sweep" Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a procedural `claudesweep` firmware animation — a single-color CRT/radar border sweep (dim baseline → bright head → fading comet tail, never off) with the orange Claude mascot living centered inside — usable as a roster animation, an idle screensaver pick, and a type-aware member of the busy/wait rotation. Plus a mini-Claude stamp on the sketch page.

**Architecture:** A new `anim_claudesweep.ino` renders a 28-pixel perimeter loop using the existing per-pixel decay/trail technique (`anim_comet.ino`), flooring at a visible baseline, with a 6×5 Claude sprite drawn in the 6×6 interior (1px bob + eye-blink). A new `transient` flag on `/api/display/animation` lets the wait role launch it without polluting NVS auto-resume. The wait pool (`wait.ts` + `matrix_signal.py`) becomes type-aware so a firmware-animation entry fires the animation endpoint instead of pushing frames.

**Tech Stack:** Arduino C++ (FastLED, ArduinoJson), vanilla HTML/JS pages (LittleFS), TypeScript MCP (`node:test`), Python hooks.

## Global Constraints

- **Privacy:** never use any real person's name in code/comments — refer to "the user".
- **Single-translation-unit ordering** (this codebase's #1 trap — see `docs/PITFALLS.md`): all `.ino` concatenate (main `esp32_matrix_webserver.ino` first, then alphabetical). Arduino auto-prototypes FUNCTIONS but NOT global variables / `#define`s / struct types. Keep new animation state as **file-local `static`** in `anim_claudesweep.ino`; any variable shared across files goes in the **main ino**.
- **Claude cannot compile/flash firmware.** Every firmware task ends with a **hardware-verification checklist the user runs**.
- **Brightness-floor:** the wait/idle roles run at FastLED brightness 5, where a channel shows only if `channel×(bri+1)>>8 ≥ 1`. With double-scaling (per-pixel `nscale8` × global brightness), amber `#ffb000`'s green channel survives at bri 5 only when the per-pixel brightness ≳ **63/255**. The baseline floor must respect this — verify with `GET /api/display/framebuffer` at bri 5 AND a normal brightness.
- **MCP test runner is `node:test`** (NOT vitest): `import { test } from "node:test"; import assert from "node:assert/strict";`, run `npx tsx --test <file>.test.ts`. Imports use `.ts` extension in tests, `.js` in `index.ts` source.
- **Hook live-copy sync:** `claude-hooks/*.py` have installed copies at `~/.claude/hooks/`. Edit BOTH.
- **Restore board state** (brightness + display) after any HTTP-driven verification.
- **Slider rule:** left=low/right=high; speed in fps-feel (1–5 maps to ms/frame).
- **Coordinate system:** `XY(x,y)=y*8+x` row-major; draw via `setPixel(x,y,CRGB)` (bounds-checked).
- **Mascot color:** Claude orange is `#ff6a14`; stays orange regardless of the sweep hue.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `esp32_matrix_webserver/anim_claudesweep.ino` | Perimeter sweep (decay/floor/head) + mini-Claude sprite (bob/blink) | **New** |
| `esp32_matrix_webserver/esp32_matrix_webserver.ino` | Dispatch branch in `loop()`; sweep color/speed globals | Modify |
| `esp32_matrix_webserver/api_handlers.ino` | `handleAnimation` parse for `claudesweep`; add it to known-anims; `transient` flag (skip auto-resume) | Modify |
| `esp32_matrix_webserver/settings.ino` | add `claudesweep` to `IDLE_APPS_DEFAULT` | Modify |
| `data/claudesweep.html` | Control page (color, speed, preview) | **New** |
| `data/index.html` | Card | Modify |
| `data/sketch.html` | Mini-Claude starter preset | Modify |
| `mcp_server/idle.ts` | add `claudesweep` to `IDLE_APPS` | Modify |
| `mcp_server/index.ts` | `matrix_set_animation` enum/description gains `claudesweep`; wait branch fires animation for firmware-anim entries | Modify |
| `mcp_server/wait.ts` | type-aware pool: `WAIT_ANIMATIONS` + `isWaitAnimation` | Modify |
| `mcp_server/wait.test.ts` | tests for the type-aware pool | Modify |
| `mcp_server/wait-weights.json` | weight for `claudesweep` | Modify |
| `claude-hooks/matrix_signal.py` (+ installed copy) | type-aware wait pool; launch `claudesweep` transient | Modify |

---

## Task 1: The `claudesweep` firmware animation

**Files:**
- Create: `esp32_matrix_webserver/anim_claudesweep.ino`
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (globals near the other anim color globals ~line 150; dispatch branch in `loop()` ~line 896)
- Modify: `esp32_matrix_webserver/api_handlers.ino` (`handleAnimation` parse; known-anims list ~line 138)

**Interfaces:**
- Consumes: `setPixel(int,int,CRGB)`, `leds`, `NUM_LEDS`, `fill_solid`, FastLED `nscale8`/`scale8`, `random()`, `animationName`, `animationSpeed`.
- Produces: globals `CRGB sweepColor; ` (in main ino); functions `void runClaudeSweepFrame();` and `void stepClaudeSweepFrame();` (the loop calls the `step*` variant — see dispatch).

- [ ] **Step 1: Add the sweep color global to the main ino**

In `esp32_matrix_webserver.ino`, near the other animation color globals (e.g. after `solidColor` ~line 150), add:

```cpp
CRGB sweepColor = CRGB(0xFF, 0xB0, 0x00);   // claudesweep border hue (amber CRT default)
```

(Keep the sprite/sweep *state* file-local in `anim_claudesweep.ino`; only this shared color global lives here, matching how `solidColor`/`cometColor1` live in the main ino.)

- [ ] **Step 2: Create `anim_claudesweep.ino`**

```cpp
// ============================================================
// SECTION: CLAUDESWEEP ANIMATION
// A single-color CRT/radar sweep around the 8x8 perimeter (dim baseline ->
// bright head -> fading comet tail, never off), with the orange Claude mascot
// centered inside the 1px border doing a 1px bob + eye-blink.
// Sweep uses the same per-pixel decay/floor trick as anim_comet.ino.
// ============================================================

// The 28 perimeter pixels as an ordered CLOCKWISE loop, starting top-left.
// Top row L->R (8), right col T->B (7), bottom row R->L (7), left col B->T (6).
static const uint8_t SWEEP_PERIM[28][2] = {
  {0,0},{1,0},{2,0},{3,0},{4,0},{5,0},{6,0},{7,0},          // top
  {7,1},{7,2},{7,3},{7,4},{7,5},{7,6},{7,7},                // right
  {6,7},{5,7},{4,7},{3,7},{2,7},{1,7},{0,7},                // bottom (R->L)
  {0,6},{0,5},{0,4},{0,3},{0,2},{0,1}                        // left (B->T)
};

// Per-pixel sweep brightness (0..255), decayed each frame toward the floor.
static uint8_t  sweepBri[28];
static uint8_t  sweepHead   = 0;       // current head index into SWEEP_PERIM
static bool     sweepInit   = false;

// Baseline floor: the ring never dims below this. Tuned so amber's GREEN channel
// still survives FastLED's global brightness 5 (see plan Global Constraints).
static const uint8_t SWEEP_FLOOR = 64;
// Per-frame decay multiplier for the tail (scale8: 200/256 ~= 0.78 -> a ~4-5px tail).
static const uint8_t SWEEP_DECAY = 200;

// ---- Mini Claude (6 wide x 5 tall) drawn in the 6x6 interior (board cols 1-6) ----
// '#' = lit (orange), '.' = off. Eyes are the gaps in row 2.
static const char* CLAUDE6_OPEN[5] = {
  ".####.",
  "######",
  "#.##.#",
  "######",
  "##..##"
};
// Blink frame: eyes closed (row 2 filled).
static const char* CLAUDE6_BLINK[5] = {
  ".####.",
  "######",
  "######",
  "######",
  "##..##"
};
static const CRGB CLAUDE_ORANGE = CRGB(0xFF, 0x6A, 0x14);

static uint32_t sweepFrameCount = 0;   // drives bob + blink cadence

static void drawMiniClaude() {
  // Bob: vertical offset toggles 0/1 every ~14 frames. Interior rows are 1..6,
  // so offset 0 -> sprite rows 1..5, offset 1 -> rows 2..6 (both inside the border).
  int bob = ((sweepFrameCount / 14) % 2);
  // Blink: closed for ~3 frames every ~40 frames.
  bool blink = (sweepFrameCount % 40) < 3;
  const char** spr = blink ? CLAUDE6_BLINK : CLAUDE6_OPEN;
  for (int sy = 0; sy < 5; sy++) {
    for (int sx = 0; sx < 6; sx++) {
      if (spr[sy][sx] == '#') setPixel(sx + 1, sy + 1 + bob, CLAUDE_ORANGE);
    }
  }
}

void stepClaudeSweepFrame() {
  if (!sweepInit) {
    for (int i = 0; i < 28; i++) sweepBri[i] = SWEEP_FLOOR;
    sweepHead = 0; sweepFrameCount = 0; sweepInit = true;
  }
  fill_solid(leds, NUM_LEDS, CRGB::Black);

  // Decay the whole ring toward 0, then advance + light the head.
  for (int i = 0; i < 28; i++) sweepBri[i] = scale8(sweepBri[i], SWEEP_DECAY);
  sweepHead = (sweepHead + 1) % 28;
  sweepBri[sweepHead] = 255;

  // Render the ring: floor each pixel so it never drops below the dim baseline.
  for (int i = 0; i < 28; i++) {
    uint8_t b = sweepBri[i] > SWEEP_FLOOR ? sweepBri[i] : SWEEP_FLOOR;
    CRGB c = sweepColor; c.nscale8(b);
    setPixel(SWEEP_PERIM[i][0], SWEEP_PERIM[i][1], c);
  }

  drawMiniClaude();
  sweepFrameCount++;
}
```

> The loop's dispatch calls `step*` for time-gated animations. `runClaudeSweepFrame()` is not needed (no separate run/step split here) — the dispatch uses `stepClaudeSweepFrame()`.

- [ ] **Step 3: Add the dispatch branch**

In `esp32_matrix_webserver.ino` `loop()`, in the `else if` animation chain (after `else if (animationName == "comet") runCometFrame();` ~line 890), add:

```cpp
    else if (animationName == "claudesweep") stepClaudeSweepFrame();
```

- [ ] **Step 4: Parse params in `handleAnimation` + register the type**

In `api_handlers.ino`, add `"claudesweep"` to the known-animations list (the string array ~line 136-138, append it after `"snow"`).

Then in `applyAnimationBody`/`handleAnimation`, where other types parse their params (the `if (animationName == "...") { ... }` chain), add a branch:

```cpp
  if (animationName == "claudesweep") {
    // color: sweep hue (default amber). speed: ms/frame (MCP maps 1-5 -> ms).
    if (!doc["color"].isNull()) sweepColor = hexToColor(doc["color"].as<String>());
    sweepInit = false;   // re-seed the ring on (re)launch
  }
```

> `sweepInit` is file-local `static` in `anim_claudesweep.ino`. Because `api_handlers.ino` concatenates BEFORE `anim_claudesweep.ino`... it would NOT be visible there. To re-seed on launch without a cross-file static, instead reset via a tiny non-static helper. Add this to `anim_claudesweep.ino`:
> ```cpp
> void resetClaudeSweep() { sweepInit = false; }
> ```
> and call `resetClaudeSweep();` (a function — auto-prototyped, so visible) from the `handleAnimation` branch instead of touching `sweepInit` directly. `animationSpeed` is already set by the shared speed-parse line in `handleAnimation` (the `doc["speed"] | 66` clamp), so the branch only handles `color` + the reset.

Corrected branch:

```cpp
  if (animationName == "claudesweep") {
    if (!doc["color"].isNull()) sweepColor = hexToColor(doc["color"].as<String>());
    resetClaudeSweep();   // re-seed the ring (function: visible across files)
  }
```

- [ ] **Step 5: Hardware verification (USER FLASHES)**

After **Sketch → Upload**, ask the user to:
1. `curl -X POST http://<ip>/api/display/animation -H "Content-Type: application/json" -d '{"type":"claudesweep"}'` — confirm: a bright amber head sweeps clockwise around the border leaving a fading tail to a dim amber baseline (never fully dark), with the orange Claude centered inside bobbing + blinking.
2. Set a normal brightness (`/api/brightness {level:40}`) AND ambient (`{level:5}`); confirm the baseline ring is still **visible (amber) at brightness 5** (not vanished, not pure red). If the green drops out at 5, raise `SWEEP_FLOOR` a few counts and reflash.
3. `curl ... -d '{"type":"claudesweep","color":"#33ff66"}'` — confirm the sweep recolors to green (Claude stays orange).
4. Read `GET /api/display/framebuffer` to confirm the perimeter gradient + the interior claude pixels render as expected. Restore prior brightness/display when done.

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/anim_claudesweep.ino esp32_matrix_webserver/esp32_matrix_webserver.ino esp32_matrix_webserver/api_handlers.ino
git commit -m "feat(fw): claudesweep animation — CRT/radar border sweep + resident Claude"
```

---

## Task 2: `transient` flag on `/api/display/animation` (skip auto-resume)

**Files:**
- Modify: `esp32_matrix_webserver/api_handlers.ino` (`handleAnimation`, the auto-resume persistence block ~line 436)

**Interfaces:**
- Consumes: the existing `handleAnimation` body parse.
- Produces: a `transient` body flag that, when true, skips the NVS auto-resume write — used by Task 6's wait launch.

- [ ] **Step 1: Generalize the persistence exemption**

The current code persists every animation except `presence`:
```cpp
  if (animationName != "presence") {
    resumeKind = "anim"; resumeBody = body; resumeDirty = true; resumeDirtyMs = millis();
  }
```
Replace it so a `transient:true` body ALSO skips persistence:
```cpp
  // Parse the body once more for the transient flag (cheap; body is small here).
  bool transientLaunch = false;
  {
    JsonDocument tdoc;
    if (deserializeJson(tdoc, body) == DeserializationError::Ok) transientLaunch = tdoc["transient"] | false;
  }
  if (animationName != "presence" && !transientLaunch) {
    resumeKind = "anim"; resumeBody = body; resumeDirty = true; resumeDirtyMs = millis();
  }
```

> If `applyAnimationBody` already holds a parsed `JsonDocument doc` in scope at this point, read `doc["transient"] | false` directly instead of re-parsing — check the function and prefer the existing doc. (Re-parse shown as the safe default since `applyAnimationBody` takes a `String body`.)

- [ ] **Step 2: Hardware verification (USER FLASHES)**

After **Sketch → Upload**:
1. `curl -X POST .../api/display/animation -d '{"type":"fire"}'` then **power-cycle** → board boots into fire (persisted). ✅ normal behavior intact.
2. `curl -X POST .../api/display/animation -d '{"type":"claudesweep","transient":true}'` then **power-cycle** → board boots into the PREVIOUS animation (fire), NOT claudesweep (transient skipped persistence). ✅
3. Restore display when done.

- [ ] **Step 3: Commit**

```bash
git add esp32_matrix_webserver/api_handlers.ino
git commit -m "feat(fw): transient flag on /api/display/animation (skip auto-resume)"
```

---

## Task 3: Idle screensaver lineup

**Files:**
- Modify: `esp32_matrix_webserver/settings.ino` (`IDLE_APPS_DEFAULT`)
- Modify: `mcp_server/idle.ts` (`IDLE_APPS`)

**Interfaces:**
- Consumes: the `claudesweep` animation type (Task 1).
- Produces: `claudesweep` as an idle-rotation candidate (firmware CSV + TS lineup, kept aligned).

- [ ] **Step 1: Add to the firmware idle CSV**

In `settings.ino`, append `claudesweep` to the default:
```cpp
static const char* IDLE_APPS_DEFAULT =
  "fire,matrix_rain,clock,fireworks,frostbite,snow,dancefloor,claudesweep";
```

> NOTE: this only changes the DEFAULT. A board with existing NVS already has the old CSV stored, so `idle_apps` won't pick up `claudesweep` until the user re-enables defaults or toggles it on the settings page. Call this out in verification.

- [ ] **Step 2: Add to the MCP idle lineup**

In `mcp_server/idle.ts` `IDLE_APPS`, add an entry (matching the existing shape):
```ts
  { type: "claudesweep", label: "🟠 claude sweep", params: {} },
```

- [ ] **Step 3: Hardware verification (USER)**

- The firmware default change needs a flash to take effect on a fresh NVS; on an existing board, set it via the settings page (the `claudesweep` checkbox appears once Task 4's web list includes it — see Task 4 note). To verify the rotation includes it now: on the settings page enable only `claudesweep` + one other, set short `idle_after`/`idle_rotate`, arm (`POST /api/idle/arm`), and confirm the screensaver rotates into `claudesweep` (check `GET /api/status`). Restore settings after.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/settings.ino mcp_server/idle.ts
git commit -m "feat: add claudesweep to the idle screensaver lineup"
```

---

## Task 4: Control page + index card + MCP enum

**Files:**
- Create: `esp32_matrix_webserver/data/claudesweep.html`
- Modify: `esp32_matrix_webserver/data/index.html` (card)
- Modify: `mcp_server/index.ts` (`matrix_set_animation` type enum + description; also add `claudesweep` to the settings.html app list per Task 3's note)
- Modify: `esp32_matrix_webserver/data/settings.html` (`APPS` array gains `claudesweep`)

**Interfaces:**
- Consumes: `POST /api/display/animation { type:"claudesweep", color, speed }`.
- Produces: a reachable control page + the MCP/roster registration.

- [ ] **Step 1: Create `data/claudesweep.html`**

Model on an existing single-animation control page (open `data/fire.html` or `data/snow.html` for the exact shared markup/style). The page needs: a title, a **color picker** (default `#ffb000`), a **speed slider** (1–5, left=slow), an optional live `<canvas>` preview, and a **Launch** button that POSTs. Minimal working version:

```html
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Sweep</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:16px}
  label{display:block;margin:12px 0 4px} input[type=range]{width:100%}
  button{background:#ffb000;color:#111;border:0;border-radius:8px;padding:12px 18px;font-size:1rem;font-weight:600;margin-top:14px}
  a{color:#9cf} #status{margin-left:10px;color:#7f7}
</style></head><body>
<p><a href="/">&larr; Back</a></p>
<h1>🟠 Claude Sweep</h1>
<p>A CRT/radar sweep around the border with Claude living inside.</p>
<label>Sweep color</label>
<input type="color" id="color" value="#ffb000">
<label>Speed <output id="spd_o"></output></label>
<input type="range" id="speed" min="1" max="5" value="2">
<button id="go">Launch ▶</button><span id="status"></span>
<script>
const $=id=>document.getElementById(id);
const so=$("spd_o"); const sync=()=>so.value=$("speed").value; $("speed").addEventListener("input",sync); sync();
$("go").addEventListener("click",async()=>{
  await fetch("/api/display/animation",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type:"claudesweep",color:$("color").value,speed:+$("speed").value})});
  $("status").textContent="Launched ✓"; setTimeout(()=>$("status").textContent="",1500);
});
</script></body></html>
```

> The firmware `speed` is ms/frame; this page posts the raw 1–5. Confirm how `data/snow.html` posts speed — if other pages post raw 1–5 and the firmware clamps `doc["speed"] | 66` to `[10,10000]`, a raw `2` would be 2ms→clamped to 10ms (too fast). To match the MCP's 1–5→ms mapping, have this page map before POST: `const MS={1:150,2:100,3:66,4:40,5:20}; ... speed: MS[+$("speed").value]`. Use that mapping in the POST body.

- [ ] **Step 2: Add the index card**

In `data/index.html`, inside the `<div class="apps">` block, add (matching the exact existing card markup):

```html
    <a href="/claudesweep.html" class="card">
      <span class="icon">🟠</span>
      <div class="name">Claude Sweep</div>
      <div class="desc">CRT/radar border sweep with Claude living inside</div>
    </a>
```

- [ ] **Step 3: Add `claudesweep` to the MCP animation enum + description**

In `mcp_server/index.ts`, the `matrix_set_animation` tool's `type` enum and description — add `claudesweep` to the enum array and a one-line description: `claudesweep: a CRT/radar sweep around the border with the Claude mascot inside. params: color (hex, default amber #ffb000), speed (1-5)`. The MCP's existing 1–5→ms speed mapping (`msMap`) already applies.

- [ ] **Step 4: Add `claudesweep` to the settings page app list**

In `data/settings.html`, add `"claudesweep"` to the `APPS` array so its idle-rotation checkbox renders.

- [ ] **Step 5: Hardware verification (USER UPLOADS LittleFS + reconnects MCP)**

After **LittleFS upload**: open `http://<ip>/` → Claude Sweep card present → page launches the animation with color + speed working. After **`/mcp` reconnect**: `matrix_set_animation type:claudesweep` works from Claude. Settings page shows a `claudesweep` idle checkbox.

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/data/claudesweep.html esp32_matrix_webserver/data/index.html esp32_matrix_webserver/data/settings.html mcp_server/index.ts
git commit -m "feat: claudesweep control page, index card, MCP enum, settings toggle"
```

---

## Task 5: Sketch-page mini-Claude stamp

**Files:**
- Modify: `esp32_matrix_webserver/data/sketch.html` (`KEY` + `STARTERS`)

**Interfaces:**
- Consumes: nothing.
- Produces: a "Claude" starter image in the freehand-draw picker.

- [ ] **Step 1: Add the mascot color + starter**

In `data/sketch.html`, add the mascot orange to `KEY` (the char map, ~line 224-230):
```js
      'a': '#ff6a14',
```
Then add a starter to the `STARTERS` array (~line 239), using the 8×8 mascot silhouette from `expressions/wait-claude.json`:
```js
      { name: 'Claude', rows: ["..aaaa..", ".aaaaaa.", ".a.aa.a.", "aaaaaaaa", ".aaaaaa.", ".aa..aa.", "........", "........"] },
```

- [ ] **Step 2: Hardware verification (USER UPLOADS LittleFS)**

After **LittleFS upload**: open `http://<ip>/sketch.html` → a **Claude** thumbnail appears in the starter images → clicking it loads the orange mascot onto the canvas, editable like the others.

- [ ] **Step 3: Commit**

```bash
git add esp32_matrix_webserver/data/sketch.html
git commit -m "feat(web): add Claude mascot starter to the sketch page"
```

---

## Task 6: Wait-pool type-aware integration

**Files:**
- Modify: `mcp_server/wait.ts` (`WAIT_ANIMATIONS`, `buildWaitPool`, `isWaitAnimation`)
- Modify: `mcp_server/wait.test.ts` (tests)
- Modify: `mcp_server/index.ts` (`matrix_express` "wait" branch fires animation for firmware-anim picks)
- Modify: `mcp_server/wait-weights.json` (weight)
- Modify: `claude-hooks/matrix_signal.py` (+ `~/.claude/hooks/` copy)

**Interfaces:**
- Consumes: `pickWait` (existing), `transient` flag (Task 2), `claudesweep` type (Task 1).
- Produces: `WAIT_ANIMATIONS: string[]`, `isWaitAnimation(name): boolean`; a `buildWaitPool` that includes firmware-animation entries.

- [ ] **Step 1: Write failing tests in `wait.test.ts`**

Append to `mcp_server/wait.test.ts` (node:test style):
```ts
import { WAIT_ANIMATIONS, isWaitAnimation, buildWaitPool } from "./wait.ts";

test("buildWaitPool includes firmware-animation entries", () => {
  const pool = buildWaitPool([]);
  assert.ok(pool.includes("claudesweep"), "claudesweep should be in the pool");
});

test("isWaitAnimation distinguishes firmware anims from expressions", () => {
  assert.equal(isWaitAnimation("claudesweep"), true);
  assert.equal(isWaitAnimation("working"), false);
  assert.equal(isWaitAnimation("wait-rainbow"), false);
});

test("WAIT_ANIMATIONS contains claudesweep", () => {
  assert.ok(WAIT_ANIMATIONS.includes("claudesweep"));
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd mcp_server && npx tsx --test wait.test.ts`
Expected: FAIL (no exports `WAIT_ANIMATIONS` / `isWaitAnimation`).

- [ ] **Step 3: Implement in `wait.ts`**

Add after `WAIT_PREFIX`:
```ts
// Firmware animations that join the wait pool. Unlike frame-expressions, when one
// of these is picked the caller fires POST /api/display/animation (transient) rather
// than pushing frames. Keep aligned with the firmware animation types.
export const WAIT_ANIMATIONS: string[] = ["claudesweep"];

export function isWaitAnimation(name: string): boolean {
  return WAIT_ANIMATIONS.includes(name);
}
```
Update `buildWaitPool` to include them:
```ts
export function buildWaitPool(savedNames: string[]): string[] {
  const matched = savedNames.filter((n) => n.startsWith(WAIT_PREFIX));
  return [...new Set([...WAIT_BUILTINS, ...WAIT_ANIMATIONS, ...matched])];
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd mcp_server && npx tsx --test wait.test.ts idle.test.ts settings.test.ts`
Expected: all green.

- [ ] **Step 5: Fire the animation in the MCP wait branch**

In `mcp_server/index.ts` `matrix_express` "wait" handling, after `exprName = await resolveWait();`, branch BEFORE the expression load:
```ts
        if (exprName === "wait") exprName = await resolveWait();
        if (isWaitAnimation(exprName)) {
          const r = await post("/api/display/animation", { type: exprName, transient: true });
          return { content: [{ type: "text", text: r.ok ? `Busy indicator: ${exprName} (transient animation).` : `Error ${r.status}: ${r.body}` }] };
        }
```
Add `isWaitAnimation` to the existing `./wait.js` import.

> Confirm `resolveWait()` builds its pool via `buildWaitPool` (so `claudesweep` is now a candidate). If `resolveWait` builds the pool another way, ensure it routes through `buildWaitPool` so the firmware-anim entries are included.

- [ ] **Step 6: Weight it in `wait-weights.json`**

Add a `claudesweep` weight to `mcp_server/wait-weights.json` (e.g. a moderate share like the others — match the existing scale; if the four current entries sum to ~100, give claudesweep ~25 and leave the rest, or set per the user's preference). Use:
```json
{ "weights": { "wait-claude": 30, "wait-rainbow": 25, "wait-orbit": 15, "working": 10, "claudesweep": 20 } }
```
(Read at runtime — retune freely later.)

- [ ] **Step 7: Mirror in `matrix_signal.py` (+ installed copy)**

In `claude-hooks/matrix_signal.py`: add the firmware-anim list and a launch + branch, then copy to `~/.claude/hooks/`.
```python
WAIT_ANIMATIONS = ["claudesweep"]   # firmware anims in the wait pool (not frame expressions)

def post_animation(anim_type, transient=True):
    """Best-effort POST /api/display/animation for a firmware-animation wait pick."""
    try:
        import urllib.request
        body = json.dumps({"type": anim_type, "transient": transient}).encode()
        req = urllib.request.Request(BOARD_URL + "/api/display/animation", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False
```
Update `build_wait_pool` to include them:
```python
def build_wait_pool():
    pool = list(WAIT_BUILTINS) + list(WAIT_ANIMATIONS)
    try:
        for fn in os.listdir(EXPR_DIR):
            if fn.startswith(WAIT_PREFIX) and fn.endswith(".json"):
                nm = fn[:-5]
                if nm not in pool:
                    pool.append(nm)
    except Exception:
        pass
    return pool
```
And branch in `send_wait`:
```python
def send_wait():
    name = pick_wait(build_wait_pool(), load_wait_weights())
    if name in WAIT_ANIMATIONS:
        if not post_animation(name):
            send_named("working")
    elif name in EXPR:
        send_named(name)
    elif not send_saved(name):
        send_named("working")
```
Then: `cp claude-hooks/matrix_signal.py ~/.claude/hooks/matrix_signal.py`.

- [ ] **Step 8: Build + reconnect + verify**

`cd mcp_server && npx tsc --noEmit` (clean) and `npx tsx --test wait.test.ts idle.test.ts settings.test.ts` (green). Then **`/mcp` reconnect**. Verify: calling `matrix_express("wait")` several times eventually fires `claudesweep` (transient animation) as well as the frame spinners; finishing a turn (UserPromptSubmit hook path) likewise sometimes shows the sweep. Power-cycle after a wait-sweep → board does NOT boot into claudesweep (transient). Restore board state.

- [ ] **Step 9: Commit**

```bash
git add mcp_server/wait.ts mcp_server/wait.test.ts mcp_server/index.ts mcp_server/wait-weights.json claude-hooks/matrix_signal.py
git commit -m "feat: claudesweep joins the wait rotation (type-aware pool + transient launch)"
```

---

## Task 7: Docs + version bump

**Files:**
- Modify: `CLAUDE.md` (animation roster note; the wait pool now includes a firmware-animation; `transient` flag in API surface)
- Run: `npm run bump:minor`

- [ ] **Step 1: Document**

In `CLAUDE.md`: add `claudesweep` to the animation context, note the **`transient`** flag on `POST /api/display/animation` (skips auto-resume; used by the wait role), and that the wait pool is now **type-aware** (frame-expressions + firmware animations like `claudesweep`). Add `transient?` to the `/api/display/animation` API row.

- [ ] **Step 2: Bump**

```bash
npm run bump:minor
```
(0.6.0 → 0.7.0; stamps version.h / data/version.json / mcp_server/package.json; commits `chore: bump v0.7.0`.)

- [ ] **Step 3: Deploy checklist (USER):** flash firmware, LittleFS upload, `/mcp` reconnect + hook copies already synced. Confirm `matrix_version` shows 0.7.0 no drift.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md
git commit -m "docs: claudesweep animation + transient flag + type-aware wait pool"
```

---

## Self-Review Notes

- **Spec coverage:** animation (sweep + claude) → Task 1; brightness-floor → Task 1 (`SWEEP_FLOOR` + verify at bri 5); transient flag → Task 2; idle lineup → Task 3; roster (control page + index + MCP enum) → Task 4; sketch preset → Task 5; type-aware wait pool → Task 6; docs/version → Task 7.
- **Single-TU ordering:** the only cross-file symbol from the new anim is `sweepColor` (placed in the MAIN ino) and the functions `stepClaudeSweepFrame`/`resetClaudeSweep` (auto-prototyped). The `handleAnimation` branch resets via the `resetClaudeSweep()` FUNCTION, not the file-local `sweepInit` static — avoids the v0.6 global-visibility trap.
- **Type consistency:** `claudesweep` is the type string everywhere (firmware dispatch, known-anims, idle CSV, idle.ts, MCP enum, WAIT_ANIMATIONS, settings APPS, wait-weights). `transient` is the body flag in firmware (Task 2) and both wait launchers (Task 6).
- **Build order / checkpoints:** Tasks 1–2 (+3 firmware half) flash together = firmware checkpoint A (verify the look at bri 5 + transient). Tasks 4–5 = LittleFS checkpoint B (control page, index, sketch). Tasks 3-TS + 6 + 7 = MCP/hook checkpoint C (reconnect + hook sync). Tasks 1 and 2 must land before 6 (wait launch needs both the animation and the transient flag).
- **Known deferral (unrelated):** the v0.6 `MCP_DIR` hardcoded-path cleanup lives in `matrix_signal.py` (touched here) but stays out of scope — do not change it.
