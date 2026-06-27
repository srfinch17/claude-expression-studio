import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRMWARE_SIMS } from "./firmware-sims.js";

function assertInBounds(px) {
  for (const p of px) {
    assert.ok(p.x >= 0 && p.x < 8 && p.y >= 0 && p.y < 8, `pixel in bounds: ${JSON.stringify(p)}`);
    for (const ch of ["r", "g", "b"]) assert.ok(p[ch] >= 0 && p[ch] <= 255, `${ch} 0..255`);
  }
}

test("claudesweep sim yields in-bounds frames across a full cycle", () => {
  const sim = FIRMWARE_SIMS.claudesweep();
  assert.equal(typeof sim.frame_ms, "number");
  for (let i = 0; i < 60; i++) assertInBounds(sim.frame());
});

test("claudesweep ring is always lit (>= ~28 perimeter pixels)", () => {
  const sim = FIRMWARE_SIMS.claudesweep();
  const px = sim.frame();
  assert.ok(px.length >= 28, "ring + mascot pixels present");
});

test("frostbite sim yields 64 in-bounds mist pixels every frame", () => {
  const sim = FIRMWARE_SIMS.frostbite();
  for (let i = 0; i < 50; i++) {
    const px = sim.frame();
    assertInBounds(px);
    assert.ok(px.length >= 64, "all 64 mist pixels lit");
  }
});

test("fire sim yields in-bounds frames and is not all-black after warm-up", () => {
  const sim = FIRMWARE_SIMS.fire({ palette: "classic", intensity: 6 });
  assert.equal(typeof sim.frame_ms, "number");
  // run 10 warm-up frames
  for (let i = 0; i < 10; i++) sim.frame();
  // run 50 more frames and check bounds + at least one lit pixel
  for (let i = 0; i < 50; i++) {
    const px = sim.frame();
    assertInBounds(px);
    assert.ok(px.length > 0, "not all-black after warm-up");
  }
});

test("matrix_rain sim yields in-bounds frames and stays lit through the window", () => {
  const sim = FIRMWARE_SIMS.matrix_rain({ theme: "classic", frame_ms: 60 });
  assert.equal(typeof sim.frame_ms, "number");
  assert.equal(sim.frame_ms, 60);
  // run 20 warm-up frames (drops need time to travel onto screen from staggered start above)
  for (let i = 0; i < 20; i++) sim.frame();
  // run 50 more frames: every frame must be in-bounds; tally how many are lit
  let litFrames = 0;
  for (let i = 0; i < 50; i++) {
    const px = sim.frame();
    assertInBounds(px);
    if (px.length > 0) litFrames++;
  }
  // The 8 columns each go briefly dark between fall cycles, so an all-dark frame is rare-but-VALID
  // (all 8 aligning dark ≈ 0.04%/frame) — not a bug. The old per-frame "px.length > 0" assertion
  // flaked on that alignment. Assert the sim is lit across the vast majority of the window instead
  // (expected ~50/50; P(<45) is astronomically small), which still catches a broken/all-black sim
  // without pinning to a brittle RNG seed.
  assert.ok(litFrames >= 45, `rain lit in most frames (got ${litFrames}/50)`);
});

test("snow sim yields in-bounds frames and floor bank present after accumulation", () => {
  const sim = FIRMWARE_SIMS.snow({ frame_ms: 110, flakeColor: "#dce6ff" });
  assert.equal(typeof sim.frame_ms, "number");
  // run 50 frames — floor bank is always drawn so it's present from frame 1
  for (let i = 0; i < 50; i++) {
    const px = sim.frame();
    assertInBounds(px);
    // floor bank invariant: SNOW_FLOOR_TOP means row 7 is always lit for all 8 cols
    // plus cols 2 & 5 also have a pixel at row 6 → at least 8 bottom-row pixels
    const row7 = px.filter((p) => p.y === 7);
    assert.ok(row7.length >= 8, `floor bank: at least 8 row-7 pixels (got ${row7.length})`);
  }
});

test("fireworks sim yields in-bounds frames and a burst occurs in a 100-frame window", () => {
  const sim = FIRMWARE_SIMS.fireworks({ color1: "#ff0050", color2: "#00e0ff", color3: "#ffd000" });
  assert.equal(typeof sim.frame_ms, "number");
  let burstSeen = false;
  for (let i = 0; i < 100; i++) {
    const px = sim.frame();
    assertInBounds(px);
    if (px.length >= 3) burstSeen = true;
  }
  assert.ok(burstSeen, "at least one frame with ≥3 lit pixels (a burst) in 100-frame window");
});

