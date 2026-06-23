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
