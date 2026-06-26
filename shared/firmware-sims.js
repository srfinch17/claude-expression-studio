// JS simulations of the board's generative firmware animations. Each is a
// faithful port of the matching esp32_matrix_webserver/anim_*.ino (read-only
// source of truth). A factory returns a stateful sim: frame() advances one
// frame and returns lit pixels. Validated by eye against the board.

const scale8 = (v, s) => (v * s) >> 8;
const nscale8 = ([r, g, b], s) => [scale8(r, s), scale8(g, s), scale8(b, s)];

// beatsin8(bpm, lo, hi, phaseU8) — FastLED-style BPM sine helper.
// phaseU8 is a 0-255 phase counter driving one full sine cycle (0=mid-rise, 64=peak,
// 128=mid-fall, 192=trough). Output mapped to [lo, hi] inclusive.
const beatsin8 = (bpm, lo, hi, phaseU8) => {
  const angle = (phaseU8 / 256) * 2 * Math.PI;
  const sin01 = (Math.sin(angle) + 1) / 2;  // 0..1
  return Math.round(lo + sin01 * (hi - lo));
};

// ---- claudesweep (port of anim_claudesweep.ino) ----
const SWEEP_PERIM = [
  [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],
  [7,1],[7,2],[7,3],[7,4],[7,5],[7,6],[7,7],
  [6,7],[5,7],[4,7],[3,7],[2,7],[1,7],[0,7],
  [0,6],[0,5],[0,4],[0,3],[0,2],[0,1],
];
const SWEEP_FLOOR = 88;
const SWEEP_DECAY = 200;
const CLAUDE_ORANGE = [255, 80, 8];
const CLAUDE6_OPEN  = [".####.","######","#.##.#","######",".#..#."];
const CLAUDE6_BLINK = [".####.","######","######","######",".#..#."];

function makeClaudeSweep(opts = {}) {
  const ring = (opts.color ? hexToRGB(opts.color) : [255, 176, 0]); // #ffb000 amber
  const bri = new Array(28).fill(SWEEP_FLOOR);
  let head = 0, fc = 0;
  return {
    frame_ms: opts.frame_ms || 90,
    frame() {
      const px = [];
      for (let i = 0; i < 28; i++) bri[i] = scale8(bri[i], SWEEP_DECAY);
      head = (head + 1) % 28;
      bri[head] = 255;
      for (let i = 0; i < 28; i++) {
        const b = bri[i] > SWEEP_FLOOR ? bri[i] : SWEEP_FLOOR;
        const [r, g, bl] = nscale8(ring, b);
        px.push({ x: SWEEP_PERIM[i][0], y: SWEEP_PERIM[i][1], r, g, b: bl });
      }
      const bob = Math.floor(fc / 14) % 2;
      const blink = (fc % 40) < 3;
      const spr = blink ? CLAUDE6_BLINK : CLAUDE6_OPEN;
      for (let sy = 0; sy < 5; sy++) for (let sx = 0; sx < 6; sx++) {
        if (spr[sy][sx] === "#") {
          px.push({ x: sx + 1, y: sy + 1 + bob, r: CLAUDE_ORANGE[0], g: CLAUDE_ORANGE[1], b: CLAUDE_ORANGE[2] });
        }
      }
      fc++;
      return px;
    },
  };
}

