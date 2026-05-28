# Five New Animations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five new LED animations (Gradient Spiral, Gradient Starfield, Fireworks, Comet, Sun) with web UI cards, firmware frame functions, and MCP tool support.

**Architecture:** Three new `.ino` files alongside existing animation files; `handleAnimation()` and `loop()` extended to dispatch the new types; `animations.html` overhauled to use per-animation control panels; MCP tool schema updated with new types and params.

**Tech Stack:** Arduino C++ (FastLED, ArduinoJson), vanilla HTML/JS served from LittleFS, TypeScript MCP server.

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Create | `esp32_matrix_webserver/anim_gradient.ino` | Spiral, Starfield, Sun frame functions + globals |
| Create | `esp32_matrix_webserver/anim_comet.ino` | Comet frame function + globals |
| Create | `esp32_matrix_webserver/anim_fireworks.ino` | Fireworks frame function + globals |
| Modify | `esp32_matrix_webserver/esp32_matrix_webserver.ino` | New globals in §3, 5 new dispatch branches in loop() |
| Modify | `esp32_matrix_webserver/api_handlers.ino` | New init blocks in handleAnimation() |
| Modify | `esp32_matrix_webserver/data/animations.html` | 5 new cards, per-animation panels, updated JS |
| Modify | `mcp_server/index.ts` | Enum + params + description string |

---

## Task 1: Firmware Foundation — Globals, Dispatch, handleAnimation()

**Files:**
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino`
- Modify: `esp32_matrix_webserver/api_handlers.ino`

- [ ] **Step 1.1: Add new globals to esp32_matrix_webserver.ino**

Find the `// ── Liquid/IMU state` block (last block in SECTION 3) and insert after it:

```cpp
// ── Gradient Spiral ───────────────────────────────────────────
CRGB     spiralColor1   = CRGB(255,   0,   0);
CRGB     spiralColor2   = CRGB(  0,   0, 255);

// ── Gradient Starfield ────────────────────────────────────────
CRGB     starColor1     = CRGB(255, 255, 255);
CRGB     starColor2     = CRGB(  0, 100, 255);
uint8_t  starDensity    = 8;
bool     starInward     = false;

// ── Fireworks ─────────────────────────────────────────────────
CRGB     fwColor1       = CRGB(255,  50,   0);
CRGB     fwColor2       = CRGB(255, 200,   0);
CRGB     fwColor3       = CRGB(  0, 100, 255);

// ── Comet ─────────────────────────────────────────────────────
CRGB     cometColor1    = CRGB(255, 200,  50);
CRGB     cometColor2    = CRGB(255, 100,   0);
CRGB     cometColor3    = CRGB(150,  30,   0);

// ── Sun ───────────────────────────────────────────────────────
CRGB     sunColor1      = CRGB(255, 183,   0);
CRGB     sunColor2      = CRGB(255, 102,   0);
CRGB     sunColor3      = CRGB(255,  51,   0);
CRGB     sunColor4      = CRGB(204,  17,   0);
```

- [ ] **Step 1.2: Add dispatch branches to loop()**

Find the last `else if` in the animation dispatch block (currently `else if (animationName == "matrix_rain") stepMatrixFrame();`) and add after it:

```cpp
    else if (animationName == "spiral")    runSpiralFrame();
    else if (animationName == "starfield") runStarfieldFrame();
    else if (animationName == "fireworks") stepFireworksFrame();
    else if (animationName == "comet")     runCometFrame();
    else if (animationName == "sun")       runSunFrame();
```

- [ ] **Step 1.3: Add init blocks to handleAnimation() in api_handlers.ino**

Find `animationActive = true;` near the end of `handleAnimation()` (line ~212) and insert immediately before it:

```cpp
  if (animationName == "spiral") {
    const char* c1 = doc["color1"] | "#FF0000";
    const char* c2 = doc["color2"] | "#0000FF";
    spiralColor1 = hexToColor(String(c1));
    spiralColor2 = hexToColor(String(c2));
  }

  if (animationName == "starfield") {
    const char* c1 = doc["color1"] | "#FFFFFF";
    const char* c2 = doc["color2"] | "#0064FF";
    starColor1  = hexToColor(String(c1));
    starColor2  = hexToColor(String(c2));
    starDensity = constrain((int)(doc["density"] | 8), 1, 16);
    starInward  = (bool)(doc["inward"] | false);
  }

  if (animationName == "fireworks") {
    const char* c1 = doc["color1"] | "#FF3200";
    const char* c2 = doc["color2"] | "#FFC800";
    const char* c3 = doc["color3"] | "#0064FF";
    fwColor1 = hexToColor(String(c1));
    fwColor2 = hexToColor(String(c2));
    fwColor3 = hexToColor(String(c3));
  }

  if (animationName == "comet") {
    const char* c1 = doc["color1"] | "#FFC832";
    const char* c2 = doc["color2"] | "#FF6400";
    const char* c3 = doc["color3"] | "#961E00";
    cometColor1 = hexToColor(String(c1));
    cometColor2 = hexToColor(String(c2));
    cometColor3 = hexToColor(String(c3));
  }

  if (animationName == "sun") {
    const char* c1 = doc["color1"] | "#FFB700";
    const char* c2 = doc["color2"] | "#FF6600";
    const char* c3 = doc["color3"] | "#FF3300";
    const char* c4 = doc["color4"] | "#CC1100";
    sunColor1 = hexToColor(String(c1));
    sunColor2 = hexToColor(String(c2));
    sunColor3 = hexToColor(String(c3));
    sunColor4 = hexToColor(String(c4));
  }
```

- [ ] **Step 1.4: Compile in Arduino IDE — verify 0 errors**

