import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWebSimRenderer } from "./web-sim.js";

function fakePanel() {
  const calls = { frames: [], steppers: [] };
  return {
    panel: {
      setFrames: (f, ms) => calls.frames.push({ count: f.length, ms }),
      setStepper: (fn, ms) => calls.steppers.push({ ms, sample: fn() }),
    },
    calls,
  };
}

const firmwareSims = { claudesweep: { frame_ms: 90, frame: () => [{ x: 0, y: 0, r: 255, g: 176, b: 0 }] } };
const loadExpression = (n) => n === "done"
  ? { frames: [["G.......","","","","","","",""], ["........","","","","","","",""]], colors: { G: "#00c83c" }, frame_ms: 120, loop: 0 }
  : null;

test("web-sim renderer id is web-sim", () => {
  const { panel } = fakePanel();
  assert.equal(makeWebSimRenderer({ panel, loadExpression, firmwareSims }).id, "web-sim");
});

test("a frame-expression name is resolved to pixel frames and set on the panel", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims }).render("done");
  assert.equal(f.calls.frames.length, 1);
  assert.equal(f.calls.frames[0].count, 2);   // two frames resolved
  assert.equal(f.calls.frames[0].ms, 120);
  assert.equal(f.calls.steppers.length, 0);
});

test("a firmware-sim name drives the panel via setStepper", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims }).render("claudesweep");
  assert.equal(f.calls.steppers.length, 1);
  assert.equal(f.calls.steppers[0].ms, 90);
  assert.equal(f.calls.steppers[0].sample[0].r, 255);
  assert.equal(f.calls.frames.length, 0);
});

test("an unknown name no-ops (panel untouched)", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims }).render("ghost");
  assert.equal(f.calls.frames.length, 0);
  assert.equal(f.calls.steppers.length, 0);
});
