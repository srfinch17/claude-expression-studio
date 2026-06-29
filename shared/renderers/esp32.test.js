import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEsp32Renderer } from "./esp32.js";

function harness() {
  const posted = { frames: [], anims: [] };
  const deps = {
    isFirmware: (n) => ["fire", "claudesweep"].includes(n),
    loadExpression: (n) => n === "done"
      ? { frames: [["G.......","","","","","","",""]], colors: { G: "#00c83c" }, frame_ms: 90, loop: 1 }
      : null,
    postFrames: async (w) => { posted.frames.push(w); },
    postAnimation: async (t, params) => { posted.anims.push({ t, params }); },
    setBrightness: async () => {},
  };
  return { deps, posted };
}

function richHarness() {
  const posted = { frames: [], anims: [], brightness: [] };
  const deps = {
    isFirmware: (n) => ["fire", "claudesweep"].includes(n),
    loadExpression: () => null,
    postFrames: async (w) => { posted.frames.push(w); },
    postAnimation: async (t, params) => { posted.anims.push({ t, params }); },
    setBrightness: async (level) => { posted.brightness.push(level); },
  };
  return { deps, posted };
}

test("esp32 renderer id is esp32-8x8", () => {
  assert.equal(makeEsp32Renderer(harness().deps).id, "esp32-8x8");
});

test("a frame-expression name is loaded, wired, and posted as frames", async () => {
  const h = harness();
  await makeEsp32Renderer(h.deps).render("done");
  assert.equal(h.posted.frames.length, 1);
  assert.equal(h.posted.frames[0].frame_ms, 90);
  assert.equal(h.posted.frames[0].frames[0].slice(0, 6), "00c83c");
  assert.equal(h.posted.anims.length, 0);
});

test("a firmware-animation name is posted via the animation endpoint, not frames", async () => {
  const h = harness();
  await makeEsp32Renderer(h.deps).render("fire");
  assert.deepEqual(h.posted.anims, [{ t: "fire", params: undefined }]);
  assert.equal(h.posted.frames.length, 0);
});

test("an unknown frame name no-ops (never throws, never posts)", async () => {
  const h = harness();
  await makeEsp32Renderer(h.deps).render("ghost");
  assert.equal(h.posted.frames.length, 0);
  assert.equal(h.posted.anims.length, 0);
});

test("a firmware pick applies meta.brightness then posts the animation with meta.params", async () => {
  const h = richHarness();
  await makeEsp32Renderer(h.deps).render("fire", { brightness: 5, params: { speed: 50, intensity: 70 } });
  assert.deepEqual(h.posted.brightness, [5]);
  assert.deepEqual(h.posted.anims, [{ t: "fire", params: { speed: 50, intensity: 70 } }]);
});

test("no meta -> no brightness call, animation posted with undefined params (back-compat)", async () => {
  const h = richHarness();
  await makeEsp32Renderer(h.deps).render("fire");
  assert.equal(h.posted.brightness.length, 0);
  assert.deepEqual(h.posted.anims, [{ t: "fire", params: undefined }]);
});
