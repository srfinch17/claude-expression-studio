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
    description: "Red heart — appreciation, warmth, 'love it'.",
    colors: { R: "#ff1432" },
    frames: [[
      ".RR..RR.",
      "RRRRRRRR",
      "RRRRRRRR",
      "RRRRRRRR",
      ".RRRRRR.",
      "..RRRR..",
      "...RR...",
      "........",
    ]],
  },

  check: {
    description: "Green checkmark — success, confirmed, tests pass.",
    colors: { G: "#00d23c" },
    frames: [[
      "........",
      ".......G",
      "......GG",
      "G....GG.",
      "GG..GG..",
      ".GGGG...",
      "..GG....",
      "........",
    ]],
  },

  cross: {
    description: "Red X — failure, error, 'no'.",
    colors: { R: "#ff2814" },
    frames: [[
      "RR....RR",
      ".RR..RR.",
      "..RRRR..",
      "...RR...",
      "..RRRR..",
      ".RR..RR.",
      "RR....RR",
      "........",
    ]],
  },

  thumbsup: {
    description: "Thumbs up — approval, good job, agreed.",
    colors: { A: "#ffb414" },
    frames: [[
      "...AA...",
      "...AA...",
      "..AAA...",
      ".AAAAAA.",
      ".AAAAAA.",
      ".AAAAAA.",
      "..AAAA..",
      "........",
    ]],
  },

  question: {
    description: "White question mark — confused, ambiguous result, 'which one?'.",
    colors: { W: "#e6e6f0" },
    frames: [[
      "..WWWW..",
      ".WW..WW.",
      ".....WW.",
      "....WW..",
      "...WW...",
      "...WW...",
      "........",
      "...WW...",
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
    description: "Twinkling white diamond — something delightful, a nice find, magic moment.",
    frame_ms: 220,
    colors: { W: "#ffffff", B: "#1e3c64" },
    frames: [
      [
        "........",
        "...W....",
        "..WWW...",
        ".WWWWW..",
        "..WWW...",
        "...W....",
        "........",
        "........",
      ],
      [
        "W......W",
        "...B....",
        "..BWB...",
        ".BWWWB..",
        "..BWB...",
        "...B....",
        "W......W",
        "........",
      ],
    ],
  },

  alert: {
    description:
      "Blinking amber exclamation mark — INPUT NEEDED / waiting on the human. Loops until replaced; show this when blocked on a question or permission.",
    frame_ms: 350,
    colors: { A: "#ffa000", D: "#3c2800" },
    frames: [
      [
        "...AA...",
        "...AA...",
        "...AA...",
        "...AA...",
        "...AA...",
        "........",
        "...AA...",
        "...AA...",
      ],
      [
        "...DD...",
        "...DD...",
        "...DD...",
        "...DD...",
        "...DD...",
        "........",
        "...DD...",
        "...DD...",
      ],
    ],
  },

  working: {
    description:
      "Orbiting block spinner — busy on a long task (compiling, searching, running a workflow). Loops until replaced; show at task start, replace with done/check/cross at the end.",
    frame_ms: 180,
    colors: { W: "#c8e6ff", C: "#143c50" },
    frames: [
      [
        "WW......",
        "WW......",
        "........",
        "...CC...",
        "...CC...",
        "........",
        "........",
        "........",
      ],
      [
        "......WW",
        "......WW",
        "........",
        "...CC...",
        "...CC...",
        "........",
        "........",
        "........",
      ],
      [
        "........",
        "........",
        "........",
        "...CC...",
        "...CC...",
        "........",
        "......WW",
        "......WW",
      ],
      [
        "........",
        "........",
        "........",
        "...CC...",
        "...CC...",
        "........",
        "WW......",
        "WW......",
      ],
    ],
  },

  done: {
    description:
      "Task complete — the whole panel blinks green twice, then holds a checkmark. The 'I finished' signal.",
    frame_ms: 220,
    loop: 1,
    colors: { G: "#00c83c", C: "#00d23c" },
    frames: [
      ALL("GGGGGGGG"),
      ALL("........"),
      ALL("GGGGGGGG"),
      ALL("........"),
      [
        "........",
        ".......C",
        "......CC",
        "C....CC.",
        "CC..CC..",
        ".CCCC...",
        "..CC....",
        "........",
      ],
    ],
  },

  party: {
    description: "Firework burst — celebration, big win, milestone shipped.",
    frame_ms: 200,
    colors: { Y: "#ffc800", M: "#ff28b4", C: "#28c8ff", W: "#ffffff" },
    frames: [
      [
        "........",
        "........",
        "........",
        "...YY...",
        "...YY...",
        "........",
        "........",
        "........",
      ],
      [
        "........",
        "........",
        "...MM...",
        "..MYYM..",
        "..MYYM..",
        "...MM...",
        "........",
        "........",
      ],
      [
        "..CCCC..",
        ".C....C.",
        "C..MM..C",
        "C.MYYM.C",
        "C.MYYM.C",
        "C..MM..C",
        ".C....C.",
        "..CCCC..",
      ],
      [
        "W..C..W.",
        "........",
        "..M..M..",
        "........",
        ".C..Y..C",
        "........",
        "W..M..W.",
        "........",
      ],
    ],
  },

  spaceship: {
    description: "Little ship flying across with a flickering flame — playful, 'off we go', kicking something off.",
    frame_ms: 160,
    colors: { C: "#28b4ff", W: "#ffffff", R: "#ff3c00", Y: "#ffc800" },
    frames: [
      [
        "........",
        "........",
        "........",
        ".CCC....",
        "RCCCCW..",
        ".CCC....",
        "........",
        "........",
      ],
      [
        "........",
        "........",
        "........",
        "...CCC..",
        "..YCCCCW",
        "...CCC..",
        "........",
        "........",
      ],
      [
        "........",
        "........",
        "........",
        ".....CCC",
        "....RCCC",
        ".....CCC",
        "........",
        "........",
      ],
      [
        "........",
        "........",
        "........",
        ".......C",
        "......YC",
        ".......C",
        "........",
        "........",
      ],
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
