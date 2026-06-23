// JS simulations of the board's generative firmware animations. Each is a
// faithful port of the matching esp32_matrix_webserver/anim_*.ino (read-only
// source of truth). A factory returns a stateful sim: frame() advances one
// frame and returns lit pixels. Validated by eye against the board.

const scale8 = (v, s) => (v * s) >> 8;
const nscale8 = ([r, g, b], s) => [scale8(r, s), scale8(g, s), scale8(b, s)];

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

export const FIRMWARE_SIMS = {
  claudesweep: makeClaudeSweep,
  frostbite: makeFrostbite,
  fire: makeFire,
  matrix_rain: makeMatrixRain,
  snow: makeSnow,
};