function hexToRGB(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

// FastLED-style CHSV → RGB: h, s, v ∈ 0–255.
// Uses a 6-section rainbow hue wheel (not standard HSV) with 43 steps per section.
// Full hue sweep: red(0)→orange(32)→yellow(64)→green(96)→cyan(128)→blue(172)→magenta(214)→red.
function chsv8(h, s, v) {
  h = h & 0xFF;
  const section = Math.floor(h / 43);        // 0-5
  const pos     = (h - section * 43) * 6;    // 0-252 ramp within section
  let r, g, b;
  switch (section) {
    case 0:  r = 255;       g = pos;        b = 0;          break; // R → Y
    case 1:  r = 255 - pos; g = 255;        b = 0;          break; // Y → G
    case 2:  r = 0;         g = 255;        b = pos;        break; // G → C
    case 3:  r = 0;         g = 255 - pos;  b = 255;        break; // C → B
    case 4:  r = pos;       g = 0;          b = 255;        break; // B → M
    default: r = 255;       g = 0;          b = 255 - pos;  break; // M → R
  }
  // Apply saturation: blend toward white
  if (s < 255) {
    const ds = 255 - s;
    r = Math.min(255, r + scale8(255 - r, ds));
    g = Math.min(255, g + scale8(255 - g, ds));
    b = Math.min(255, b + scale8(255 - b, ds));
  }
  // Apply value (brightness)
  return [scale8(r, v), scale8(g, v), scale8(b, v)];
}

// ---- frostbite (port of anim_frostbite.ino) ----
function makeFrostbite(opts = {}) {
  const color = opts.color ? hexToRGB(opts.color) : [102, 204, 255]; // #66ccff
  const mistMax = (opts.mist ?? 40) * 2;            // matches firmware (×2), default 80
  const sparkRate = opts.sparkle ?? 20;
  const lo = Math.max(8, mistMax >> 1);
  const bri = new Array(64), dir = new Array(64);
  for (let i = 0; i < 64; i++) { bri[i] = lo + Math.floor(Math.random() * (mistMax - lo + 1)); dir[i] = Math.random() < 0.5 ? 1 : -1; }
  const sparks = Array.from({ length: 8 }, () => ({ active: false, idx: 0, phase: 0 }));
  return {
    frame_ms: opts.frame_ms || 60,
    frame() {
      const px = [];
      for (let i = 0; i < 64; i++) {
        if (Math.floor(Math.random() * 30) === 0) dir[i] = -dir[i];
        let next = bri[i] + dir[i];
        if (next >= mistMax) { bri[i] = mistMax; dir[i] = -1; }
        else if (next <= lo) { bri[i] = lo; dir[i] = 1; }
        else bri[i] = next;
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const [r, g, b] = nscale8(color, bri[y * 8 + x]);
        px.push({ x, y, r, g, b });
      }
      if (Math.random() * 100 < sparkRate) {
        const s = sparks.find((s) => !s.active);
        if (s) { s.active = true; s.idx = Math.floor(Math.random() * 64); s.phase = 0; }
      }
      for (const s of sparks) {
        if (!s.active) continue;
        const briS = Math.round(Math.sin(s.phase * Math.PI / 39) * 255);
        if (briS > 0) {
          const [r, g, b] = nscale8(color, briS);
          px.push({ x: s.idx % 8, y: (s.idx / 8) | 0, r, g, b });
        }
        if (++s.phase >= 40) s.active = false;
      }
      return px;
    },
  };
}

// ---- fire (port of anim_fire.ino) ----
// Algorithm: classic Fire2012-style per-column heat map.
// Each column has an independent 8-cell heat array (row 7 = base, row 0 = top).
// Every frame:
//   Phase 1: update per-column tendril personality (drift direction, active flag)
//   Phase 2: ignite the base row (y=7) with random heat bursts scaled by intensity
//   Phase 3: diffuse heat upward with a weighted average of below/belowL/belowR
//             (broad) blended with a drifted-column average (wispy) per tendril weight;
//             subtract a random decay so heat cools as it rises
//   Phase 4: map each heat value through the active palette via linear interpolation
//             between the 8 palette stops (heatToColor equivalent)
//   Bonus:   flying spark particles are emitted from hot upper pixels if sparkRate > 0

const FIRE_PALETTES = {
  classic: [
    [  0,   0,   0], [  0,   0,   0], [160,   0,   0], [255,  50,   0],
    [255, 170,   0], [255, 230,   0], [255, 255, 120], [255, 255, 230],
  ],
  blue: [
    [  0,   0,   0], [  0,   0,   0], [  0,   0, 160], [  0,  40, 255],
    [  0, 160, 255], [  0, 230, 255], [120, 245, 255], [230, 250, 255],
  ],
  green: [
    [  0,   0,   0], [  0,   0,   0], [  0, 130,   0], [ 40, 240,   0],
    [130, 255,   0], [210, 255,  50], [240, 255, 160], [250, 255, 230],
  ],
  purple: [
    [  0,   0,   0], [  0,   0,   0], [ 90,   0, 150], [180,   0, 255],
    [230,  50, 255], [245, 140, 255], [255, 210, 255], [255, 240, 255],
  ],
};

function heatToColor(h, palette) {
  const t = h / 255.0;
  const idx = t * (palette.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, palette.length - 1);
  const frac = idx - lo;
  const r = Math.round(palette[lo][0] + (palette[hi][0] - palette[lo][0]) * frac);
  const g = Math.round(palette[lo][1] + (palette[hi][1] - palette[lo][1]) * frac);
  const b = Math.round(palette[lo][2] + (palette[hi][2] - palette[lo][2]) * frac);
  return [r, g, b];
}

// qadd8: saturating add — clamps at 255 (matches FastLED qadd8)
function qadd8(a, b) { return Math.min(255, a + b); }

function makeFire(opts = {}) {
  const palette = FIRE_PALETTES[opts.palette] || FIRE_PALETTES.classic;
  const fireIntensity = Math.max(1, Math.min(10, opts.intensity ?? 6));
  const fireTendrils  = Math.max(0, Math.min(10, opts.tendrils  ?? 0));
  const sparkRate     = Math.max(0, Math.min(10, opts.sparks    ?? 0));

  // Per-LED heat array, row-major (y * 8 + x), 64 cells, all start at 0
  const fireHeat    = new Uint8Array(64);
  // Per-column drift direction and active flag (mirrors C++ columnDrift/columnActive)
  const columnDrift  = new Int8Array(8);   // -1, 0, +1
  const columnActive = new Uint8Array(8).fill(1); // all active initially

  // Spark particle state (up to 8 live sparks)
  const fireSparks = Array.from({ length: 8 }, () => ({
    x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0,
  }));

  function stepSparks(px) {
    // Try to spawn one new spark
    for (let i = 0; i < 8; i++) {
      if (fireSparks[i].life > 0) continue;
      if (Math.random() * 100 >= sparkRate * 10) break;
      const spawnX = Math.floor(Math.random() * 8);
      let spawnY = -1;
      for (let ty = 0; ty < 8; ty++) {
        if (fireHeat[ty * 8 + spawnX] >= 25) { spawnY = ty; break; }
      }
      if (spawnY < 0) break;
      const life = 6 + Math.floor(Math.random() * 7);
      const minVy = (spawnY + 2.0) / life;
      fireSparks[i].x       = spawnX;
      fireSparks[i].y       = spawnY;
      fireSparks[i].vy      = -(minVy + Math.floor(Math.random() * 3) * 0.05);
      fireSparks[i].vx      = (Math.floor(Math.random() * 5) - 2) * 0.10;
      fireSparks[i].maxLife = life;
      fireSparks[i].life    = life;
      break;
    }

    // Advance all live sparks
    for (const s of fireSparks) {
      if (s.life === 0) continue;
      s.y += s.vy;
      s.x += s.vx;
      s.life--;

      if (s.y < -1.0) { s.life = 0; continue; }

      // Bounce off left/right walls
      if (s.x < 0 || s.x >= 8) {
        s.vx = -s.vx;
        s.x = Math.max(0, Math.min(7, s.x));
      }

      const px_x = Math.round(s.x);
      const px_y = Math.round(s.y);
      if (px_y < 0 || px_y >= 8) continue;

      const t = s.life / s.maxLife;
      const heat = Math.round(220.0 * t);
      const [r, g, b] = heatToColor(heat, palette);
      px.push({ x: px_x, y: px_y, r, g, b });
    }
  }

  return {
    frame_ms: opts.frame_ms || 40,
    frame() {
      const w = fireTendrils / 10.0;

      // Phase 1: update column tendril personality
      for (let x = 0; x < 8; x++) {
        if (Math.random() * 256 < (20 + w * 30)) {
          columnActive[x] = (Math.random() * 256 > w * 140) ? 1 : 0;
        }
        if (Math.random() * 256 < w * 76) {
          columnDrift[x] += (Math.random() < 0.5) ? -1 : 1;
          columnDrift[x] = Math.max(-1, Math.min(1, columnDrift[x]));
        }
        if (Math.random() * 256 < 38) columnDrift[x] = 0;
      }

      // Phase 2: ignite base row (y = 7)
      for (let x = 0; x < 8; x++) {
        const activeBoost = columnActive[x] ? 1.0 : (1.0 - w * 0.85);
        const sparkThresh = Math.round((100 + fireIntensity * 15) * activeBoost);
        if (Math.random() * 256 < sparkThresh) {
          fireHeat[7 * 8 + x] = qadd8(100, Math.floor(Math.random() * (fireIntensity * 15 + 40)));
        } else if (w > 0 && !columnActive[x]) {
          fireHeat[7 * 8 + x] = Math.round(fireHeat[7 * 8 + x] * (1.0 - w * 0.6));
        }
      }

      // Phase 3: diffuse heat upward + cool (rows 0..6, reading from below)
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 8; x++) {
          const below  = fireHeat[(y + 1) * 8 + x];
          const belowL = fireHeat[(y + 1) * 8 + Math.max(0, x - 1)];
          const belowR = fireHeat[(y + 1) * 8 + Math.min(7, x + 1)];
          const broadAvg = (below * 2 + belowL + belowR) / 4;

          const driftX     = Math.max(0, Math.min(7, x + columnDrift[x]));
          const belowDrift = fireHeat[(y + 1) * 8 + driftX];
          const wispyAvg   = (below * 3 + belowDrift) / 4;

          const avg = broadAvg * (1.0 - w) + wispyAvg * w;

          const baseDecay = 20 + Math.floor(Math.random() * (35 - fireIntensity * 2));
          const wispyDecay = columnActive[x]
            ? baseDecay * (1.0 - w * 0.2)
            : baseDecay * (1.0 + w * 1.5);
          const decay = baseDecay * (1.0 - w) + wispyDecay * w;

          fireHeat[y * 8 + x] = avg > decay ? Math.round(avg - decay) : 0;
        }
      }

      // Phase 4: map heat to colors
      const px = [];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const h = fireHeat[y * 8 + x];
          if (h === 0) continue;  // skip black pixels (unlit)
          const [r, g, b] = heatToColor(h, palette);
          if (r === 0 && g === 0 && b === 0) continue;  // palette maps cold → black, skip
          px.push({ x, y, r, g, b });
        }
      }

      // Spark particles on top
      if (sparkRate > 0) stepSparks(px);

      return px;
    },
  };
}

