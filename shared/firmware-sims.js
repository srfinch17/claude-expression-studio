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

export const FIRMWARE_SIMS = {
  claudesweep: makeClaudeSweep,
  frostbite: makeFrostbite,
  fire: makeFire,
};
