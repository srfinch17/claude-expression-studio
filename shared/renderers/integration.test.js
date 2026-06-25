import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRegistry, fire } from "../registry.js";
import { makeEsp32Renderer } from "./esp32.js";
import { makeWebSimRenderer } from "./web-sim.js";
import { makeCardRenderer } from "./card.js";
import { FIRMWARE_SIMS } from "../firmware-sims.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "shared/manifest.json"), "utf8"));
const FIRMWARE = ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain", "snow", "claudesweep"];

// A loader that returns a trivial valid expression for ANY non-firmware name, so the
// integration focuses on dispatch wiring (Plan 3 wires the real on-disk loader).
const loadExpression = (n) => FIRMWARE.includes(n)
  ? null
  : { frames: [["A.......","","","","","","",""]], colors: { A: "#ffffff" }, frame_ms: 150, loop: 0 };

function build() {
  const board = { frames: [], anims: [], brightness: [] };
  const panelCalls = { frames: 0, steppers: 0, stepperSamples: [] };
  const cardEl = { style: {}, querySelector: () => ({ textContent: "" }) };
  const reg = createRegistry();
  reg.register(makeEsp32Renderer({
    isFirmware: (n) => FIRMWARE.includes(n),
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
  const out = await fire(MANIFEST, { harness: "claude-code", moment: "hook:Stop" }, b.reg);
  // esp32 posted frames (done is a frame-expression), web-sim set frames, card got its object.
  assert.equal(b.board.frames.length, 1);
  assert.equal(b.panelCalls.frames, 1);
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.intent, "done");
});

test("idle pool resolves a firmware sim on web-sim and an animation+brightness on esp32", async () => {
  const b = build();
  const out = await fire(MANIFEST, { intent: "idle" }, b.reg, { rng: () => 0 });
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.intent, "idle");
  // rng 0 -> first pool key "fire": firmware -> esp32 posts an animation (with its params)
  // at idle brightness 5; web-sim plays the "fire" sim via a stepper.
  assert.equal(b.board.anims.length, 1);
  assert.equal(b.board.anims[0].t, "fire");
  assert.deepEqual(b.board.anims[0].params, { speed: 50, intensity: 70 });
  assert.deepEqual(b.board.brightness, [5]);
  assert.equal(b.panelCalls.steppers, 1);
});
