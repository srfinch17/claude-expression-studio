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

test("matrix_rain sim yields in-bounds frames and at least one lit pixel after warm-up", () => {
  const sim = FIRMWARE_SIMS.matrix_rain({ theme: "classic", frame_ms: 60 });
  assert.equal(typeof sim.frame_ms, "number");
  assert.equal(sim.frame_ms, 60);
  // run 20 warm-up frames (drops need time to travel onto screen from staggered start above)
  for (let i = 0; i < 20; i++) sim.frame();
  // run 50 more frames: check in-bounds and invariant
  for (let i = 0; i < 50; i++) {
    const px = sim.frame();
    assertInBounds(px);
    assert.ok(px.length > 0, "at least one lit pixel after warm-up");
  }
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

test("every FIRMWARE_SIMS entry is a factory that produces in-bounds frames", () => {
  for (const [name, make] of Object.entries(FIRMWARE_SIMS)) {
    const sim = make();
    assert.equal(typeof sim.frame_ms, "number", `${name}: frame_ms is a number`);
    assert.ok(sim.frame_ms > 0, `${name}: frame_ms > 0`);
    for (let i = 0; i < 30; i++) assertInBounds(sim.frame());
  }
});
