# Five New Animations — Design Spec

**Date:** 2026-05-22  
**Status:** Approved

---

## Overview

Add five new animations to the ESP32-S3 8×8 LED matrix: Gradient Spiral, Gradient Starfield, Fireworks, Comet, and Sun. Each is selectable from the existing `animations.html` web UI page and callable via the MCP server's `matrix_set_animation` tool.

---

## Firmware Architecture

### New Files

| File | Animations |
|------|-----------|
| `anim_gradient.ino` | Gradient Spiral, Gradient Starfield, Sun |
| `anim_comet.ino` | Comet |
| `anim_fireworks.ino` | Fireworks |

### Existing Files Modified

- **`esp32_matrix_webserver.ino`** — `loop()` gets 5 new `else if` dispatch branches for `"spiral"`, `"starfield"`, `"fireworks"`, `"comet"`, `"sun"`
- **`api_handlers.ino`** — `handleAnimation()` reads new params: `color1`, `color2`, `color3`, `color4` (hex strings), `density` (int 1–16), `inward` (bool)
- **`mcp_server/index.ts`** — updated tool schema and description (see MCP section)

### New Global State

Each animation declares its color globals at the top of its `.ino` file. Static locals are used for frame state (phase counters, particle arrays, history buffers) to keep the global namespace clean.

---

## Per-Animation Design

### 1. Gradient Spiral (`anim_gradient.ino`)

**Behavior:** All 64 pixels are always lit. A color gradient (color1 → color2) flows continuously along a clockwise inward spiral path. No reset — seamless loop.

**Spiral path construction** (pre-computed at boot into `spiralPath[64]`):
- Ring 0 (outer): 28 pixels — top-left → top-right → bottom-right → bottom-left → back up
- Ring 1: 20 pixels (1px inset)
- Ring 2: 12 pixels (2px inset)
- Ring 3: 4 pixels (3px inset, innermost 2×2)

**Frame logic:**
```
spiralPhase advances each frame (wraps at 64)
for i in 0..63:
  t = (i + spiralPhase) % 64 / 63.0
  leds[spiralPath[i]] = lerp(color1, color2, t)
```

**API params:** `color1`, `color2`, `speed`  
**Globals:** `CRGB spiralColor1`, `CRGB spiralColor2`

---

### 2. Gradient Starfield (`anim_gradient.ino`)

**Behavior:** Pool of stars radiate outward from center (or inward from edges). Each star transitions from color1 to color2 over its lifetime. Random per-star brightness. Direction controlled by `inward` toggle.

**Star struct:**
```cpp
struct Star {
  float x, y;       // current position (float for smooth sub-pixel movement)
  float dx, dy;     // velocity per frame
  uint8_t age;      // frames alive
  uint8_t maxAge;   // total lifetime before respawn
  uint8_t brightness; // random at birth
  bool active;
};
Star stars[16];     // pool, density param controls how many are active
```

**Outward mode:** Born at center (3.5, 3.5), random direction, die when off-screen.  
**Inward mode:** Born at random edge pixel, direction toward center (3.5, 3.5), die when reaching center.

**Color:** `lerp(color1, color2, age / maxAge)` × brightness scale.

**Respawn:** Dead stars immediately respawn to maintain density count.

**API params:** `color1`, `color2`, `density` (1–16), `inward` (bool), `speed`  
**Globals:** `CRGB starColor1`, `CRGB starColor2`, `uint8_t starDensity`, `bool starInward`

---

### 3. Fireworks (`anim_fireworks.ino`)

**Behavior:** Single firework loop — white mortar launches from the bottom, explodes in a colorful radial burst that fades to black. Designed as a single firework first for tuning; can be extended to simultaneous fireworks later.

**State machine:**

| Phase | Description |
|-------|-------------|
| `FW_IDLE` | 0.5s pause, then spawn new mortar |
| `FW_LAUNCH` | White pixel travels upward with slight random horizontal drift |
| `FW_EXPLODE` | 1–2 frame flash of color1 at explosion point, spawn tendril particles |
| `FW_FADE` | Particles advance, color cycles color1→color2→color3→black, brightness fades |

**Mortar:** Spawns at random x (cols 2–6), y=7. Travels up at 1–2 rows per frame. Explodes at a randomly chosen y between rows 2–5.

**Explosion:** 8–12 tendril particles spawned at mortar position, each with:
- Random angle and speed
- Color phase counter cycling through color1 → color2 → color3 → black
- Brightness fading per frame
- Dies when off-screen or brightness reaches 0

**Transition:** When last particle fades → `FW_IDLE`.

**API params:** `color1`, `color2`, `color3`, `speed`  
**Globals:** `CRGB fwColor1/2/3`, firework state struct

---

### 4. Comet (`anim_comet.ino`)

**Behavior:** Comet sits at the right edge of the board and bobs up and down ±2 pixels. The tail follows the head using a Y-history ring buffer, producing a tadpole wave-ripple effect. Occasional sparks fly leftward from the head.

**Shape (relative to heart top-left at x=6, y=cometY):**

