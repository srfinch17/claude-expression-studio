import { test } from "node:test";
import assert from "node:assert/strict";
import { artToHex, expressionToWire } from "./wire.js";

test("artToHex maps lit cells to RRGGBB and off cells to 000000, row-major", () => {
  const rows = ["A.......", "........", "........", "........", "........", "........", "........", ".......B"];
  const hex = artToHex(rows, { A: "#ff0000", B: "#00ff00" });
  assert.equal(hex.length, 384);                 // 64 cells * 6
  assert.equal(hex.slice(0, 6), "ff0000");        // (0,0) = A
  assert.equal(hex.slice(6, 12), "000000");       // (1,0) = off
  assert.equal(hex.slice(63 * 6), "00ff00");      // (7,7) = B
});

test("expressionToWire converts all frames + carries frame_ms/loop", () => {
  const json = { frames: [["A.......", "", "", "", "", "", "", ""]], colors: { A: "#010203" }, frame_ms: 90, loop: 2 };
  const wire = expressionToWire(json);
  assert.equal(wire.frames.length, 1);
  assert.equal(wire.frames[0].slice(0, 6), "010203");
  assert.equal(wire.frame_ms, 90);
  assert.equal(wire.loop, 2);
});

test("expressionToWire defaults frame_ms=150 loop=0", () => {
  const wire = expressionToWire({ frames: [["........","","","","","","",""]], colors: {} });
  assert.equal(wire.frame_ms, 150);
  assert.equal(wire.loop, 0);
});
