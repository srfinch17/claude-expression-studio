// ============================================================
// Canned expression library — Claude's pre-vetted vocabulary
// ============================================================
// Each expression is drawn as TEXT ART: 8 strings of 8 characters per frame.
// '.' = off (black); every other character maps to a hex color in `colors`.
// This format is deliberately human-reviewable — the silhouette test happens
// right here in the source.
//
// Color notes for this specific board:
//  - The panel is RGB order and the firmware maps #rrggbb straight through.
//  - At the default brightness (40), any channel below ~7 renders as OFF
//    (see docs/LED_BRIGHTNESS.md). Dim accent colors here stay above that.
//
// loop semantics (mirrors the firmware): 0 = repeat forever;
// N = play N passes then HOLD the last frame (put the resting image last).

export interface Expression {
  description: string;
  frame_ms?: number; // default 150
  loop?: number;     // default 0 (forever)
  colors: Record<string, string>;
  frames: string[][];
}

export const MAX_FRAMES = 24; // firmware MAX_PLAY_FRAMES

const ALL = (row: string) => [row, row, row, row, row, row, row, row];

export const CANNED: Record<string, Expression> = {
  smiley: {
    description: "Friendly yellow smiley face — greeting, contentment, all-is-well.",
    colors: { Y: "#ffc800" },
    frames: [[
      "..YYYY..",
      ".YYYYYY.",
      "YY.YY.YY",
      "YYYYYYYY",
      "Y.YYYY.Y",
      "YY....YY",
      ".YYYYYY.",
      "..YYYY..",
    ]],
  },

  sad: {
    description: "Sad face — something failed or didn't go to plan (gentle, not alarming).",
    colors: { Y: "#ffc800" },
    frames: [[
      "..YYYY..",
      ".YYYYYY.",
      "YY.YY.YY",
      "YYYYYYYY",
      "YY....YY",
      "Y.YYYY.Y",
      ".YYYYYY.",
      "..YYYY..",
    ]],
  },

  heart: {
    description: "Red beating heart — appreciation, warmth, 'love it'. Expands then contracts/dips on a ~1s lub-dub.",
    frame_ms: 520,
    loop: 0,
    colors: { R: "#ff1432" },
    frames: [
      [
        ".RR..RR.",
        "RRRRRRRR",
        "RRRRRRRR",
        "RRRRRRRR",
        ".RRRRRR.",
        "..RRRR..",
        "...RR...",
        "........",
      ],
      [
        "........",
        ".RR..RR.",
        "RRRRRRRR",
        "RRRRRRRR",
        ".RRRRRR.",
        "..RRRR..",
        "...RR...",
        "........",
      ],
    ],
  },

  cross: {
    description:
      "Red X inside a red border that glows up and down (never off, never inverts) — failure, error, 'no'. One red hue at 6 baked brightness steps (A = dim floor, still lit … F = peak) so the glow survives low board brightness. Loops forever.",
    frame_ms: 120,
    loop: 0,
    colors: {
      A: "#400000",
      B: "#6b0000",
      C: "#950000",
      D: "#c00000",
      E: "#eb0000",
      F: "#ff0000",
    },
    frames: [
      // glow up A→F then back down to B; loops smoothly through the floor (A)
      [
        "AAAAAAAA",
        "A......A",
        "A.A..A.A",
        "A..AA..A",
        "A..AA..A",
        "A.A..A.A",
        "A......A",
        "AAAAAAAA",
      ],
      [
        "BBBBBBBB",
        "B......B",
        "B.B..B.B",
        "B..BB..B",
        "B..BB..B",
        "B.B..B.B",
        "B......B",
        "BBBBBBBB",
      ],
      [
        "CCCCCCCC",
        "C......C",
        "C.C..C.C",
        "C..CC..C",
        "C..CC..C",
        "C.C..C.C",
        "C......C",
        "CCCCCCCC",
      ],
      [
        "DDDDDDDD",
        "D......D",
        "D.D..D.D",
        "D..DD..D",
        "D..DD..D",
        "D.D..D.D",
        "D......D",
        "DDDDDDDD",
      ],
      [
        "EEEEEEEE",
        "E......E",
        "E.E..E.E",
        "E..EE..E",
        "E..EE..E",
        "E.E..E.E",
        "E......E",
        "EEEEEEEE",
      ],
      [
        "FFFFFFFF",
        "F......F",
        "F.F..F.F",
        "F..FF..F",
        "F..FF..F",
        "F.F..F.F",
        "F......F",
        "FFFFFFFF",
      ],
      [
        "EEEEEEEE",
        "E......E",
        "E.E..E.E",
        "E..EE..E",
        "E..EE..E",
        "E.E..E.E",
        "E......E",
        "EEEEEEEE",
      ],
      [
        "DDDDDDDD",
        "D......D",
        "D.D..D.D",
        "D..DD..D",
        "D..DD..D",
        "D.D..D.D",
        "D......D",
        "DDDDDDDD",
      ],
      [
        "CCCCCCCC",
        "C......C",
        "C.C..C.C",
        "C..CC..C",
        "C..CC..C",
        "C.C..C.C",
        "C......C",
        "CCCCCCCC",
      ],
      [
        "BBBBBBBB",
        "B......B",
        "B.B..B.B",
        "B..BB..B",
        "B..BB..B",
        "B.B..B.B",
        "B......B",
        "BBBBBBBB",
      ],
    ],
  },

  thumbsup: {
    description: "Thumbs up — approval, good job, agreed.",
    colors: { A: "#ffb414" },
    frames: [[
      "....AA..",
      "....AA..",
      "...AAA..",
      "AAAAAAAA",
      "AAAAAAAA",
      "AAAAAAAA",
      "AAAAAAAA",
      "...AAAAA",
    ]],
  },

  ok: {
    description: "Green 'OK' text — acknowledged, settings applied.",
    colors: { G: "#00d264" },
    frames: [[
      "........",
      "........",
      "........",
      "GGG.G.G.",
      "G.G.GG..",
      "GGG.G.G.",
      "........",
      "........",
    ]],
  },

  sparkle: {
    description:
      "Frostbite-style shimmer — an icy mist glows across the whole panel while bright cyan points fade in and out on smooth sine-bell curves, staggered so they twinkle. Delight, a nice find, a magic moment. The 4 brightness levels are pinned to distinct bri-5 bands so they stay visible.",
    frame_ms: 70,
    colors: { a: "#1a3440", b: "#2c576b", d: "#509dc0", e: "#62c0eb" },
    frames: [
      ["aedbaaaa", "bbbaaaaa", "baadaabb", "aaaaabbd", "aaadbbaa", "abbbaaaa", "bbaaaaaa", "aaaaaadb"],
      ["aedbaaaa", "bbaaaaaa", "aaadaabb", "aaaabbbd", "aabbbbaa", "bbbbaaaa", "bbaaaaaa", "aaaaaaeb"],
      ["bebbaaaa", "bbaaaaab", "aaabaabb", "aaaabbbb", "aabbbaaa", "bbbaaaaa", "baaaaaab", "aaaaabeb"],
      ["bdbaaaaa", "baaaaaab", "aaaaabbb", "aaabbbba", "aabbbaaa", "bbbaaaaa", "baaaaaab", "aaaaabeb"],
      ["bdbaaaaa", "baaaaaab", "aaaaabbb", "aaabbbaa", "abbbaaaa", "bbbaaaaa", "baaaaabb", "aaaaabdb"],
      ["bbbaaaaa", "baaaaabb", "aaaaabbb", "aaabbbaa", "abbbaaaa", "bbaaaaaa", "aaaaaabb", "aaaabbda"],
      ["bbaaaaaa", "aaaaaabb", "aaaabbbd", "aabbbbaa", "bbbbaaab", "bbaaaaaa", "aaaaaabb", "aaaabbba"],
      ["bbaaaaab", "aaaaaabb", "aaaabbbd", "aabbbaaa", "bbbaaaad", "baaaaaab", "aaaaabbb", "aaabbbba"],
      ["baaaaaab", "aaaaabbb", "aaabbbbe", "aabbbaaa", "bbbaaaad", "baaaaaab", "aaaaabbb", "aaabbbaa"],
      ["baaaaaab", "aaaaabbb", "aaabbbae", "bbbbaaaa", "bbbaaaae", "baaaaabb", "aaaaabbb", "aaabbbaa"],
      ["baaaaabb", "aaaabbbb", "aaabbbae", "dbbbaaaa", "bbaaaaae", "aaaaaabb", "aaaabbba", "aabbbbaa"],
      ["aaaaaabb", "aaaabbba", "aabbbbad", "dbbbaaaa", "bbaaaaae", "aaaaaabb", "aaaabbba", "aabbbaaa"],
      ["aaaaaabb", "aaaabbba", "aabbbaad", "ebbaaaaa", "baaaaaad", "aaaaabbb", "aaabbbba", "babbbaaa"],
      ["aaaaabbb", "aaabbbba", "aabbbaab", "ebbaaaaa", "baaaaaad", "aaaaabbb", "aaabbbaa", "dbbbaaaa"],
      ["aaaaabbb", "aaabbbaa", "abbbaaaa", "ebbaaaaa", "baaaaabb", "aaaaabbb", "aaabbbaa", "dbbbaaaa"],
      ["aaaabbbb", "aaabbbaa", "abbbaaaa", "dbaaaaaa", "aaaaaabb", "aaaabbba", "aabbbbaa", "ebbbaaaa"],
      ["aaaabbba", "aabbbbaa", "bbbbaaaa", "dbaaaaaa", "aaaaaabb", "aaaabbba", "aabbbaaa", "ebbaaaab"],
      ["aaaabbba", "aabbbaaa", "bbbaaaaa", "baaaaaab", "aaababbb", "aaabbbba", "aabbbaaa", "ebbaaaad"],
      ["aabbbbba", "aabbbaaa", "bbbbaaaa", "baaaaaab", "aaadabbb", "aaabbbaa", "abbbaaaa", "dbbaaaad"],
      ["aadbbbaa", "abbbaaaa", "bbbdaaaa", "baaaaabd", "aaadabbb", "aaabbbaa", "abbbaaaa", "dbaaaaae"],
      ["aadbbbaa", "abbbaaaa", "bbadaaaa", "aaaaaabd", "aaaebbba", "aabbbbaa", "bbbbaaaa", "bbaaaaae"],
      ["abebbaaa", "bbbbaaaa", "bbaeaaab", "aaaaaabe", "aaaebbba", "aabbbaaa", "bbbaaaaa", "baaaaaae"],
      ["adebbaaa", "bbbaaaaa", "baaeaaab", "aaaaabbe", "aaaebbba", "aabbbaaa", "bbbaaaaa", "baaaaabd"],
      ["adebbaaa", "bbbaaaaa", "baaeaaab", "aaaaabbe", "aaadbbaa", "abbbaaaa", "bbbaaaaa", "baaaaadd"],
    ],
  },

  alert: {
    description:
      "Orange exclamation mark that glows up and down (never off, never inverts) — INPUT NEEDED / waiting on the human. Bordered top and bottom; brightness breathes low→high→low on one hue (baked steps survive low board brightness). Loops forever. Show when blocked on a question or permission.",
    frame_ms: 120,
    loop: 0,
    // One orange hue at 6 baked brightness steps (R on the band centers 64..235 plus a
    // 255 peak) so the glow stays distinct at bri 5. A = dimmest floor (still lit), F = peak.
    colors: {
      A: "#401800",
      B: "#6b2800",
      C: "#953800",
      D: "#c04800",
      E: "#eb5800",
      F: "#ff6000",
    },
    frames: [
      // glow up A→F then back down to B; loops smoothly through the floor (A)
      [
        "........",
        "...AA...",
        "...AA...",
        "...AA...",
        "........",
        "...AA...",
        "...AA...",
        "........",
      ],
      [
        "........",
        "...BB...",
        "...BB...",
        "...BB...",
        "........",
        "...BB...",
        "...BB...",
        "........",
      ],
      [
        "........",
        "...CC...",
        "...CC...",
        "...CC...",
        "........",
        "...CC...",
        "...CC...",
        "........",
      ],
      [
        "........",
        "...DD...",
        "...DD...",
        "...DD...",
        "........",
        "...DD...",
        "...DD...",
        "........",
      ],
      [
        "........",
        "...EE...",
        "...EE...",
        "...EE...",
        "........",
        "...EE...",
        "...EE...",
        "........",
      ],
      [
        "........",
        "...FF...",
        "...FF...",
        "...FF...",
        "........",
        "...FF...",
        "...FF...",
        "........",
      ],
      [
        "........",
        "...EE...",
        "...EE...",
        "...EE...",
        "........",
        "...EE...",
        "...EE...",
        "........",
      ],
      [
        "........",
        "...DD...",
        "...DD...",
        "...DD...",
        "........",
        "...DD...",
        "...DD...",
        "........",
      ],
      [
        "........",
        "...CC...",
        "...CC...",
        "...CC...",
        "........",
        "...CC...",
        "...CC...",
        "........",
      ],
      [
        "........",
        "...BB...",
        "...BB...",
        "...BB...",
        "........",
        "...BB...",
        "...BB...",
        "........",
      ],
    ],
  },

  working: {
    description:
      "Snake spinner — a 3-chunk (2x2) comet chases clockwise around the panel's perimeter, bright head with a dimming trail. Busy on a long task (compiling, searching, running a workflow). Loops until replaced; show at task start, replace with done/check/cross at the end.",
    frame_ms: 80,
    // A = bright head, B = mid trail, C = dim tail. Three brightness steps of one
    // cyan-white hue, kept high enough to stay visible at low board brightness.
    colors: { A: "#c8e6ff", B: "#5a6773", C: "#2c3338" },
    frames: [
      [
        "AA......",
        "AA......",
        "BB......",
        "BB......",
        "CC......",
        "CC......",
        "........",
        "........",
      ],
      [
        "BBAA....",
        "BBAA....",
        "CC......",
        "CC......",
        "........",
        "........",
        "........",
        "........",
      ],
      [
        "CCBBAA..",
        "CCBBAA..",
        "........",
        "........",
        "........",
        "........",
        "........",
        "........",
      ],
      [
        "..CCBBAA",
        "..CCBBAA",
        "........",
        "........",
        "........",
        "........",
        "........",
        "........",
      ],
      [
        "....CCBB",
        "....CCBB",
        "......AA",
        "......AA",
        "........",
        "........",
        "........",
        "........",
      ],
      [
        "......CC",
        "......CC",
        "......BB",
        "......BB",
        "......AA",
        "......AA",
        "........",
        "........",
      ],
      [
        "........",
        "........",
        "......CC",
        "......CC",
        "......BB",
        "......BB",
        "......AA",
        "......AA",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "......CC",
        "......CC",
        "....AABB",
        "....AABB",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "........",
        "........",
        "..AABBCC",
        "..AABBCC",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "........",
        "........",
        "AABBCC..",
        "AABBCC..",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "AA......",
        "AA......",
        "BBCC....",
        "BBCC....",
      ],
      [
        "........",
        "........",
        "AA......",
        "AA......",
        "BB......",
        "BB......",
        "CC......",
        "CC......",
      ],
    ],
  },

  party: {
    description:
      "Falling multicolor confetti — celebration, big win, milestone shipped. 16 pieces drift down continuously; the 8 frames loop seamlessly.",
    frame_ms: 130,
    colors: { M: "#ff28b4", C: "#28c8ff", Y: "#ffc800", G: "#00c83c", W: "#ffffff" },
    frames: [
      ["..W...C.", "M...G...", "...Y...W", ".C...M..", "..M...G.", "Y...W...", "...C...M", ".G...Y.."],
      [".G...Y..", "..W...C.", "M...G...", "...Y...W", ".C...M..", "..M...G.", "Y...W...", "...C...M"],
      ["...C...M", ".G...Y..", "..W...C.", "M...G...", "...Y...W", ".C...M..", "..M...G.", "Y...W..."],
      ["Y...W...", "...C...M", ".G...Y..", "..W...C.", "M...G...", "...Y...W", ".C...M..", "..M...G."],
      ["..M...G.", "Y...W...", "...C...M", ".G...Y..", "..W...C.", "M...G...", "...Y...W", ".C...M.."],
      [".C...M..", "..M...G.", "Y...W...", "...C...M", ".G...Y..", "..W...C.", "M...G...", "...Y...W"],
      ["...Y...W", ".C...M..", "..M...G.", "Y...W...", "...C...M", ".G...Y..", "..W...C.", "M...G..."],
      ["M...G...", "...Y...W", ".C...M..", "..M...G.", "Y...W...", "...C...M", ".G...Y..", "..W...C."],
    ],
  },

  spaceship: {
    description:
      "Rocket pointing up with a thrusting flame — playful, 'off we go', kicking something off. The ship is fixed in the top rows; the 2-wide flame's red ember scrolls down through orange to read as upward thrust.",
    frame_ms: 160,
    colors: { R: "#ff2828", O: "#ff8c00", W: "#ffffff", B: "#2060ff" },
    frames: [
      ["...RR...", "..RWWR..", "..WBBW..", ".RWWWWR.", ".R.WW.R.", "...RR...", "...OO...", "...OO..."],
      ["...RR...", "..RWWR..", "..WBBW..", ".RWWWWR.", ".R.WW.R.", "...OO...", "...RR...", "...OO..."],
      ["...RR...", "..RWWR..", "..WBBW..", ".RWWWWR.", ".R.WW.R.", "...OO...", "...OO...", "...RR..."],
    ],
  },

  sleep: {
    description: "Drifting Zz — idle, waiting quietly, nothing needs attention.",
    frame_ms: 600,
    colors: { W: "#b4c8e6", B: "#32509b" },
    frames: [
      [
        "WWWW....",
        "..WW....",
        ".WW.....",
        "WWWW....",
        ".....BBB",
        "......B.",
        ".....B..",
        ".....BBB",
      ],
      [
        "WWWW....",
        "..WW....",
        ".WW.....",
        "WWWW....",
        "........",
        "........",
        "........",
        "........",
      ],
    ],
  },
};