// ---- matrix_rain (port of anim_matrix.ino + initMatrixDrops) ----
// Per-column falling drops: a bright "head" + TRAIL_LEN fading pixels above it.
// Each drop has its own random speed (1–3 ticks/step). Drops start staggered
// above the top edge (random headY in −1..−8) so columns don't sync.
// When the head + entire trail clear the bottom, the drop recycles with a new
// random starting position above the screen and a new speed.
// The trail fades linearly: t=1 (just behind head) = (TRAIL_LEN)/(TRAIL_LEN+1)
// brightness, t=TRAIL_LEN = 1/(TRAIL_LEN+1) brightness.
// COLOR THEMES: classic = green trail / white head, blue = dark-blue / light-blue,
//               red = deep-red / pink, purple = purple / lavender.

const MATRIX_TRAIL_LEN = 4;
const MATRIX_W = 8;
const MATRIX_H = 8;

const MATRIX_THEMES = {
  classic: { trail: [0, 180, 20],   head: [255, 255, 255] },
  blue:    { trail: [0, 80, 220],   head: [180, 220, 255] },
  red:     { trail: [220, 20, 0],   head: [255, 200, 180] },
  purple:  { trail: [160, 0, 220],  head: [230, 200, 255] },
};

function makeMatrixRain(opts = {}) {
  const theme = MATRIX_THEMES[opts.theme] || MATRIX_THEMES.classic;
  const headColor  = theme.head;
  const trailColor = theme.trail;

  // Staggered init: headY starts 1..MATRIX_H rows above the top edge (negative)
  const drops = Array.from({ length: MATRIX_W }, () => ({
    headY: -(1 + Math.floor(Math.random() * MATRIX_H)),  // −1 to −8
    tick:  0,
    speed: 1 + Math.floor(Math.random() * 3),             // 1=fast, 3=slow
  }));

  return {
    frame_ms: opts.frame_ms || 60,
    frame() {
      const px = [];

      for (let col = 0; col < MATRIX_W; col++) {
        const d = drops[col];

        // Advance one row when tick reaches speed threshold
        d.tick++;
        if (d.tick >= d.speed) {
          d.tick = 0;
          d.headY++;
        }

        // Recycle when head + full trail have cleared the bottom
        if (d.headY > MATRIX_H + MATRIX_TRAIL_LEN) {
          d.headY = -(1 + Math.floor(Math.random() * MATRIX_H));
          d.speed = 1 + Math.floor(Math.random() * 3);
        }

        // Draw bright head (only when on-screen)
        if (d.headY >= 0 && d.headY < MATRIX_H) {
          px.push({ x: col, y: d.headY, r: headColor[0], g: headColor[1], b: headColor[2] });
        }

        // Draw fading trail above the head.
        // fade = (TRAIL_LEN - t) / (TRAIL_LEN + 1): 1.0 near head, 0.0 at far end.
        for (let t = 1; t <= MATRIX_TRAIL_LEN; t++) {
          const ty = d.headY - t;
          if (ty < 0 || ty >= MATRIX_H) continue;
          const fade = (MATRIX_TRAIL_LEN - t) / (MATRIX_TRAIL_LEN + 1);
          px.push({
            x: col,
            y: ty,
            r: Math.round(trailColor[0] * fade),
            g: Math.round(trailColor[1] * fade),
            b: Math.round(trailColor[2] * fade),
          });
        }
      }

      return px;
    },
  };
}

