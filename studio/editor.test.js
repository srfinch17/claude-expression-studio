import { test } from "node:test";
import assert from "node:assert/strict";
import { ownBindings, isPool, entryWeight, bindingEntries, poolPercentages, computeOrphans } from "./editor.js";

const M = {
  intents: { working: {}, idle: {} },
  renderers: {
    "esp32-8x8": { bindings: {
      info: "smiley",
      working: { pool: { "wait-claude": 40, "rainbow": 30 } },
      idle: { pool: { fire: { weight: 2, params: { speed: 50 }, label: "🔥" }, snow: 1 }, noRepeat: true, brightness: 5 },
    } },
    "web-sim": { inherits: "esp32-8x8" },
  },
};

test("ownBindings returns the renderer's bindings, {} when absent", () => {
  assert.equal(ownBindings(M)["info"], "smiley");
  assert.deepEqual(ownBindings({ renderers: {} }, "x"), {});
});

test("isPool / entryWeight", () => {
  assert.equal(isPool(M.renderers["esp32-8x8"].bindings.working), true);
  assert.equal(isPool("smiley"), false);
  assert.equal(entryWeight(40), 40);
  assert.equal(entryWeight({ weight: 2, params: {} }), 2);
  assert.equal(entryWeight({ params: {} }), 1);
});

test("bindingEntries normalizes string, pool, null", () => {
  assert.deepEqual(bindingEntries("smiley"), [{ name: "smiley", weight: 1 }]);
  assert.deepEqual(bindingEntries(null), []);
  assert.deepEqual(bindingEntries(M.renderers["esp32-8x8"].bindings.idle),
    [{ name: "fire", weight: 2 }, { name: "snow", weight: 1 }]);
});

test("poolPercentages: weight share rounded; single -> 100", () => {
  assert.deepEqual(poolPercentages(M.renderers["esp32-8x8"].bindings.working), { "wait-claude": 57, rainbow: 43 });
  assert.deepEqual(poolPercentages("smiley"), { smiley: 100 });
});

test("computeOrphans: names referenced by no binding (effective, inheritance-aware)", () => {
  const all = ["smiley", "wait-claude", "rainbow", "fire", "snow", "galaxy", "atom"];
  assert.deepEqual(computeOrphans(M, "esp32-8x8", all), ["galaxy", "atom"]);
  // web-sim inherits esp32-8x8, so the same names are bound for it
  assert.deepEqual(computeOrphans(M, "web-sim", all), ["galaxy", "atom"]);
});