Open `esp32_matrix_webserver.ino` in Arduino IDE and click Verify (✓). The new globals and dispatch branches reference functions that don't exist yet, so the IDE will report linker errors — that's expected. Check only for syntax errors in what you added.

Actually, Arduino IDE resolves forward references automatically since all `.ino` files compile together. The Verify will fail with "not declared" errors until the animation files are created. Proceed to Task 2.

- [ ] **Step 1.5: Commit**

```bash
git add esp32_matrix_webserver/esp32_matrix_webserver.ino esp32_matrix_webserver/api_handlers.ino
git commit -m "feat: add globals + dispatch scaffolding for 5 new animations"
```

---

## Task 2: Gradient Spiral

**Files:**
- Create: `esp32_matrix_webserver/anim_gradient.ino`

- [ ] **Step 2.1: Create anim_gradient.ino with Spiral implementation**

```cpp
// ============================================================
// SECTION: GRADIENT ANIMATIONS
// Gradient Spiral, Gradient Starfield, Sun
// ============================================================

// ── Gradient Spiral ───────────────────────────────────────────
// Pre-computes the 64-position clockwise inward spiral path at boot.
// Each frame slides a color gradient along that path — the whole board
// stays lit at all times, color1 chases color2 endlessly inward.

static int8_t  spiralPath[64][2];   // {x, y} for each of the 64 positions
static bool    spiralReady = false;
static uint8_t spiralPhase = 0;

void buildSpiralPath() {
  int idx = 0;
  int top = 0, bottom = 7, left_col = 0, right_col = 7;
  while (idx < 64) {
    for (int x = left_col; x <= right_col && idx < 64; x++) { spiralPath[idx][0]=x; spiralPath[idx][1]=top;    idx++; }
    top++;
    for (int y = top;  y <= bottom   && idx < 64; y++) { spiralPath[idx][0]=right_col; spiralPath[idx][1]=y;   idx++; }
    right_col--;
    for (int x = right_col; x >= left_col && idx < 64; x--) { spiralPath[idx][0]=x; spiralPath[idx][1]=bottom; idx++; }
    bottom--;
    for (int y = bottom; y >= top    && idx < 64; y--) { spiralPath[idx][0]=left_col; spiralPath[idx][1]=y;   idx++; }
    left_col++;
  }
}

// gradient slides: color1 head advances along spiral path each frame
void runSpiralFrame() {
  if (!spiralReady) { buildSpiralPath(); spiralReady = true; }
  for (int i = 0; i < 64; i++) {
    uint8_t t = (uint8_t)(((uint16_t)((i + 64 - spiralPhase) % 64) * 255) / 63);
    setPixel(spiralPath[i][0], spiralPath[i][1], blend(spiralColor1, spiralColor2, t));
  }
  spiralPhase = (spiralPhase + 1) % 64;
}
```

- [ ] **Step 2.2: Compile and flash**

Verify (✓) in Arduino IDE — expect 0 errors now that `runSpiralFrame()` is defined.
Flash to board (→ Upload button).

- [ ] **Step 2.3: Test spiral via curl**

```bash
curl -X POST http://esp32matrix.local/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"spiral","color1":"#FF0000","color2":"#0000FF","speed":66}'
```

Expected: Red-to-blue gradient flows continuously clockwise inward around the board. All 64 LEDs lit at all times. No flicker or clear between loops.

- [ ] **Step 2.4: Commit**

```bash
git add esp32_matrix_webserver/anim_gradient.ino
git commit -m "feat: gradient spiral animation"
```

---

## Task 3: Gradient Starfield

**Files:**
- Modify: `esp32_matrix_webserver/anim_gradient.ino`

- [ ] **Step 3.1: Add Starfield implementation to anim_gradient.ino**

Append after the Spiral section:

```cpp
// ── Gradient Starfield ────────────────────────────────────────
// Pool of star particles. Outward: born at center, die at edges.
// Inward: born at random edge pixel, die at center.
// Color lerps from starColor1 (birth) to starColor2 (death).

struct StarParticle {
  float   x, y;
  float   dx, dy;
  uint8_t age;
  uint8_t maxAge;
  uint8_t brightness;
  bool    active;
};

static StarParticle stars[16];
static bool starsInitialized = false;

static void spawnStar(StarParticle& s) {
  if (starInward) {
    uint8_t edge = random(4);
    if      (edge == 0) { s.x = (float)random(8); s.y = 0.0f; }
    else if (edge == 1) { s.x = 7.0f;              s.y = (float)random(8); }
    else if (edge == 2) { s.x = (float)random(8); s.y = 7.0f; }
    else                { s.x = 0.0f;              s.y = (float)random(8); }
    float cx = 3.5f - s.x, cy = 3.5f - s.y;
    float len = sqrt(cx * cx + cy * cy);
    if (len < 0.01f) len = 0.01f;
    float speed = 0.2f + random(3) * 0.08f;
    s.dx = cx / len * speed;
    s.dy = cy / len * speed;
  } else {
    s.x = 3.5f; s.y = 3.5f;
    float angle = random(360) * (PI / 180.0f);
    float speed = 0.15f + random(3) * 0.08f;
    s.dx = cos(angle) * speed;
    s.dy = sin(angle) * speed;
  }
  s.age        = starInward ? 0 : random(10);   // stagger ages on first spawn
  s.maxAge     = 25 + random(20);
  s.brightness = 80 + random(175);
  s.active     = true;
}

void runStarfieldFrame() {
  fill_solid(leds, NUM_LEDS, CRGB::Black);

  uint8_t count = min((uint8_t)starDensity, (uint8_t)16);
  for (uint8_t i = 0; i < count; i++) {
    StarParticle& s = stars[i];
    if (!starsInitialized || !s.active || s.age >= s.maxAge) { spawnStar(s); }

    s.x   += s.dx;
    s.y   += s.dy;
    s.age++;

    bool offScreen = (s.x < 0 || s.x > 7 || s.y < 0 || s.y > 7);
    bool atCenter  = starInward && (fabsf(s.x - 3.5f) < 0.7f && fabsf(s.y - 3.5f) < 0.7f);
    if (offScreen || atCenter) { spawnStar(s); continue; }

    uint8_t t = (uint8_t)(((uint16_t)s.age * 255) / s.maxAge);
    CRGB c    = blend(starColor1, starColor2, t);
    c.nscale8(s.brightness);
    setPixel((int)s.x, (int)s.y, c);
  }
  starsInitialized = true;
}
```