// ---- snow (port of anim_snow.ino) ----
// Continuous snowfall with a fixed floor bank — flakes fall and vanish when
// they hit their column's floor surface, then respawn at the top. No accumulation.
//
// FLOOR: SNOW_FLOOR_TOP[col] = first lit row of the floor bank in that column.
//   Columns 2 & 5 have floor_top = 6 (one-row mound); all others = 7.
//   Every frame, for each column x, rows floor_top[x]..7 are lit in floorColor.
//
// COLOR:
//   opts.flakeColor  → fixed hex color used for all flakes AND the floor
//                      (gallery deterministic mode — overrides random pick)
//   opts.confetti    → each flake picks a random SNOW_PALETTE entry; floor = rgb(210,220,255)
//   default (neither) → one random SNOW_PALETTE entry for all flakes + floor (single-hue mode)

const SNOW_PALETTE_COLORS = [
  [255, 255, 255],  // white
  [255,  40,  40],  // red
  [255, 130,   0],  // orange
  [255, 200,  40],  // gold
  [ 80, 255,  40],  // green
  [ 60, 255, 140],  // mint
  [  0, 230, 230],  // cyan
  [ 60, 140, 255],  // ice blue
  [ 40,  70, 255],  // blue
  [160,  40, 255],  // violet
  [255,  60, 230],  // magenta
  [255,  80, 150],  // pink
];

// Topmost floor row per column: mounds at cols 2 & 5 rise to row 6, rest at row 7.
const SNOW_FLOOR_TOP = [7, 7, 6, 7, 7, 6, 7, 7];

const SNOW_FLAKE_COUNT = 6;

function pickSnowPaletteColor() {
  return SNOW_PALETTE_COLORS[Math.floor(Math.random() * SNOW_PALETTE_COLORS.length)];
}

function makeSnow(opts = {}) {
  // Resolve floor color and per-flake color strategy.
  // opts.flakeColor: fixed hex → use for all flakes AND floor (gallery deterministic).
  // opts.confetti: true → each flake gets its own random palette color; floor = neutral white.
  // default: pick one random palette entry for all flakes AND the floor (single-hue).
  let floorColor;
  let singleFlakeColor = null;  // null means each flake picks its own (confetti or fixed)
  const confetti = opts.confetti || false;

  if (opts.flakeColor) {
    // Gallery deterministic override: fixed color for flakes AND floor.
    singleFlakeColor = hexToRGB(opts.flakeColor);
    floorColor = singleFlakeColor;
  } else if (confetti) {
    // Each flake random; floor = dim neutral snow-white (matches firmware rgb(210,220,255)).
    floorColor = [210, 220, 255];
  } else {
    // Single random hue for flakes + floor (matches firmware single-hue mode).
    singleFlakeColor = pickSnowPaletteColor();
    floorColor = singleFlakeColor;
  }

  // Spawn a flake at index i. stagger=true: start y anywhere from -1 to -(MATRIX_H).
  // stagger=false: always start at y=-1 (just above the top).
  function spawnFlake(flake, stagger) {
    flake.x     = Math.floor(Math.random() * 8);
    flake.y     = stagger ? -(1 + Math.floor(Math.random() * 8)) : -1;
    flake.tick  = 0;
    flake.speed = 1 + Math.floor(Math.random() * 3);  // 1=fast, 3=slow (ticks per step)
    flake.color = confetti ? pickSnowPaletteColor() : singleFlakeColor;
  }

  // Initialize all flakes with staggered start heights.
  const flakes = Array.from({ length: SNOW_FLAKE_COUNT }, () => {
    const f = { x: 0, y: 0, tick: 0, speed: 1, color: null };
    spawnFlake(f, true);
    return f;
  });

  return {
    frame_ms: opts.frame_ms || 110,
    frame() {
      const px = [];

      // Fixed floor bank: rows floor_top[x]..7 for each column.
      for (let x = 0; x < 8; x++) {
        for (let y = SNOW_FLOOR_TOP[x]; y <= 7; y++) {
          px.push({ x, y, r: floorColor[0], g: floorColor[1], b: floorColor[2] });
        }
      }

      // Advance and draw each flake.
      for (const f of flakes) {
        // Count up; step down one row when tick reaches speed threshold.
        f.tick++;
        if (f.tick >= f.speed) {
          f.tick = 0;
          f.y++;
        }

        // Reached the floor surface in its column → respawn at top.
        if (f.y >= SNOW_FLOOR_TOP[f.x]) {
          spawnFlake(f, false);
          continue;
        }

        // Draw only when on-screen and above the floor.
        if (f.y >= 0) {
          px.push({ x: f.x, y: f.y, r: f.color[0], g: f.color[1], b: f.color[2] });
        }
      }

      return px;
    },
  };
}

