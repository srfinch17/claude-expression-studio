import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, fire } from "../registry.js";
import { makeEsp32Renderer } from "./esp32.js";
import { makeWebSimRenderer } from "./web-sim.js";
import { makeCardRenderer } from "./card.js";
import { FIRMWARE_SIMS } from "../firmware-sims.js";
import { isFirmwareName } from "../firmware-names.js";

// This file tests DISPATCH WIRING — frame-expression -> postFrames, firmware -> postAnimation,
// card -> object, plus per-renderer independent fallback. It uses a CONTROLLED fixture manifest
// (not shared/manifest.json) on purpose: the live bindings are user-editable taste data, so a
// dispatch test must own its inputs or it breaks whenever the user rebinds an intent (e.g. setting
// idle -> a firmware sim would flip idle from the frames path to the animation path). Firmware
// detection uses the real isFirmwareName so the test reflects production routing.
const FIX = {
  version: "1.0",
  intents: {
    info: { fallback: null, root: true }, working: { fallback: null, root: true },
    done: { fallback: null, root: true }, attention: { fallback: null, root: true },
    fail: { fallback: null, root: true }, idle: { fallback: null, root: true },
    screensaver: { fallback: "idle" },
  },
  harnesses: { "claude-code": { moments: [{ on: "hook:Stop", intent: "done" }] } },
  renderers: {
    "esp32-8x8": { bindings: {
      info: "smiley", working: "snake", done: "done-glyph", attention: "bell", fail: "x-mark", idle: "zzz",
      screensaver: { noRepeat: true, brightness: 5, pool: {
        fire: { weight: 1, params: { speed: 50, intensity: 6 }, label: "fire" },
      } },
    } },
    "web-sim": { inherits: "esp32-8x8" },
    card: { bindings: {
      info: { glyph: "i" }, working: { glyph: "." }, done: { glyph: "ok" },
      attention: { glyph: "!" }, fail: { glyph: "x" }, idle: { glyph: "z" },
    } },
  },
};

// A loader that returns a trivial valid expression for ANY non-firmware name, so the
// integration focuses on dispatch wiring (the real on-disk loader lives in the engine).
const loadExpression = (n) => isFirmwareName(n)
  ? null
  : { frames: [["A.......", "", "", "", "", "", "", ""]], colors: { A: "#ffffff" }, frame_ms: 150, loop: 0 };

function build() {
  const board = { frames: [], anims: [], brightness: [] };
  const panelCalls = { frames: 0, steppers: 0, stepperSamples: [] };
  const cardEl = { style: {}, querySelector: () => ({ textContent: "" }) };
  const reg = createRegistry();
  reg.register(makeEsp32Renderer({
    isFirmware: isFirmwareName,
    loadExpression,
    postFrames: async (w) => board.frames.push(w),
    postAnimation: async (t, params) => board.anims.push({ t, params }),
    setBrightness: async (level) => board.brightness.push(level),
  }));
  reg.register(makeWebSimRenderer({
    panel: {
      setFrames: () => panelCalls.frames++,
      setStepper: (fn, ms) => {
        panelCalls.steppers++;
        // Exercise the factory→instance→frame() contract end-to-end: call the stepper
        // and assert it returns a non-empty pixel array with {x,y,r,g,b} objects.
        const sample = fn();
        assert.ok(Array.isArray(sample) && sample.length > 0,
          "setStepper fn() must return a non-empty pixel array");
        assert.ok("x" in sample[0] && "y" in sample[0] && "r" in sample[0],
          "pixels must have x,y,r,g,b fields");
        panelCalls.stepperSamples.push(sample);
      },
    },
    loadExpression, firmwareSims: FIRMWARE_SIMS,
  }));
  reg.register(makeCardRenderer({ el: cardEl }));
  return { reg, board, panelCalls };
}

test("Stop -> done lights up all three renderers, each its own way", async () => {
  const b = build();
  const out = await fire(FIX, { harness: "claude-code", moment: "hook:Stop" }, b.reg);
  // esp32 posted frames (done is a frame-expression), web-sim set frames, card got its object.
  assert.equal(b.board.frames.length, 1);
  assert.equal(b.panelCalls.frames, 1);
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.intent, "done");
});

test("screensaver pool resolves a firmware sim on web-sim and an animation+brightness on esp32", async () => {
  const b = build();
  const out = await fire(FIX, { intent: "screensaver" }, b.reg, { rng: () => 0 });
  assert.equal(out.length, 3);
  const byR = Object.fromEntries(out.map((o) => [o.renderer, o]));
  // esp32 + web-sim bind `screensaver` directly. The card has NO screensaver binding,
  // so it gracefully falls back to `idle` (its quiet Zzz glyph) — board runs the show,
  // the card says "Idle". That per-renderer independent fallback is the intended design.
  assert.equal(byR["esp32-8x8"].intent, "screensaver");
  assert.equal(byR["web-sim"].intent, "screensaver");
  assert.equal(byR["card"].intent, "idle");
  // rng 0 -> first pool key "fire": firmware -> esp32 posts an animation (with its params)
  // at ambient brightness 5; web-sim plays the "fire" sim via a stepper.
  assert.equal(b.board.anims.length, 1);
  assert.equal(b.board.anims[0].t, "fire");
  assert.deepEqual(b.board.anims[0].params, { speed: 50, intensity: 6 });
  assert.deepEqual(b.board.brightness, [5]);
  assert.equal(b.panelCalls.steppers, 1);
});

test("idle resolves to its OWN binding (a frame-expression), distinct from the screensaver pool", async () => {
  const b = build();
  const out = await fire(FIX, { intent: "idle" }, b.reg, { rng: () => 0 });
  for (const o of out) assert.equal(o.intent, "idle");
  // idle -> "zzz" glyph: esp32 posts frames (not an animation) — the idle/screensaver split holds.
  assert.equal(b.board.frames.length, 1);
  assert.equal(b.board.anims.length, 0);
});
