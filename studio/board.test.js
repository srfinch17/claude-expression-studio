import { test } from "node:test";
import assert from "node:assert/strict";
import { framesFromWire, framesFromPx, applyEvent } from "./board.js";

// one all-off frame except pixel (0,0) red: 64 hex strings
function wireOneRed() {
  const cells = Array.from({ length: 64 }, (_, i) => (i === 0 ? "ff0000" : "000000"));
  return { frames: [cells.join("")], frame_ms: 150, loop: 0 };
}

test("framesFromWire decodes lit pixels row-major, drops off pixels", () => {
  const frames = framesFromWire(wireOneRed());
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], [{ x: 0, y: 0, r: 255, g: 0, b: 0 }]);
});

test("applyEvent frames -> panel.setFrames with decoded frames + frame_ms", () => {
  const calls = [];
  const panel = { setFrames: (f, ms) => calls.push(["frames", f, ms]) };
  applyEvent({ kind: "frames", wire: wireOneRed() }, { panel, webSim: { render() {} } });
  assert.equal(calls[0][0], "frames");
  assert.equal(calls[0][2], 150);
  assert.deepEqual(calls[0][1][0], [{ x: 0, y: 0, r: 255, g: 0, b: 0 }]);
});

test("applyEvent animation -> webSim.render(type)", () => {
  const seen = [];
  applyEvent({ kind: "animation", type: "fire" }, { panel: {}, webSim: { render: (n) => seen.push(n) } });
  assert.deepEqual(seen, ["fire"]);
});

test("applyEvent noop does nothing", () => {
  assert.doesNotThrow(() => applyEvent({ kind: "noop" }, { panel: {}, webSim: { render() {} } }));
});

test("framesFromPx decodes a 64-entry px array to lit pixels, row-major", () => {
  const px = Array.from({ length: 64 }, (_, i) => (i === 9 ? "00ff00" : "000000"));
  const frame = framesFromPx(px);
  // index 9 => x=1, y=1, green
  assert.deepEqual(frame, [{ x: 1, y: 1, r: 0, g: 255, b: 0 }]);
});

test("framesFromPx drops off pixels and tolerates a bad px", () => {
  assert.deepEqual(framesFromPx([]), []);
  assert.deepEqual(framesFromPx(null), []);
  const allOff = Array.from({ length: 64 }, () => "000000");
  assert.deepEqual(framesFromPx(allOff), []);
});