// ---- fireworks (port of anim_fireworks.ino, FW1 variant — "fireworks" animation type) ----
// Phase machine: IDLE (wait ~700 ms) → LAUNCH (mortar rises col 2-6, explodes at row 2-5)
//   → EXPLODE (flash fwColor1 for 2 frames) → FADE (12 tendrils radiate + decay then loop).
// fwTendrilColor maps brightness 255→0 through color2→color1 / color3→color2 / black→color3.
// Off-grid tendrils are culled (active=false) exactly as the firmware does.

// Linear interpolation between two [r,g,b] triplets; t in 0..255 (0=a, 255=b)
function blendRGB(a, b, t) {
  const u = t / 255;
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

// Maps brightness (255→0) to a color cycling color1→color2→color3→black
// Matches fwTendrilColor() in anim_fireworks.ino:
//   bri>170 → blend(color2, color1, map(bri,170,255,0,255))   (near 255: toward color1)
//   bri>85  → blend(color3, color2, map(bri, 85,170,0,255))   (mid: toward color2)
//   else    → blend(black,  color3, map(bri,  0, 85,0,255))   (low: toward color3)
function fwColorAt(bri, c1, c2, c3) {
  if (bri > 170) {
    const t = Math.round((bri - 170) / (255 - 170) * 255);
    return blendRGB(c2, c1, t);
  }
  if (bri > 85) {
    const t = Math.round((bri - 85) / (170 - 85) * 255);
    return blendRGB(c3, c2, t);
  }
  const t = Math.round(bri / 85 * 255);
  return blendRGB([0, 0, 0], c3, t);
}

// Number of idle frames before a new launch (~700 ms at 50 ms/frame = 14 frames)
const FW_IDLE_FRAMES = 14;
const FW_IDLE    = 0;
const FW_LAUNCH  = 1;
const FW_EXPLODE = 2;
const FW_FADE    = 3;

function makeFireworks(opts = {}) {
  const c1 = opts.color1 ? hexToRGB(opts.color1) : [255, 0, 80];   // #ff0050
  const c2 = opts.color2 ? hexToRGB(opts.color2) : [0, 224, 255];  // #00e0ff
  const c3 = opts.color3 ? hexToRGB(opts.color3) : [255, 208, 0];  // #ffd000

  let phase         = FW_IDLE;
  let idleFrames    = 0;          // counts frames waited in IDLE state
  let mortarX       = 0;
  let mortarY       = 0;
  let mortarDx      = 0;
  let mortarDy      = 0;
  let explodeY      = 0;
  let flashFrames   = 0;

  // 12 tendrils (matches fwTendrils[12] in the firmware)
  const tendrils = Array.from({ length: 12 }, () => ({
    x: 0, y: 0, dx: 0, dy: 0, brightness: 0, active: false,
  }));

  function launchNew() {
    mortarX  = 2 + Math.floor(Math.random() * 5);  // cols 2-6
    mortarY  = 7.0;
    mortarDx = (Math.floor(Math.random() * 3) - 1) * 0.25;
    mortarDy = -(0.8 + Math.floor(Math.random() * 5) * 0.08);
    explodeY = 2 + Math.floor(Math.random() * 4);  // rows 2-5
    phase    = FW_LAUNCH;
  }

  return {
    frame_ms: opts.frame_ms || 50,
    frame() {
      const px = [];

      if (phase === FW_IDLE) {
        idleFrames++;
        if (idleFrames >= FW_IDLE_FRAMES) {
          idleFrames = 0;
          launchNew();
        }
        return px;  // blank frame during idle
      }

      if (phase === FW_LAUNCH) {
        mortarX += mortarDx;
        mortarY += mortarDy;
        if (Math.floor(mortarY) <= Math.floor(explodeY)) {
          // Spawn 12 tendrils in a circle with random jitter + speed variation
          for (let i = 0; i < 12; i++) {
            const angle = i * (2.0 * Math.PI / 12) + (Math.floor(Math.random() * 30)) * (Math.PI / 180);
            const speed = 0.35 + Math.floor(Math.random() * 4) * 0.08;
            tendrils[i].x          = mortarX;
            tendrils[i].y          = mortarY;
            tendrils[i].dx         = Math.cos(angle) * speed;
            tendrils[i].dy         = Math.sin(angle) * speed;
            tendrils[i].brightness = 255;
            tendrils[i].active     = true;
          }
          flashFrames = 2;
          phase = FW_EXPLODE;
        } else {
          // Draw mortar as white pixel (only when on-grid)
          const mx = Math.floor(mortarX), my = Math.floor(mortarY);
          if (mx >= 0 && mx < 8 && my >= 0 && my < 8) {
            px.push({ x: mx, y: my, r: 255, g: 255, b: 255 });
          }
        }
        return px;
      }

      if (phase === FW_EXPLODE) {
        // Flash the burst color at explode position (on-grid only)
        const ex = Math.floor(mortarX), ey = Math.floor(mortarY);
        if (ex >= 0 && ex < 8 && ey >= 0 && ey < 8) {
          px.push({ x: ex, y: ey, r: c1[0], g: c1[1], b: c1[2] });
        }
        flashFrames--;
        if (flashFrames === 0) phase = FW_FADE;
        return px;
      }

      // FW_FADE: advance tendrils, decay brightness, cull off-grid
      let anyActive = false;
      for (const t of tendrils) {
        if (!t.active) continue;
        anyActive = true;
        t.x += t.dx;
        t.y += t.dy;
        if (t.brightness > 12) {
          t.brightness -= 12;
        } else {
          t.active = false;
          continue;
        }
        // Cull off-grid (matches firmware: if (t.x < 0 || t.x > 7 || t.y < 0 || t.y > 7) { active=false; continue; })
        if (t.x < 0 || t.x > 7 || t.y < 0 || t.y > 7) {
          t.active = false;
          continue;
        }
        const [r, g, b] = fwColorAt(t.brightness, c1, c2, c3);
        px.push({ x: Math.floor(t.x), y: Math.floor(t.y), r, g, b });
      }
      if (!anyActive) {
        phase      = FW_IDLE;
        idleFrames = 0;
      }

      return px;
    },
  };
}

// ---- dancefloor (port of anim_dance_floor.ino) ----
// 4×4 grid of 2×2 tiles. Slot assignment: slot = (tx%2) + (ty%2)*2
// guarantees no two 4-directionally or diagonally adjacent tiles share a slot.
// Each cycle a Fisher-Yates shuffle assigns a new permutation of the 4 palette
// colors to the 4 slots. Transitions crossfade over DF_BLEND_F frames, then
// hold for dfHoldMin + random(DF_HOLD_RNG) frames before the next cycle.
// Per-tile brightness jitter (160–255) stays fixed across cycles.
//
// Palette: DF_PALETTES[0..63][4] — a 64-entry table ported verbatim from
// the firmware. No FastLED built-in palette used; the table is self-contained.

const DF_BLEND_F  = 10;   // frames to crossfade between cycles
const DF_HOLD_RNG = 20;   // random extra hold frames per cycle

// DF_PALETTES[64][4] — ported verbatim from anim_dance_floor.ino
// Each entry is [r,g,b] instead of CRGB; COLOR_ORDER is RGB (straight-through).
const DF_PALETTES = [
  // ── 0-7: Neon / Club ──────────────────────────────────────
  [[255,0,255],[0,255,255],[255,255,0],[0,255,0]],     // 0  Neon Classic
  [[255,0,128],[0,255,128],[128,0,255],[255,128,0]],   // 1  Neon Shifted
  [[255,0,200],[0,200,255],[200,255,0],[255,200,0]],   // 2  Neon Soft
  [[255,0,80],[80,0,255],[0,255,80],[255,80,0]],       // 3  Primary Neon
  [[220,0,255],[0,255,220],[255,220,0],[0,220,255]],   // 4  Electric
  [[255,0,255],[255,0,100],[100,0,255],[0,100,255]],   // 5  Pink Purple
  [[0,255,255],[0,200,255],[0,255,200],[0,150,255]],   // 6  Cyan Family
  [[255,255,0],[255,200,0],[200,255,0],[255,150,0]],   // 7  Yellow Family
  // ── 8-15: Fire / Warm ─────────────────────────────────────
  [[255,50,0],[255,150,0],[255,200,0],[255,255,50]],   // 8  Fire
  [[255,0,0],[255,80,0],[200,0,0],[255,40,40]],        // 9  Red Hot
  [[255,100,0],[255,200,50],[255,50,0],[200,100,0]],   // 10 Amber
  [[255,20,0],[255,100,0],[255,160,0],[255,255,100]],  // 11 Ember
  [[255,0,50],[255,50,0],[200,0,100],[255,100,50]],    // 12 Lava
  [[255,80,80],[255,40,0],[200,20,0],[255,160,80]],    // 13 Sunset Warm
  [[255,200,0],[255,100,0],[255,50,50],[200,200,0]],   // 14 Gold
  [[255,0,80],[255,80,0],[255,180,0],[200,0,80]],      // 15 Hot Candy
  // ── 16-23: Ocean / Cool ───────────────────────────────────
  [[0,100,255],[0,200,255],[0,255,200],[50,50,200]],   // 16 Ocean
  [[0,150,255],[0,255,255],[0,200,200],[100,200,255]], // 17 Aqua
  [[0,50,200],[50,100,255],[0,200,255],[100,50,200]],  // 18 Deep Blue
  [[0,200,200],[0,150,200],[50,200,255],[0,100,150]],  // 19 Teal
  [[100,0,255],[0,100,255],[0,200,255],[50,0,200]],    // 20 Blue Purple
  [[0,255,255],[0,200,255],[0,150,255],[0,100,200]],   // 21 Ice
  [[50,0,200],[100,0,255],[150,50,255],[200,100,255]], // 22 Violet
  [[0,100,200],[0,50,150],[50,150,255],[100,200,255]], // 23 Navy
  // ── 24-31: Nature ─────────────────────────────────────────
  [[0,200,0],[50,255,50],[100,255,0],[0,150,50]],      // 24 Forest
  [[0,255,0],[100,255,0],[0,200,50],[50,255,100]],     // 25 Lime
  [[100,255,0],[200,255,0],[50,200,0],[150,255,50]],   // 26 Chartreuse
  [[0,150,50],[0,200,100],[50,255,150],[0,100,50]],    // 27 Emerald
  [[200,150,50],[150,100,0],[100,200,50],[200,200,100]], // 28 Earth
  [[255,150,0],[200,100,0],[100,200,0],[255,200,50]],  // 29 Autumn
  [[255,100,150],[200,255,100],[100,200,255],[255,200,100]], // 30 Spring
  [[0,200,150],[0,150,100],[50,255,200],[100,255,200]], // 31 Jade
  // ── 32-39: Pastel ─────────────────────────────────────────
  [[255,150,200],[150,200,255],[200,255,150],[255,255,150]], // 32 Pastel Rainbow
  [[255,150,200],[255,100,150],[200,100,200],[255,200,220]], // 33 Pastel Pink
  [[150,200,255],[100,150,255],[150,150,255],[200,220,255]], // 34 Pastel Blue
  [[200,255,200],[150,255,150],[100,220,150],[200,255,180]], // 35 Pastel Green
  [[255,200,150],[255,220,150],[200,150,100],[255,230,180]], // 36 Pastel Warm
  [[200,150,255],[220,180,255],[180,100,255],[240,200,255]], // 37 Pastel Purple
  [[150,255,240],[150,220,255],[180,255,220],[200,255,255]], // 38 Pastel Mint
  [[255,255,150],[255,240,100],[255,200,100],[255,255,200]], // 39 Pastel Yellow
  // ── 40-47: Monochrome ─────────────────────────────────────
  [[255,0,0],[200,0,0],[150,0,0],[100,0,0]],           // 40 Red Mono
  [[255,80,0],[200,60,0],[150,40,0],[255,120,0]],      // 41 Orange Mono
  [[255,255,0],[200,200,0],[150,150,0],[255,220,50]],  // 42 Yellow Mono
  [[0,255,0],[0,200,0],[0,150,0],[50,255,50]],         // 43 Green Mono
  [[0,0,255],[0,0,200],[0,50,255],[50,50,255]],        // 44 Blue Mono
  [[150,0,255],[100,0,200],[200,50,255],[80,0,180]],   // 45 Purple Mono
  [[255,0,150],[200,0,100],[255,50,180],[150,0,80]],   // 46 Pink Mono
  [[0,255,200],[0,200,150],[50,255,220],[0,150,120]],  // 47 Teal Mono
  // ── 48-55: Retro / 80s ────────────────────────────────────
  [[255,0,255],[0,255,0],[255,255,0],[0,0,255]],       // 48 80s Classic
  [[255,0,100],[0,200,255],[200,255,0],[255,100,0]],   // 49 Miami Vice
  [[100,0,255],[255,0,255],[0,200,200],[255,200,0]],   // 50 Synthwave
  [[255,50,150],[150,0,255],[0,200,255],[255,200,50]], // 51 VHS
  [[0,255,0],[0,200,0],[255,0,0],[0,0,255]],           // 52 Arcade
  [[255,200,0],[255,100,0],[0,200,0],[200,0,200]],     // 53 Pac-Man
  [[255,255,0],[255,0,0],[0,0,255],[255,255,255]],     // 54 Pinball
  [[0,255,150],[255,0,100],[255,150,0],[100,0,255]],   // 55 Funky
  // ── 56-63: Dark / Moody ───────────────────────────────────
  [[100,0,150],[0,50,150],[150,0,100],[0,100,100]],    // 56 Dark Galaxy
  [[80,0,0],[50,0,50],[0,0,80],[80,40,0]],             // 57 Ember Dark
  [[150,0,50],[100,0,100],[50,0,150],[0,50,100]],      // 58 Noir
  [[0,100,0],[0,80,50],[50,100,0],[0,60,60]],          // 59 Deep Forest
  [[100,50,0],[80,0,0],[50,50,0],[60,30,0]],           // 60 Rust
  [[0,80,100],[0,50,80],[50,0,100],[0,100,80]],        // 61 Abyss
  [[80,0,80],[60,0,60],[100,0,50],[50,0,80]],          // 62 Dusk
  [[50,50,50],[80,80,80],[120,120,120],[30,30,30]],    // 63 Grayscale
];

// Fisher-Yates shuffle in-place on a 4-element array (mirrors dfShuffle in the firmware)
function dfShuffle(perm) {
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
  }
}

