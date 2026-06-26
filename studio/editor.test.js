import { test } from "node:test";
import assert from "node:assert/strict";
import { ownBindings, isPool, entryWeight, bindingEntries, poolPercentages, computeOrphans, assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption } from "./editor.js";

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

// --- mutation ops tests ---

function fresh() {
  return {
    intents: { info: {}, working: {}, idle: {}, fail: {} },
    renderers: {
      "esp32-8x8": { bindings: {
        info: "smiley",
        working: { pool: { "wait-claude": 40, rainbow: 30 } },
        idle: { pool: { fire: { weight: 2, params: { speed: 50 }, label: "🔥" }, snow: 1 }, noRepeat: true, brightness: 5 },
      } },
      card: { bindings: { info: { glyph: "•", text: "Info" } } },
    },
  };
}

test("assign: empty->single, single->pool, pool->add", () => {
  let m = fresh();
  m = assign(m, "esp32-8x8", "fail", "skull");
  assert.equal(m.renderers["esp32-8x8"].bindings.fail, "skull");
  m = assign(m, "esp32-8x8", "fail", "cross");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.fail, { pool: { skull: 1, cross: 1 } });
  m = assign(m, "esp32-8x8", "working", "galaxy", 5);
  assert.equal(m.renderers["esp32-8x8"].bindings.working.pool.galaxy, 5);
});

test("assign does not mutate the input manifest", () => {
  const m = fresh();
  const snapshot = JSON.stringify(m);
  assign(m, "esp32-8x8", "fail", "skull");
  assert.equal(JSON.stringify(m), snapshot);
});

test("remove: pool delete; emptying deletes the binding; string match deletes", () => {
  let m = fresh();
  m = remove(m, "esp32-8x8", "working", "rainbow");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.working, { pool: { "wait-claude": 40 } });
  m = remove(m, "esp32-8x8", "working", "wait-claude");
  assert.equal("working" in m.renderers["esp32-8x8"].bindings, false);
  m = remove(m, "esp32-8x8", "info", "smiley");
  assert.equal("info" in m.renderers["esp32-8x8"].bindings, false);
});

test("reweight preserves an object entry's params/label", () => {
  const m = reweight(fresh(), "esp32-8x8", "idle", "fire", 9);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 9, params: { speed: 50 }, label: "🔥" });
});

test("move carries the entry value (weight+params+label) to the destination pool", () => {
  const m = move(fresh(), "esp32-8x8", "idle", "fail", "fire");
  assert.equal("fire" in m.renderers["esp32-8x8"].bindings.idle.pool, false);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.fail, { pool: { fire: { weight: 2, params: { speed: 50 }, label: "🔥" } } });
});

test("singleToPool / poolToSingle round-trip a single binding", () => {
  let m = singleToPool(fresh(), "esp32-8x8", "info");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.info, { pool: { smiley: 1 } });
  m = poolToSingle(m, "esp32-8x8", "info");
  assert.equal(m.renderers["esp32-8x8"].bindings.info, "smiley");
});

test("setPoolOption sets/deletes pool-level options", () => {
  let m = setPoolOption(fresh(), "esp32-8x8", "working", "noRepeat", true);
  assert.equal(m.renderers["esp32-8x8"].bindings.working.noRepeat, true);
  m = setPoolOption(m, "esp32-8x8", "idle", "brightness", null);
  assert.equal("brightness" in m.renderers["esp32-8x8"].bindings.idle, false);
});

test("edits preserve untouched intents-vocab and the card renderer (lossless)", () => {
  const m = reweight(fresh(), "esp32-8x8", "working", "rainbow", 99);
  assert.deepEqual(m.intents, fresh().intents);
  assert.deepEqual(m.renderers.card, fresh().renderers.card);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle, fresh().renderers["esp32-8x8"].bindings.idle);
});