| Column | Rows lit | Color | Brightness |
|--------|----------|-------|------------|
| x=6–7 | 2 (heart 2×2) | color1 | 100% |
| x=5 | 4 (shell) | color2 | 75% |
| x=4 | 3 (tail) | color2 | 55% |
| x=3 | 2 (tail) | color3 | 40% |
| x=2 | 1 (tail tip) | color3 | 25% |
| x=0–1 | black | — | — |

**Bob animation:** `cometY = baseY + sin(t) * 2.0`, clamped so the heart and full shell stay on-screen. `baseY` ≈ 3 (centers the comet vertically).

**Tail wave:** Ring buffer stores the last 8 frames of `cometY`. Each tail column samples progressively older entries (x=5 uses frame-1, x=4 uses frame-2, etc.), producing the ripple lag.

**Sparks:** Each frame, small random chance spawns a spark particle at the head position. Velocity: leftward (−1 to −2 dx) with slight random Y component. Single pixel, brightness fades each frame until dead.

**API params:** `color1`, `color2`, `color3`, `speed`  
**Globals:** `CRGB cometColor1/2/3`, bob state, tail Y-buffer, spark pool

---

### 5. Sun (`anim_gradient.ino`)

**Behavior:** Matches the existing weather app sun animation exactly. Static sun circle in center (color1). Spinning ring around it — a 5-pixel arc with a bright head and fading tail, like a Windows loading spinner. Colors 2–4 define the ring gradient head-to-tail.

**Sun shape:** Replicated from `weather.ino` (read during implementation to match exactly).

**Spinning ring:** Arc of 5 pixels rotates around the ring each frame:
- Head pixel: color2, full brightness
- Middle pixels: color3, mid brightness
- Tail pixel: color4, dim
- Remaining ring pixels: black

**Speed slider:** Controls how many degrees the arc advances per frame.

**Color presets (overrideable via 4 color pickers):**

| Preset | Sun (color1) | Ring head→tail (color2→3→4) |
|--------|-------------|--------------------------|
| Solar | #FFB700 | #FF6600 → #FF3300 → #CC1100 |
| Arctic | #FFFFFF | #88DDFF → #4499FF → #0055CC |
| Twilight | #FF99FF | #CC44FF → #9900CC → #550088 |
| Neon | #AAFFAA | #00FF44 → #00CC22 → #005511 |
| Lava | #FFFF00 | #FF4400 → #CC0000 → #660000 |

**API params:** `color1`, `color2`, `color3`, `color4`, `speed`  
**Globals:** `CRGB sunColor1/2/3/4`

---

## Web UI (`animations.html`)

**5 new animation cards** added to the existing grid. The current single shared color panel is replaced with **per-animation control panels** that swap in/out when a card is selected.

**Shared control (all animations):** Speed slider (already present).

**Per-animation panels:**

| Animation | Controls |
|-----------|---------|
| Spiral | 2 color pickers (Start, End) |
| Starfield | 2 color pickers (Start, End) + density slider + inward toggle |
| Fireworks | 3 color pickers (Color 1, 2, 3) |
| Comet | 3 color pickers (Heart, Shell, Tail) |
| Sun | 4 color pickers (Sun, Ring 1, Ring 2, Ring 3) + preset palette grid (clock-style, overrideable) |

The existing `needsColor` set and `color-group` hidden/visible logic is replaced with a `showPanel(type)` function that hides all panels then shows the one matching the selected animation.

---

## MCP Server (`mcp_server/index.ts`)

### Schema Changes

**`type` enum** — add: `"spiral"`, `"starfield"`, `"fireworks"`, `"comet"`, `"sun"`

**New properties:**
```typescript
color4:  { type: "string", description: "Quaternary color hex. Used by Sun animation for ring tail color." },
density: { type: "number", description: "Starfield star density 1-16. Higher = more stars." },
inward:  { type: "boolean", description: "Starfield direction: true = stars fall inward toward center, false = outward from center." },
```

(Note: `color1`, `color2`, `color3` already exist in the schema.)

### Description Additions

Append to the animation type rulebook:
```
- spiral: gradient snake flowing along a clockwise inward spiral. params: color1 (start), color2 (end)
- starfield: stars radiate from center or fall inward. params: color1, color2, density (1-16), inward (bool)
- fireworks: single firework loop — mortar launches, explodes, fades. params: color1, color2, color3
- comet: bobbing comet at right edge with wave tail and occasional sparks. params: color1 (heart), color2 (shell), color3 (tail)
- sun: spinning gradient ring around a sun circle. params: color1 (sun), color2/3/4 (ring head→tail)
```

---

## Open Questions / Implementation Notes

- **Sun shape:** Read `weather.ino` during implementation to replicate the exact pixel layout of the existing sun animation.
- **Fireworks tuning:** Starting with one firework; multi-firework support can be added after the single firework is tuned.
- **Comet spark rate:** Start with ~5% chance per frame; adjust during testing.
- **Starfield maxAge:** Tune per density so stars don't all die at once — stagger maxAge with random variance at spawn.