function makeDancefloor(opts = {}) {
  const palette   = Math.max(0, Math.min(63, opts.palette ?? 0));
  // hold maps to dfHoldMin (spec default 6; clamp 4..40)
  const holdMin   = Math.max(4, Math.min(40, opts.hold ?? 6));
  const pal       = DF_PALETTES[palette];

  // 4 color slots, current + next
  const slotCur = [[0,0,0],[0,0,0],[0,0,0],[0,0,0]];
  const slotNxt = [[0,0,0],[0,0,0],[0,0,0],[0,0,0]];
  // per-tile brightness jitter (16 tiles), range 160..255, fixed across cycles
  const brightness = new Array(16);
  let blendPos  = 0;
  let holdCount = 0;
  let inited    = false;

  function newCycle() {
    const perm = [0, 1, 2, 3];
    dfShuffle(perm);
    for (let s = 0; s < 4; s++) {
      slotCur[s] = slotNxt[s].slice();
      slotNxt[s] = pal[perm[s]].slice();
    }
    blendPos  = 0;
    holdCount = holdMin + Math.floor(Math.random() * DF_HOLD_RNG);
  }

  return {
    frame_ms: opts.frame_ms || 80,
    frame() {
      if (!inited) {
        let perm = [0, 1, 2, 3];
        dfShuffle(perm);
        for (let s = 0; s < 4; s++) slotCur[s] = pal[perm[s]].slice();
        perm = [0, 1, 2, 3];
        dfShuffle(perm);
        for (let s = 0; s < 4; s++) slotNxt[s] = pal[perm[s]].slice();
        for (let i = 0; i < 16; i++) brightness[i] = 160 + Math.floor(Math.random() * 96);
        blendPos  = DF_BLEND_F;  // start fully blended (skip initial fade-in)
        holdCount = holdMin;
        inited    = true;
      }

      // State machine: advance blend or hold, or start a new cycle
      if (blendPos < DF_BLEND_F)  blendPos++;
      else if (holdCount > 0)     holdCount--;
      else                        newCycle();

      const blend_t = (blendPos >= DF_BLEND_F)
        ? 255
        : Math.round(blendPos * 255 / DF_BLEND_F);

      const px = [];
      for (let i = 0; i < 16; i++) {
        const tx   = i % 4;
        const ty   = (i / 4) | 0;
        const slot = (tx % 2) + (ty % 2) * 2;
        const c    = blendRGB(slotCur[slot], slotNxt[slot], blend_t);
        // nscale8: matches firmware c.nscale8(dfBrightness[i])
        const [r, g, b] = nscale8(c, brightness[i]);
        const px0  = tx * 2, py0 = ty * 2;
        px.push({ x: px0,   y: py0,   r, g, b });
        px.push({ x: px0+1, y: py0,   r, g, b });
        px.push({ x: px0,   y: py0+1, r, g, b });
        px.push({ x: px0+1, y: py0+1, r, g, b });
      }
      return px;
    },
  };
}