test("dancefloor sim yields in-bounds frames and many pixels lit every frame", () => {
  const sim = FIRMWARE_SIMS.dancefloor({ palette: 0, hold: 6 });
  assert.equal(typeof sim.frame_ms, "number");

  // Capture early-frame pixel colors
  const earlyPx = sim.frame();
  assertInBounds(earlyPx);
  assert.equal(earlyPx.length, 64, `tiled floor always emits exactly 64 pixels (got ${earlyPx.length})`);
  const earlyColors = earlyPx.map((p) => `${p.r},${p.g},${p.b}`).join("|");

  // Run ~40 more frames, checking bounds and pixel count each time
  let laterPx;
  for (let i = 0; i < 40; i++) {
    laterPx = sim.frame();
    assertInBounds(laterPx);
    assert.equal(laterPx.length, 64, `tiled floor always emits exactly 64 pixels (frame ${i + 2})`);
  }

  // State machine must cycle: colors after ~40 frames must not be identical to the first frame
  const laterColors = laterPx.map((p) => `${p.r},${p.g},${p.b}`).join("|");
  assert.notEqual(laterColors, earlyColors, "dancefloor colors must change over time (state machine cycled)");
});

test("rainbow: vertical hue stripes that scroll", () => {
  const sim = FIRMWARE_SIMS.rainbow();
  const a = sim.frame();
  for (let i = 0; i < 5; i++) sim.frame();
  const b = sim.frame();
  assertInBounds(a); assertInBounds(b);
  assert.equal(a.length, 64, "every cell is lit (solid stripes)");
  // A column is one solid hue → all 8 cells in column 0 share a color.
  const col0 = a.filter((p) => p.x === 0);
  assert.ok(col0.every((p) => p.r === col0[0].r && p.g === col0[0].g && p.b === col0[0].b), "column 0 is one hue");
  // Adjacent columns differ (distinct stripes).
  const c4 = a.find((p) => p.x === 4 && p.y === 0);
  assert.ok(c4.r !== col0[0].r || c4.g !== col0[0].g || c4.b !== col0[0].b, "columns differ");
  // It scrolls: column 0's color changes over time.
  const b0 = b.find((p) => p.x === 0 && p.y === 0);
  assert.ok(b0.r !== col0[0].r || b0.g !== col0[0].g || b0.b !== col0[0].b, "hue advances over frames");
});

test("breathe: whole panel pulses brightness over time", () => {
  const sim = FIRMWARE_SIMS.breathe();
  let minSum = Infinity, maxSum = -Infinity;
  for (let i = 0; i < 120; i++) {
    const f = sim.frame();
    assertInBounds(f);
    const sum = f.reduce((a, p) => a + p.r + p.g + p.b, 0);
    minSum = Math.min(minSum, sum); maxSum = Math.max(maxSum, sum);
  }
  assert.ok(maxSum > 0, "panel lights up");
  assert.ok(maxSum - minSum > maxSum * 0.3, "brightness clearly oscillates (breathing)");
});

test("wave: a filled water surface that rolls and varies by column", () => {
  const sim = FIRMWARE_SIMS.wave();
  const a = sim.frame();
  assertInBounds(a);
  assert.ok(a.length > 0 && a.length < 64, "partially filled (water below a wavy surface)");
  // Different columns have different fill heights (a wave, not a flat line).
  const heightOf = (frame, x) => frame.filter((p) => p.x === x).length;
  const heights = [0,1,2,3,4,5,6,7].map((x) => heightOf(a, x));
  assert.ok(new Set(heights).size > 1, "columns have differing heights");
  // It rolls: the lit set changes over time.
  for (let i = 0; i < 4; i++) sim.frame();
  const b = sim.frame();
  assert.notDeepEqual(a.map((p)=>`${p.x},${p.y}`).sort(), b.map((p)=>`${p.x},${p.y}`).sort());
});

