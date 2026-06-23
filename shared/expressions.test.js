import { test } from "node:test";
import assert from "node:assert/strict";
import { hexRGB, resolveFrame, resolveExpression } from "./expressions.js";

test("hexRGB parses #rrggbb to [r,g,b]", () => {
  assert.deepEqual(hexRGB("#ff5008"), [255, 80, 8]);
  assert.deepEqual(hexRGB("000000"), [0, 0, 0]);
});

test("resolveFrame skips '.' and unmapped chars, emits lit pixels with coords", () => {
  const rows = [
    "R.......",
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    ".......X", // X not in colors → skipped
  ];
  const px = resolveFrame(rows, { R: "#ff5008" });
  assert.equal(px.length, 1);
  assert.deepEqual(px[0], { x: 0, y: 0, r: 255, g: 80, b: 8 });
});

test("resolveExpression resolves every frame and defaults frame_ms/loop", () => {
  const e = resolveExpression({
    frames: [["R.......","........","........","........","........","........","........","........"]],
    colors: { R: "#ffffff" },
  });
  assert.equal(e.frame_ms, 150);
  assert.equal(e.loop, 0);
  assert.equal(e.frames.length, 1);
  assert.deepEqual(e.frames[0][0], { x: 0, y: 0, r: 255, g: 255, b: 255 });
});