- [ ] **Step 3.2: Compile and flash**

Verify (✓) in Arduino IDE — expect 0 errors. Upload.

- [ ] **Step 3.3: Test starfield outward**

```bash
curl -X POST http://esp32matrix.local/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"starfield","color1":"#FFFFFF","color2":"#0064FF","density":8,"inward":false,"speed":50}'
```

Expected: White stars born at center, radiate outward, fade to blue near edges. Random brightness variation visible.

- [ ] **Step 3.4: Test starfield inward**

```bash
curl -X POST http://esp32matrix.local/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"starfield","color1":"#FF8800","color2":"#FFFF00","density":10,"inward":true,"speed":50}'
```

Expected: Stars appear at edges and travel inward, dying at center.

- [ ] **Step 3.5: Commit**

```bash
git add esp32_matrix_webserver/anim_gradient.ino
git commit -m "feat: gradient starfield animation (outward + inward)"
```

---

## Task 4: Sun

**Files:**
- Modify: `esp32_matrix_webserver/anim_gradient.ino`

The sun shape is sourced directly from the existing `drawSunIcon()` in `weather.ino`:
- **Core:** 4×4 disc at rows 2–5, cols 2–5, with the 4 corner pixels blacked out = 12 pixels, colored `sunColor1`
- **Ring:** 8 ray positions `bx[]={3,6,7,6,4,1,0,1}`, `by[]={0,1,3,6,7,6,4,1}` — a 5-pixel arc spins around them

- [ ] **Step 4.1: Add Sun implementation to anim_gradient.ino**

Append after the Starfield section:

```cpp
// ── Sun ───────────────────────────────────────────────────────
// Core shape matches drawSunIcon() in weather.ino exactly.
// sunColor1 = core disc. sunColor2/3/4 = spinning ring arc (head → tail).
// Ring uses the same 8 ray positions as the weather sun animation.

static uint8_t sunRingSlot = 0;   // active (brightest) ray index, advances each frame

static const int8_t SUN_BX[8] = {3, 6, 7, 6, 4, 1, 0, 1};
static const int8_t SUN_BY[8] = {0, 1, 3, 6, 7, 6, 4, 1};

void runSunFrame() {
  fill_solid(leds, NUM_LEDS, CRGB::Black);

  // Core disc: 4×4 minus corners
  for (int y = 2; y <= 5; y++)
    for (int x = 2; x <= 5; x++)
      setPixel(x, y, sunColor1);
  setPixel(2, 2, CRGB::Black); setPixel(5, 2, CRGB::Black);
  setPixel(2, 5, CRGB::Black); setPixel(5, 5, CRGB::Black);

  // Spinning arc: head=color2, mid=color3, tail=color4
  for (int i = 0; i < 8; i++) {
    int d = (i - (int)sunRingSlot + 8) % 8;
    if      (d == 0)             setPixel(SUN_BX[i], SUN_BY[i], sunColor2);
    else if (d == 1 || d == 7)   setPixel(SUN_BX[i], SUN_BY[i], sunColor3);
    else if (d == 2 || d == 6)   { CRGB c = sunColor4; c.nscale8(120); setPixel(SUN_BX[i], SUN_BY[i], c); }
    // d 3,4,5 → off
  }

  sunRingSlot = (sunRingSlot + 1) % 8;
}
```

- [ ] **Step 4.2: Compile and flash**

Verify (✓) in Arduino IDE — expect 0 errors. Upload.

- [ ] **Step 4.3: Test Sun**

```bash
curl -X POST http://esp32matrix.local/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"sun","color1":"#FFB700","color2":"#FF6600","color3":"#FF3300","color4":"#CC1100","speed":100}'
```

Expected: Amber 12-pixel disc in center with a 3-pixel arc spinning clockwise around the 8 ray positions. Arc head is color2 (brightest), fading through color3 and color4.

- [ ] **Step 4.4: Commit**

```bash
git add esp32_matrix_webserver/anim_gradient.ino
git commit -m "feat: sun animation with spinning gradient ring"
```

---

## Task 5: Comet

**Files:**
- Create: `esp32_matrix_webserver/anim_comet.ino`

The comet heart is fixed at x=6–7, right edge of board. It bobs ±2px via sine wave. The 6 tail columns (x=2–5) follow using a Y-history ring buffer — each column samples a progressively older Y value, producing the tadpole ripple. Sparks spawn occasionally at the head and fly leftward.

- [ ] **Step 5.1: Create anim_comet.ino**