// ── Conversion to the firmware wire format ─────────────────────────────────
// One frame → 384 hex chars (RRGGBB × 64 pixels, row-major).

export function artToFrameHex(rows: string[], colors: Record<string, string>): string {
  if (!Array.isArray(rows) || rows.length !== 8) {
    throw new Error("each frame must be exactly 8 rows");
  }
  let out = "";
  for (const row of rows) {
    if (typeof row !== "string" || row.length !== 8) {
      throw new Error(`each row must be exactly 8 characters (got "${row}")`);
    }
    for (const ch of row) {
      if (ch === ".") { out += "000000"; continue; }
      const hex = colors[ch];
      if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) {
        throw new Error(`character '${ch}' has no valid color in the colors map`);
      }
      out += hex.replace("#", "").toLowerCase();
    }
  }
  return out;
}

export function expressionToWire(e: Expression): { frames: string[]; frame_ms: number; loop: number } {
  if (!Array.isArray(e.frames) || e.frames.length < 1 || e.frames.length > MAX_FRAMES) {
    throw new Error(`frames must be 1-${MAX_FRAMES} frames`);
  }
  return {
    frames: e.frames.map((f) => artToFrameHex(f, e.colors)),
    frame_ms: e.frame_ms ?? 150,
    loop: e.loop ?? 0,
  };
}
