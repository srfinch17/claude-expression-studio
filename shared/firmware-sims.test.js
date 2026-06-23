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