```cpp
// ============================================================
// SECTION: COMET ANIMATION
// Bobbing comet at the right edge with wave tail and sparks.
// ============================================================

struct CometSpark {
  float   x, y;
  float   dx, dy;
  uint8_t brightness;
  bool    active;
};

static float      cometYHist[8]   = {3,3,3,3,3,3,3,3};
static uint8_t    cometHistIdx    = 0;
static float      cometPhase      = 0.0f;
static CometSpark cometSparks[6];
static bool       cometInit       = false;

// Returns the cometY from `n` frames ago (0 = most recent stored value)
static float cometGetHistY(int n) {
  return cometYHist[(cometHistIdx + 16 - 1 - n) % 8];
}

// Draws one tail column: x col, history depth, row span relative to histY, color, brightness
static void drawCometCol(int x, int histN, int rowOff, int rowCount, CRGB color, uint8_t bri) {
  int baseY = (int)cometGetHistY(histN);
  CRGB c = color; c.nscale8(bri);
  for (int r = baseY + rowOff; r < baseY + rowOff + rowCount; r++)
    setPixel(x, r, c);
}

void runCometFrame() {
  if (!cometInit) {
    for (int i = 0; i < 6; i++) cometSparks[i].active = false;
    cometInit = true;
  }

  fill_solid(leds, NUM_LEDS, CRGB::Black);

  // Advance bob: ±2px around row 3
  cometPhase += 0.10f;
  float cY = 3.0f + sinf(cometPhase) * 2.0f;

  // Store in ring buffer, then increment index
  cometYHist[cometHistIdx] = cY;
  cometHistIdx = (cometHistIdx + 1) % 8;

  int iy = (int)cY;

  // Heart: 2×2 at x=6-7, rows iy and iy+1 — color1, full brightness
  setPixel(6, iy,   cometColor1); setPixel(7, iy,   cometColor1);
  setPixel(6, iy+1, cometColor1); setPixel(7, iy+1, cometColor1);

  // Tail columns, each using progressively older Y history
  // x=5: 4 rows (-1 to +2 relative to histY), color2 75%
  drawCometCol(5, 1, -1, 4, cometColor2, 192);
  // x=4: 3 rows (0 to +2), color2 55%
  drawCometCol(4, 2,  0, 3, cometColor2, 140);
  // x=3: 2 rows (0 to +1), color3 40%
  drawCometCol(3, 3,  0, 2, cometColor3, 102);
  // x=2: 1 row (+1 = heart center row), color3 25%
  drawCometCol(2, 4,  1, 1, cometColor3,  64);

  // Sparks: ~5% chance per frame
  if (random(20) == 0) {
    for (int s = 0; s < 6; s++) {
      if (!cometSparks[s].active) {
        cometSparks[s].x          = 5.0f;
        cometSparks[s].y          = cY + (float)random(2);
        cometSparks[s].dx         = -(0.4f + random(4) * 0.15f);
        cometSparks[s].dy         = (float)(random(5) - 2) * 0.15f;
        cometSparks[s].brightness = 220;
        cometSparks[s].active     = true;
        break;
      }
    }
  }
  for (int s = 0; s < 6; s++) {
    CometSpark& sp = cometSparks[s];
    if (!sp.active) continue;
    sp.x += sp.dx;
    sp.y += sp.dy;
    if (sp.brightness > 35) sp.brightness -= 35; else { sp.active = false; continue; }
    if (sp.x < 0 || sp.y < 0 || sp.y > 7) { sp.active = false; continue; }
    CRGB c = cometColor3; c.nscale8(sp.brightness);
    setPixel((int)sp.x, (int)sp.y, c);
  }
}
```

- [ ] **Step 5.2: Compile and flash**

Verify (✓) in Arduino IDE — expect 0 errors. Upload.

- [ ] **Step 5.3: Test comet**

```bash
curl -X POST http://esp32matrix.local/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"comet","color1":"#FFC832","color2":"#FF6400","color3":"#961E00","speed":50}'
```

Expected: Comet heart (2×2) at right edge bobs up and down. Tail follows with a ripple delay — looks like a tadpole swimming. Occasional dim sparks fly leftward from the head. Black space on x=0–1.

- [ ] **Step 5.4: Commit**

```bash
git add esp32_matrix_webserver/anim_comet.ino
git commit -m "feat: comet animation with wave tail and sparks"
```

---

## Task 6: Fireworks

**Files:**
- Create: `esp32_matrix_webserver/anim_fireworks.ino`

Single firework loop. Four-phase state machine: IDLE → LAUNCH → EXPLODE → FADE. Mortar is white, explodes at a random height between rows 2–5. Tendrils fade through color1 → color2 → color3 → black based on their `brightness` value counting down from 255.

- [ ] **Step 6.1: Create anim_fireworks.ino**