test("comet: bright head at the right edge, bobbing, with a trailing tail", () => {
  const sim = FIRMWARE_SIMS.comet();
  const frames = [];
  for (let i = 0; i < 40; i++) { const f = sim.frame(); assertInBounds(f); frames.push(f); }
  // Head lives at the right edge (cols 6–7) and is present every frame.
  for (const f of frames) assert.ok(f.some((p) => p.x >= 6), "head at right edge");
  // There is a tail to the left of the head (cols < 6 lit at least sometimes).
  assert.ok(frames.some((f) => f.some((p) => p.x <= 5)), "tail extends left");
  // It bobs: the head's row changes across frames.
  const headRow = (f) => Math.min(...f.filter((p) => p.x === 7).map((p) => p.y));
  const rows = new Set(frames.map(headRow));
  assert.ok(rows.size > 1, "head bobs vertically");
});

test("starfield: a modest set of moving star pixels that changes over time", () => {
  const sim = FIRMWARE_SIMS.starfield();
  const a = sim.frame();
  assertInBounds(a);
  assert.ok(a.length > 0 && a.length <= 16, "≤16 stars, some lit");
  for (let i = 0; i < 6; i++) sim.frame();
  const b = sim.frame();
  assert.notDeepEqual(
    a.map((p) => `${p.x},${p.y}`).sort(),
    b.map((p) => `${p.x},${p.y}`).sort(),
    "stars move/respawn over time",
  );
});

test("spiral: whole board lit, gradient slides each frame", () => {
  const sim = FIRMWARE_SIMS.spiral();
  const a = sim.frame();
  assertInBounds(a);
  assert.equal(a.length, 64, "every cell lit");
  // The path covers all 64 distinct cells.
  assert.equal(new Set(a.map((p) => `${p.x},${p.y}`)).size, 64, "covers all cells once");
  // The gradient slides: a fixed cell's color changes frame to frame.
  for (let i = 0; i < 3; i++) sim.frame();
  const b = sim.frame();
  const at = (f, x, y) => f.find((p) => p.x === x && p.y === y);
  const pa = at(a, 0, 0), pb = at(b, 0, 0);
  assert.ok(pa.r !== pb.r || pa.g !== pb.g || pa.b !== pb.b, "gradient advances");
});

const SUN_BX = [3, 6, 7, 6, 4, 1, 0, 1];
const SUN_BY = [0, 1, 3, 6, 7, 6, 4, 1];

test("sun: a steady central disc with dots orbiting the ring", () => {
  const sim = FIRMWARE_SIMS.sun();
  const a = sim.frame();
  assertInBounds(a);
  // Disc: the 4 inner cells (3,3)(4,3)(3,4)(4,4) are always lit.
  for (const [x, y] of [[3,3],[4,3],[3,4],[4,4]]) {
    assert.ok(a.some((p) => p.x === x && p.y === y), `disc lit at ${x},${y}`);
  }
  // Some dots sit on ring positions; the ring lights shift over frames.
  const ringLit = (f) => SUN_BX.map((bx, i) => f.some((p) => p.x === bx && p.y === SUN_BY[i])).join("");
  const r0 = ringLit(a);
  let moved = false;
  for (let i = 0; i < 8; i++) { if (ringLit(sim.frame()) !== r0) { moved = true; break; } }
  assert.ok(moved, "ring dots orbit");
});

test("liquid: roughly half-filled fluid whose region shifts as gravity rotates", () => {
  const sim = FIRMWARE_SIMS.liquid();
  let counts = [];
  const sets = [];
  for (let i = 0; i < 80; i++) {
    const f = sim.frame();
    assertInBounds(f);
    counts.push(f.length);
    if (i % 20 === 0) sets.push(new Set(f.map((p) => `${p.x},${p.y}`)));
  }
  const avg = counts.reduce((a, c) => a + c, 0) / counts.length;
  assert.ok(avg > 16 && avg < 56, `~half filled (avg ${avg.toFixed(1)})`);
  // The filled region moves as the synthetic gravity rotates.
  const same = [...sets[0]].filter((k) => sets[sets.length - 1].has(k)).length;
  assert.ok(same < sets[0].size, "filled region shifts over time");
});

test("every FIRMWARE_SIMS entry is a factory that produces in-bounds frames", () => {
  for (const [name, make] of Object.entries(FIRMWARE_SIMS)) {
    const sim = make();
    assert.equal(typeof sim.frame_ms, "number", `${name}: frame_ms is a number`);
    assert.ok(sim.frame_ms > 0, `${name}: frame_ms > 0`);
    for (let i = 0; i < 30; i++) assertInBounds(sim.frame());
  }
});
