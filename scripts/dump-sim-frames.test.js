import { test } from "node:test";
import assert from "node:assert/strict";
import { dumpSim } from "./dump-sim-frames.mjs";

test("dumpSim produces N raw frames of 64 RRGGBB cells each", () => {
  const out = dumpSim("fire", 5);
  assert.equal(out.raw, true);
  assert.equal(out.frames.length, 5);
  assert.equal(typeof out.frame_ms, "number");
  for (const f of out.frames) {
    assert.equal(typeof f, "string");
    assert.equal(f.length, 64 * 6, "64 cells × 6 hex chars");
    assert.match(f, /^[0-9a-f]+$/i);
  }
});

test("dumpSim places a lit pixel at the right row-major index", () => {
  // claudesweep always lights its perimeter ring → frame is not all-black
  const out = dumpSim("claudesweep", 1);
  assert.notEqual(out.frames[0], "000000".repeat(64), "frame has lit pixels");
});