```cpp
// ============================================================
// SECTION: FIREWORKS ANIMATION
// Single firework loop: white mortar → colorful radial burst → fade.
// ============================================================

enum FwPhase : uint8_t { FW_IDLE, FW_LAUNCH, FW_EXPLODE, FW_FADE };

struct FwTendril {
  float   x, y;
  float   dx, dy;
  uint8_t brightness;
  bool    active;
};

static FwPhase   fwPhase         = FW_IDLE;
static uint32_t  fwIdleStartMs   = 0;
static float     fwMortarX, fwMortarY;
static float     fwMortarDx, fwMortarDy;
static uint8_t   fwExplodeY;
static uint8_t   fwFlashFrames   = 0;
static FwTendril fwTendrils[12];

// Map brightness (255→0) to a color cycling color1→color2→color3→black
static CRGB fwTendrilColor(uint8_t bri) {
  if (bri > 170) return blend(fwColor2, fwColor1, (uint8_t)map(bri, 170, 255, 0, 255));
  if (bri >  85) return blend(fwColor3, fwColor2, (uint8_t)map(bri,  85, 170, 0, 255));
  return blend(CRGB::Black, fwColor3,  (uint8_t)map(bri,   0,  85, 0, 255));
}

void stepFireworksFrame() {
  fill_solid(leds, NUM_LEDS, CRGB::Black);

  if (fwPhase == FW_IDLE) {
    if (millis() - fwIdleStartMs >= 700) {
      fwMortarX  = (float)(2 + random(5));    // cols 2-6
      fwMortarY  = 7.0f;
      fwMortarDx = (float)(random(3) - 1) * 0.25f;
      fwMortarDy = -(0.8f + random(5) * 0.08f);
      fwExplodeY = 2 + random(4);             // explodes rows 2-5
      fwPhase    = FW_LAUNCH;
    }
    return;
  }

  if (fwPhase == FW_LAUNCH) {
    fwMortarX += fwMortarDx;
    fwMortarY += fwMortarDy;
    if ((int)fwMortarY <= (int)fwExplodeY) {
      // Spawn tendrils
      for (int i = 0; i < 12; i++) {
        float angle = i * (2.0f * PI / 12.0f) + random(30) * (PI / 180.0f);
        float speed = 0.35f + random(4) * 0.08f;
        fwTendrils[i] = { fwMortarX, fwMortarY, cosf(angle)*speed, sinf(angle)*speed, 255, true };
      }
      fwFlashFrames = 2;
      fwPhase = FW_EXPLODE;
    } else {
      setPixel((int)fwMortarX, (int)fwMortarY, CRGB::White);
    }
    return;
  }

  if (fwPhase == FW_EXPLODE) {
    setPixel((int)fwMortarX, (int)fwMortarY, fwColor1);
    if (--fwFlashFrames == 0) fwPhase = FW_FADE;
    return;
  }

  // FW_FADE
  bool anyActive = false;
  for (int i = 0; i < 12; i++) {
    FwTendril& t = fwTendrils[i];
    if (!t.active) continue;
    anyActive = true;
    t.x += t.dx;
    t.y += t.dy;
    if (t.brightness > 12) t.brightness -= 12; else { t.active = false; continue; }
    if (t.x < 0 || t.x > 7 || t.y < 0 || t.y > 7) { t.active = false; continue; }
    setPixel((int)t.x, (int)t.y, fwTendrilColor(t.brightness));
  }
  if (!anyActive) {
    fwPhase       = FW_IDLE;
    fwIdleStartMs = millis();
  }
}
```

- [ ] **Step 6.2: Compile and flash**

Verify (✓) in Arduino IDE — expect 0 errors. Upload.

- [ ] **Step 6.3: Test fireworks**

```bash
curl -X POST http://esp32matrix.local/api/display/animation \
  -H "Content-Type: application/json" \
  -d '{"type":"fireworks","color1":"#FF3200","color2":"#FFC800","color3":"#0064FF","speed":40}'
```

Expected: White pixel launches from bottom (random column), travels upward, explodes in a brief color1 flash, then 12 tendrils radiate outward cycling through color1 → color2 → color3 → black. Repeats after ~0.7s pause.

Tune brightness fade rate (12 per frame) if tendrils disappear too fast or too slow — adjust the `12` in `t.brightness -= 12` and `t.brightness > 12`.

- [ ] **Step 6.4: Commit**

```bash
git add esp32_matrix_webserver/anim_fireworks.ino
git commit -m "feat: fireworks animation — mortar + radial burst + fade"
```

---

## Task 7: Web UI — animations.html Overhaul

**Files:**
- Modify: `esp32_matrix_webserver/data/animations.html`

Replace the entire file. The key structural changes:
- 5 new animation cards added to the grid
- The single `#color-group` panel replaced with 7 per-animation `<div class="anim-panel">` sections
- `applyAnimation()` replaced with `buildPayload()` + updated `applyAnimation()`
- Sun preset grid added (clock-style)

