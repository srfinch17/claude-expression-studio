import { test } from "node:test";
import assert from "node:assert/strict";
import { ownBindings, isPool, entryWeight, bindingEntries, poolPercentages, computeOrphans, assignmentCounts, assign, remove, reweight, move, singleToPool, poolToSingle, setPoolOption,
         setEntryParam, removeEntryParam, setEntryParamsRaw, setLabel } from "./editor.js";

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

test("assign onto an existing pool member is a no-op (preserves weight/params/label)", () => {
  const out = assign(fresh(), "esp32-8x8", "idle", "fire", 1);
  assert.deepEqual(out.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, params: { speed: 50 }, label: "🔥" });
});

test("edits preserve untouched intents-vocab and the card renderer (lossless)", () => {
  const m = reweight(fresh(), "esp32-8x8", "working", "rainbow", 99);
  assert.deepEqual(m.intents, fresh().intents);
  assert.deepEqual(m.renderers.card, fresh().renderers.card);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle, fresh().renderers["esp32-8x8"].bindings.idle);
});

// --- assignmentCounts tests ---

test("assignmentCounts: distinct-intent count per name; orphan -> 0", () => {
  const c = assignmentCounts(fresh(), "esp32-8x8", ["smiley", "wait-claude", "fire", "galaxy"]);
  assert.equal(c.smiley, 1);        // info: "smiley"
  assert.equal(c["wait-claude"], 1); // working pool
  assert.equal(c.fire, 1);           // idle pool
  assert.equal(c.galaxy, 0);         // bound nowhere
});

test("assignmentCounts counts a name bound to multiple intents", () => {
  let m = fresh();
  m = assign(m, "esp32-8x8", "done", "smiley"); // smiley now in info AND done
  assert.equal(assignmentCounts(m, "esp32-8x8", ["smiley"]).smiley, 2);
});

test("assignmentCounts returns 0 for names in allNames not bound anywhere, only for listed names", () => {
  const c = assignmentCounts(fresh(), "esp32-8x8", ["galaxy"]);
  assert.deepEqual(c, { galaxy: 0 });
});

test("setEntryParam converts a bare-number entry to object, preserving weight", () => {
  const m = setEntryParam(fresh(), "esp32-8x8", "working", "wait-claude", "intensity", 6);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], { weight: 40, params: { intensity: 6 } });
});

test("setEntryParam on an object entry preserves weight/label/other params", () => {
  const m = setEntryParam(fresh(), "esp32-8x8", "idle", "fire", "intensity", 7);
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire,
    { weight: 2, params: { speed: 50, intensity: 7 }, label: "🔥" });
});

test("setEntryParam does not mutate the input manifest", () => {
  const m = fresh(); const snap = JSON.stringify(m);
  setEntryParam(m, "esp32-8x8", "idle", "fire", "intensity", 7);
  assert.equal(JSON.stringify(m), snap);
});

test("removeEntryParam deletes a param and drops emptied params; bare-number is a no-op", () => {
  let m = removeEntryParam(fresh(), "esp32-8x8", "idle", "fire", "speed");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, label: "🔥" });
  m = removeEntryParam(fresh(), "esp32-8x8", "working", "wait-claude", "x"); // bare number -> unchanged
  assert.equal(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], 40);
});

test("setEntryParamsRaw replaces params; empty object drops the params key", () => {
  let m = setEntryParamsRaw(fresh(), "esp32-8x8", "idle", "fire", { color: "#fff" });
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, params: { color: "#fff" }, label: "🔥" });
  m = setEntryParamsRaw(m, "esp32-8x8", "idle", "fire", {});
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, label: "🔥" });
});

test("setLabel sets and clears a label; clearing a bare-number entry is a no-op", () => {
  let m = setLabel(fresh(), "esp32-8x8", "working", "wait-claude", "my wait");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], { weight: 40, label: "my wait" });
  m = setLabel(fresh(), "esp32-8x8", "idle", "fire", "");
  assert.deepEqual(m.renderers["esp32-8x8"].bindings.idle.pool.fire, { weight: 2, params: { speed: 50 } });
  m = setLabel(fresh(), "esp32-8x8", "working", "wait-claude", ""); // bare number, clear -> no-op
  assert.equal(m.renderers["esp32-8x8"].bindings.working.pool["wait-claude"], 40);
});

test("entry-edit ops no-op on a string (single) binding", () => {
  const m = setEntryParam(fresh(), "esp32-8x8", "info", "smiley", "x", 1);
  assert.equal(m.renderers["esp32-8x8"].bindings.info, "smiley");
});
