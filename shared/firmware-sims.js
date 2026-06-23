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

export const FIRMWARE_SIMS = {
  claudesweep: makeClaudeSweep,
  frostbite: makeFrostbite,
};