- [ ] **Step 7.1: Replace animations.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Animations</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0d0d0d; color: #e0e0e0; min-height: 100vh; padding: 20px; }
    .wrap { max-width: 760px; margin: 0 auto; }
    .back { color: #555; text-decoration: none; font-size: 0.85rem; display: inline-block; margin-bottom: 16px; }
    .back:hover { color: #999; }
    h1 { font-size: 1.3rem; color: #cc88ff; margin-bottom: 24px; }
    .anim-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 24px; }
    .anim-card { background: #161616; border: 2px solid #2a2a2a; border-radius: 12px; padding: 14px; cursor: pointer; transition: border-color 0.15s; }
    .anim-card:hover { border-color: #3a3a3a; }
    .anim-card.selected { border-color: #cc88ff; background: #180e28; }
    .anim-card .icon { font-size: 1.8rem; display: block; margin-bottom: 6px; }
    .anim-card .name { font-weight: 600; font-size: 0.85rem; margin-bottom: 3px; }
    .anim-card .desc { font-size: 0.68rem; color: #666; line-height: 1.4; }
    .panel { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px; }
    .panel-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin-bottom: 16px; }
    .group { margin-bottom: 18px; }
    .group label { display: block; font-size: 0.75rem; color: #777; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 8px; }
    .slider-row { display: flex; align-items: center; gap: 12px; }
    input[type=range] { flex: 1; accent-color: #cc88ff; cursor: pointer; }
    .color-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .picker-group { display: flex; flex-direction: column; gap: 5px; }
    .picker-group label { font-size: 0.68rem; color: #666; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 0; }
    input[type=color] { width: 44px; height: 32px; border: 1px solid #333; border-radius: 6px; background: none; cursor: pointer; padding: 2px; }
    .toggle-row { display: flex; align-items: center; gap: 10px; }
    input[type=checkbox] { accent-color: #cc88ff; width: 16px; height: 16px; cursor: pointer; }
    .anim-panel { display: none; }
    .anim-panel.visible { display: block; }
    .presets-label { font-size: 0.68rem; color: #555; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .presets-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 16px; }
    .preset-swatch { aspect-ratio: 1; border-radius: 6px; border: 2px solid rgba(255,255,255,0.06); cursor: pointer; transition: transform .1s; }
    .preset-swatch:hover { transform: scale(1.1); }
    .preset-swatch.active { outline: 2px solid #fff; outline-offset: 2px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
    .btn-primary { background: #270a44; color: #cc88ff; border: 1px solid #4a1a77; border-radius: 7px; padding: 10px 22px; cursor: pointer; font-size: 0.9rem; font-weight: 600; transition: background 0.12s; }
    .btn-primary:hover { background: #30105a; }
    .btn-secondary { background: #1a1a1a; color: #aaa; border: 1px solid #333; border-radius: 7px; padding: 10px 18px; cursor: pointer; font-size: 0.85rem; }
    .btn-secondary:hover { background: #222; }
    .status { font-size: 0.78rem; margin-top: 14px; min-height: 1.2em; color: #00cc66; }
    .status.err { color: #ff5555; }
  </style>
</head>
<body>
  <div class="wrap">
  <a href="/" class="back">← Home</a>
  <h1>🌈 Animations</h1>

  <div class="anim-grid">
    <div class="anim-card selected" data-type="rainbow" onclick="selectAnim(this)">
      <span class="icon">🌈</span>
      <div class="name">Rainbow</div>
      <div class="desc">Cycles through all hues</div>
    </div>
    <div class="anim-card" data-type="breathe" onclick="selectAnim(this)">
      <span class="icon">💨</span>
      <div class="name">Breathe</div>
      <div class="desc">Slow pulsing glow</div>
    </div>
    <div class="anim-card" data-type="wave" onclick="selectAnim(this)">
      <span class="icon">🌊</span>
      <div class="name">Wave</div>
      <div class="desc">Rising blue columns</div>
    </div>
    <div class="anim-card" data-type="solid" onclick="selectAnim(this)">
      <span class="icon">⬛</span>
      <div class="name">Solid</div>
      <div class="desc">Single fill color</div>
    </div>
    <div class="anim-card" data-type="spiral" onclick="selectAnim(this)">
      <span class="icon">🌀</span>
      <div class="name">Spiral</div>
      <div class="desc">Gradient snake spirals inward</div>
    </div>
    <div class="anim-card" data-type="starfield" onclick="selectAnim(this)">
      <span class="icon">✨</span>
      <div class="name">Starfield</div>
      <div class="desc">Stars radiate from center</div>
    </div>
    <div class="anim-card" data-type="fireworks" onclick="selectAnim(this)">
      <span class="icon">🎆</span>
      <div class="name">Fireworks</div>
      <div class="desc">Mortar + radial burst</div>
    </div>
    <div class="anim-card" data-type="comet" onclick="selectAnim(this)">
      <span class="icon">☄️</span>
      <div class="name">Comet</div>
      <div class="desc">Bobbing comet with wave tail</div>
    </div>
    <div class="anim-card" data-type="sun" onclick="selectAnim(this)">
      <span class="icon">☀️</span>
      <div class="name">Sun</div>
      <div class="desc">Spinning gradient ring</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Settings</div>

    <div class="group">
      <label>Speed — <span id="v-speed">15</span> fps</label>
      <div class="slider-row">
        <input type="range" id="speed" min="20" max="200" value="66" oninput="updateSpeed(this.value)">
      </div>
    </div>

    <!-- Panel: breathe + solid -->
    <div class="anim-panel" id="panel-color">
      <div class="group">
        <label>Color</label>
        <div class="color-row">
          <input type="color" id="color" value="#0064ff">
        </div>
      </div>
    </div>

    <!-- Panel: spiral -->
    <div class="anim-panel" id="panel-spiral">
      <div class="group">
        <label>Colors</label>
        <div class="color-row">
          <div class="picker-group"><label>Start</label><input type="color" id="spiral-c1" value="#ff0000"></div>
          <div class="picker-group"><label>End</label><input type="color" id="spiral-c2" value="#0000ff"></div>
        </div>
      </div>
    </div>

    <!-- Panel: starfield -->
    <div class="anim-panel" id="panel-starfield">
      <div class="group">
        <label>Colors</label>
        <div class="color-row">
          <div class="picker-group"><label>Birth</label><input type="color" id="star-c1" value="#ffffff"></div>
          <div class="picker-group"><label>Death</label><input type="color" id="star-c2" value="#0064ff"></div>
        </div>
      </div>
      <div class="group">
        <label>Density — <span id="v-density">8</span> stars</label>
        <div class="slider-row">
          <input type="range" id="star-density" min="1" max="16" value="8" oninput="document.getElementById('v-density').textContent=this.value">
        </div>
      </div>
      <div class="group">
        <label>Direction</label>
        <div class="toggle-row">
          <input type="checkbox" id="star-inward">
          <span style="font-size:0.8rem;color:#888">Inward (fall toward center)</span>
        </div>
      </div>
    </div>

    <!-- Panel: fireworks -->
    <div class="anim-panel" id="panel-fireworks">
      <div class="group">
        <label>Explosion Palette</label>
        <div class="color-row">
          <div class="picker-group"><label>Color 1</label><input type="color" id="fw-c1" value="#ff3200"></div>
          <div class="picker-group"><label>Color 2</label><input type="color" id="fw-c2" value="#ffc800"></div>
          <div class="picker-group"><label>Color 3</label><input type="color" id="fw-c3" value="#0064ff"></div>
        </div>
      </div>
    </div>

    <!-- Panel: comet -->
    <div class="anim-panel" id="panel-comet">
      <div class="group">
        <label>Colors</label>
        <div class="color-row">
          <div class="picker-group"><label>Heart</label><input type="color" id="comet-c1" value="#ffc832"></div>
          <div class="picker-group"><label>Shell</label><input type="color" id="comet-c2" value="#ff6400"></div>
          <div class="picker-group"><label>Tail</label><input type="color" id="comet-c3" value="#961e00"></div>
        </div>
      </div>
    </div>

    <!-- Panel: sun -->
    <div class="anim-panel" id="panel-sun">
      <div class="group">
        <div class="presets-label">Color Presets</div>
        <div class="presets-grid" id="sun-presets"></div>
        <label style="margin-top:12px">Colors</label>
        <div class="color-row" style="margin-top:8px">
          <div class="picker-group"><label>Sun</label><input type="color" id="sun-c1" value="#ffb700" oninput="clearSunPreset()"></div>
          <div class="picker-group"><label>Ring 1</label><input type="color" id="sun-c2" value="#ff6600" oninput="clearSunPreset()"></div>
          <div class="picker-group"><label>Ring 2</label><input type="color" id="sun-c3" value="#ff3300" oninput="clearSunPreset()"></div>
          <div class="picker-group"><label>Ring 3</label><input type="color" id="sun-c4" value="#cc1100" oninput="clearSunPreset()"></div>
        </div>
      </div>
    </div>

    <div class="actions">
      <button class="btn-primary"   onclick="applyAnimation()">Apply to Display</button>
      <button class="btn-secondary" onclick="clearDisplay()">Stop / Clear</button>
    </div>
    <div class="status" id="status"></div>
  </div>

  <script>
    const SUN_PRESETS = [
      { name: 'Solar',   c1: '#ffb700', c2: '#ff6600', c3: '#ff3300', c4: '#cc1100' },
      { name: 'Arctic',  c1: '#ffffff', c2: '#88ddff', c3: '#4499ff', c4: '#0055cc' },
      { name: 'Twilight',c1: '#ff99ff', c2: '#cc44ff', c3: '#9900cc', c4: '#550088' },
      { name: 'Neon',    c1: '#aaffaa', c2: '#00ff44', c3: '#00cc22', c4: '#005511' },
      { name: 'Lava',    c1: '#ffff00', c2: '#ff4400', c3: '#cc0000', c4: '#660000' },
    ];

    // Panel IDs for each animation type
    const PANEL_MAP = {
      breathe: 'panel-color', solid: 'panel-color',
      spiral: 'panel-spiral', starfield: 'panel-starfield',
      fireworks: 'panel-fireworks', comet: 'panel-comet', sun: 'panel-sun',
    };

    let selectedType = 'rainbow';

    // Build sun preset swatches
    const presetsEl = document.getElementById('sun-presets');
    SUN_PRESETS.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'preset-swatch' + (i === 0 ? ' active' : '');
      el.title = p.name;
      el.style.background = `linear-gradient(135deg, ${p.c1} 40%, ${p.c2} 70%, ${p.c3})`;
      el.onclick = () => applySunPreset(i);
      presetsEl.appendChild(el);
    });

    function applySunPreset(i) {
      const p = SUN_PRESETS[i];
      document.getElementById('sun-c1').value = p.c1;
      document.getElementById('sun-c2').value = p.c2;
      document.getElementById('sun-c3').value = p.c3;
      document.getElementById('sun-c4').value = p.c4;
      presetsEl.querySelectorAll('.preset-swatch').forEach((el, j) =>
        el.classList.toggle('active', j === i));
    }

    function clearSunPreset() {
      presetsEl.querySelectorAll('.preset-swatch').forEach(el => el.classList.remove('active'));
    }

    function selectAnim(card) {
      document.querySelectorAll('.anim-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedType = card.dataset.type;
      // Hide all panels, show the right one
      document.querySelectorAll('.anim-panel').forEach(p => p.classList.remove('visible'));
      const panelId = PANEL_MAP[selectedType];
      if (panelId) document.getElementById(panelId).classList.add('visible');
    }

    function updateSpeed(val) {
      document.getElementById('v-speed').textContent = Math.round(1000 / val);
    }

    function buildPayload() {
      const speed = +document.getElementById('speed').value;
      const body  = { type: selectedType, speed };
      if (selectedType === 'breathe' || selectedType === 'solid') {
        body.color  = document.getElementById('color').value;
      } else if (selectedType === 'spiral') {
        body.color1 = document.getElementById('spiral-c1').value;
        body.color2 = document.getElementById('spiral-c2').value;
      } else if (selectedType === 'starfield') {
        body.color1   = document.getElementById('star-c1').value;
        body.color2   = document.getElementById('star-c2').value;
        body.density  = +document.getElementById('star-density').value;
        body.inward   = document.getElementById('star-inward').checked;
      } else if (selectedType === 'fireworks') {
        body.color1 = document.getElementById('fw-c1').value;
        body.color2 = document.getElementById('fw-c2').value;
        body.color3 = document.getElementById('fw-c3').value;
      } else if (selectedType === 'comet') {
        body.color1 = document.getElementById('comet-c1').value;
        body.color2 = document.getElementById('comet-c2').value;
        body.color3 = document.getElementById('comet-c3').value;
      } else if (selectedType === 'sun') {
        body.color1 = document.getElementById('sun-c1').value;
        body.color2 = document.getElementById('sun-c2').value;
        body.color3 = document.getElementById('sun-c3').value;
        body.color4 = document.getElementById('sun-c4').value;
      }
      return body;
    }

    function setStatus(msg, isErr) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status' + (isErr ? ' err' : '');
    }

    async function applyAnimation() {
      try {
        const r = await fetch('/api/display/animation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload())
        });
        setStatus(r.ok ? '✓ Running: ' + selectedType : 'Error: HTTP ' + r.status, !r.ok);
      } catch {
        setStatus('Cannot reach board — check WiFi connection.', true);
      }
    }

    async function clearDisplay() {
      try {
        const r = await fetch('/api/display/clear', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        setStatus(r.ok ? 'Display cleared.' : 'Error: HTTP ' + r.status, !r.ok);
      } catch {
        setStatus('Cannot reach board — check WiFi connection.', true);
      }
    }
  </script>
  </div>
</body>
</html>
```

- [ ] **Step 7.2: Upload web files to the board**

Arduino IDE → Tools → **ESP32 LittleFS Data Upload**

Wait for "Done uploading" in the output pane.

- [ ] **Step 7.3: Test all animations via browser**

Open `http://esp32matrix.local/animations.html`. Verify:
- All 9 cards appear in the grid
- Selecting Rainbow/Breathe/Wave/Solid still works (no regression)
- Selecting Breathe or Solid shows the single color picker panel
- Selecting Spiral shows Start + End pickers
- Selecting Starfield shows 2 pickers + density slider + inward toggle
- Selecting Fireworks shows 3 pickers
- Selecting Comet shows 3 pickers (Heart / Shell / Tail)
- Selecting Sun shows 4 pickers + 5 preset swatches; clicking a preset populates pickers
- Apply button triggers the animation on the board with the selected colors

- [ ] **Step 7.4: Commit**

```bash
git add esp32_matrix_webserver/data/animations.html
git commit -m "feat: animations.html — 5 new cards + per-animation control panels"
```

---

## Task 8: MCP Server Updates

**Files:**
- Modify: `mcp_server/index.ts`

- [ ] **Step 8.1: Add new types to the enum**

Find:
```typescript
enum: [
  "fire", "rainbow", "breathe", "wave", "solid",
  "liquid", "imu", "chiptemp", "weather",
  "timer_fill", "timer_snow", "timer_text",
  "clock", "matrix_rain",
],
```

Replace with:
```typescript
enum: [
  "fire", "rainbow", "breathe", "wave", "solid",
  "liquid", "imu", "chiptemp", "weather",
  "timer_fill", "timer_snow", "timer_text",
  "clock", "matrix_rain",
  "spiral", "starfield", "fireworks", "comet", "sun",
],
```

- [ ] **Step 8.2: Add new properties to inputSchema**

Find the `theme` property line:
```typescript
theme:       { type: "string",  description: "Matrix rain color theme: classic, blue, red, or purple." },
```

Add after it:
```typescript
color4:  { type: "string",  description: "Quaternary color hex. Used by sun animation for ring tail color." },
density: { type: "number",  description: "Starfield star density 1-16. 4=sparse, 8=medium, 14=dense." },
inward:  { type: "boolean", description: "Starfield direction: true = stars fall inward toward center, false = radiate outward from center." },
```

- [ ] **Step 8.3: Update the description string**

Find:
```
- matrix_rain: digital rain / matrix screensaver with falling character drops. Also called "matrix screensaver" or "digital rain". params: theme (classic/blue/red/purple), speed (1-5)
```

Add after it (inside the template literal, before the closing backtick):
```
- spiral: gradient snake flowing along a clockwise inward spiral — all 64 LEDs lit at all times. params: color1 (gradient start), color2 (gradient end)
- starfield: stars radiate from center or fall inward toward center. params: color1 (birth color), color2 (death color), density (1-16, default 8), inward (bool, default false)
- fireworks: single looping firework — white mortar launches from bottom, explodes in colorful radial burst. params: color1 (dominant burst color), color2, color3 (fade-out colors)
- comet: bobbing comet at right edge with wave tail and occasional sparks. params: color1 (heart), color2 (shell), color3 (tail tip)
- sun: static disc in center with spinning gradient arc around it. params: color1 (disc), color2 (arc head), color3 (arc mid), color4 (arc tail)
```

- [ ] **Step 8.4: Compile TypeScript and verify**

```bash
cd mcp_server && npx tsc --noEmit
```

Expected: No errors. If type errors appear, check that the new properties match the existing `inputSchema` type pattern.

- [ ] **Step 8.5: Restart MCP server and test via Claude**

In Claude Code: `/mcp` → reconnect the `esp32-matrix` server (or restart Claude Code to reload the MCP server).

Then ask Claude: "Start the spiral animation with red to blue gradient at medium speed." Claude should call `matrix_set_animation` with `type: "spiral"`, `color1: "#FF0000"`, `color2: "#0000FF"`, `speed: 3`.

- [ ] **Step 8.6: Commit**

```bash
cd mcp_server
git add index.ts
git commit -m "feat: mcp — add spiral/starfield/fireworks/comet/sun to tool schema"
```

---

## Self-Review Checklist

- [x] All 5 animations have firmware frame functions, handleAnimation() init blocks, dispatch branches in loop(), web UI cards + panels, and MCP schema entries
- [x] `buildSpiralPath()` called lazily on first frame via `spiralReady` guard — safe even if `setup()` is slow
- [x] `starsInitialized` flag in starfield prevents age-check on uninitialized star data
- [x] `cometInit` flag in comet zeroes spark pool before first use
- [x] `fwIdleStartMs` is 0 at boot — first firework fires immediately (within 700ms), intentional
- [x] Sun ring slot and star density use `static` frame-local state — correct pattern matching the rest of the codebase
- [x] Web UI: existing breathe/solid/wave/rainbow/fire animations unaffected — `PANEL_MAP` only defines panels for types that need one; types not in the map show no panel (correct for rainbow/wave)
- [x] MCP `color1/2/3` properties already existed — only `color4`, `density`, `inward` are new additions
- [x] Speed param flows correctly: MCP translates 1-5 → ms, web UI sends raw ms — no change needed in firmware
