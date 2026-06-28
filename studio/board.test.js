import { test } from "node:test";
import assert from "node:assert/strict";
import { framesFromWire, framesFromPx, applyEvent, mirrorGate, buildPlaylists, mirrorOkAt, MIRROR_GRACE_MS } from "./board.js";

test("mirrorOkAt holds the mirror through brief gaps, drops after the grace window", () => {
  assert.equal(mirrorOkAt(0, 1000), false);                           // never polled → not ok
  assert.equal(mirrorOkAt(1000, 1000), true);                         // just polled
  assert.equal(mirrorOkAt(1000, 1000 + MIRROR_GRACE_MS - 1), true);   // within grace → still ok (rides a hiccup)
  assert.equal(mirrorOkAt(1000, 1000 + MIRROR_GRACE_MS), false);      // grace elapsed → drop
  assert.equal(mirrorOkAt(1000, 1000 + 5000), false);                 // long gone
});

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

test("mirrorGate: SSE draws only when the board is offline", () => {
  assert.equal(mirrorGate(true), false);   // board online → framebuffer is the truth, ignore SSE
  assert.equal(mirrorGate(false), true);    // board offline → SSE is the only source
});

test("buildPlaylists: ambient follows showcase order, skips unknown names, tags kinds", () => {
  const fakeGallery = {
    expressions: [
      { name: "galaxy", frames: [["........", "........", "........", "........", "........", "........", "........", "........"]], colors: {}, frame_ms: 120 },
      { name: "smiley", frames: [["........"]], colors: {}, frame_ms: 150 },
    ],
    firmware: ["fire", "snow"],
  };
  const { ambient, all } = buildPlaylists(fakeGallery, ["fire", "snow"], ["fire", "galaxy", "nope"]);
  assert.deepEqual(ambient.map((i) => i.name), ["fire", "galaxy"]); // "nope" skipped
  assert.equal(ambient[0].kind, "firmware");
  assert.equal(ambient[1].kind, "expression");
  assert.equal(ambient[1].entry.name, "galaxy");
  assert.equal(ambient[0].entry, null);
  // all = every renderable: firmware first, then expressions
  assert.deepEqual(all.map((i) => i.name), ["fire", "snow", "galaxy", "smiley"]);
});

// --- arbitrate, nextIndex, isEngineResponse, DECAY_MS ---

import { arbitrate, nextIndex, isEngineResponse, DECAY_MS } from "./board.js";

test("arbitrate: mirror wins over everything", () => {
  assert.equal(arbitrate({ mirrorOk: true, lastSseAt: 1000, now: 1000, pinned: true }), "mirror");
});

test("arbitrate: live while an SSE event is within DECAY_MS, not mirror", () => {
  const now = 100000;
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: now - 1000, now, pinned: true }), "live");
  // stale SSE -> not live
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: now - DECAY_MS - 1, now, pinned: false }), "ambient");
  // never any SSE -> not live
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: null, now, pinned: false }), "ambient");
});

test("arbitrate: pin when nothing live/mirror and a pin is held", () => {
  assert.equal(arbitrate({ mirrorOk: false, lastSseAt: null, now: 5, pinned: true }), "pin");
});

test("nextIndex: never repeats the current index when length > 1", () => {
  // length 1 -> always 0
  assert.equal(nextIndex(0, 1, () => 0.9), 0);
  // rng 0 from cur 0, length 3 -> 0 maps to slot, skips cur -> 1
  assert.equal(nextIndex(0, 3, () => 0), 1);
  // rng ~1 from cur 0, length 3 -> last other slot -> 2
  assert.equal(nextIndex(0, 3, () => 0.999), 2);
  // rng 0 from cur 2, length 3 -> 0 (< cur, no skip)
  assert.equal(nextIndex(2, 3, () => 0), 0);
  // exhaustive: result is always in range and never equals cur
  for (let cur = 0; cur < 4; cur++) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const n = nextIndex(cur, 4, () => r);
      assert.ok(n >= 0 && n < 4 && n !== cur, `cur=${cur} r=${r} -> ${n}`);
    }
  }
});

test("isEngineResponse: true for our routes (200/503), false otherwise", () => {
  assert.equal(isEngineResponse(200), true);
  assert.equal(isEngineResponse(503), true);
  assert.equal(isEngineResponse(404), false);
  assert.equal(isEngineResponse(0), false);
});