// ---- rainbow (port of anim_effects.ino runRainbowFrame) ----
// 8 vertical hue stripes: column x gets hue = rainbowHue + x*32, color CHSV(hue,255,200).
// rainbowHue advances each frame so the stripes scroll continuously across the hue wheel.
// Full-spectrum mode only (palette mode optional — ignored in v1 as per task spec).
function makeRainbow(opts = {}) {
  let rainbowHue = 0;
  // advance ≈ 400/animationSpeed; at ~90ms/frame that's ~4.  Default matches C++ medium speed.
  const advance = opts.advance || 4;
  return {
    frame_ms: opts.frame_ms || 90,
    frame() {
      rainbowHue = (rainbowHue + advance) & 0xFF;
      const px = [];
      for (let x = 0; x < 8; x++) {
        const hue = (rainbowHue + x * 32) & 0xFF;
        const [r, g, b] = chsv8(hue, 255, 200);
        for (let y = 0; y < 8; y++) {
          px.push({ x, y, r, g, b });
        }
      }
      return px;
    },
  };
}

// ---- breathe (port of anim_effects.ino runBreatheFrame) ----
// Fills the whole panel with a single hue, then scales every LED's brightness by a
// sine wave — beatsin8(20 BPM, 10, 255) — so the panel pulses in and out together.
// solidColor is user-set on the board; default here is cyan #28c8ff (overridable via opts.color).
// The phase counter advances each frame at ~20 BPM so one pulse cycle is ~3 seconds.
function makeBreathe(opts = {}) {
  const frameMs = opts.frame_ms || 50;
  const [cr, cg, cb] = opts.color ? hexToRGB(opts.color) : hexToRGB('#28c8ff');
  // Advance the 0-255 phase counter so one sine cycle = 60000ms/20bpm = 3000ms.
  // At frameMs ms/frame: phaseStep = 256 / (3000 / frameMs) = 256 * frameMs / 3000.
  // At default 50ms → phaseStep ≈ 4, giving a 3.2 s cycle (close to 20 BPM / 3 s).
  const phaseStep = Math.max(1, Math.round(256 * frameMs / 3000));
  let breathePhase = 0;
  return {
    frame_ms: frameMs,
    frame() {
      const level = beatsin8(20, 10, 255, breathePhase);
      breathePhase = (breathePhase + phaseStep) & 0xFF;
      const px = [];
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const [r, g, b] = nscale8([cr, cg, cb], level);
          px.push({ x, y, r, g, b });
        }
      }
      return px;
    },
  };
}

export const FIRMWARE_SIMS = {
  claudesweep: makeClaudeSweep,
  frostbite: makeFrostbite,
  fire: makeFire,
  matrix_rain: makeMatrixRain,
  snow: makeSnow,
  fireworks: makeFireworks,
  dancefloor: makeDancefloor,
  rainbow: makeRainbow,
  breathe: makeBreathe,
};
