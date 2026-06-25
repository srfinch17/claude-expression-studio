import { test } from "node:test";
import assert from "node:assert/strict";
import { createRegistry, fire } from "./registry.js";

// Minimal manifest: Stop -> done; renderer r1 binds done->"a-done";
// renderer rp binds idle as a pool where "missing" doesn't exist on disk.
const manifest = {
  intents: { done: { fallback: null, root: true }, idle: { fallback: null, root: true } },
  harnesses: { h: { moments: [{ on: "hook:Stop", intent: "done" }] } },
  renderers: {
    r1: { bindings: { done: "a-done", idle: "a-idle" } },
    rp: { bindings: { done: "a-done", idle: { pool: { missing: 5, real: 1 } } } },
  },
};

function recordingRenderer(id) {
  const calls = [];
  return { r: { id, render: (v) => { calls.push(v); } }, calls };
}

test("registry register/get/all/active", () => {
  const reg = createRegistry();
  const a = recordingRenderer("r1");
  reg.register(a.r);
  assert.equal(reg.get("r1"), a.r);
  assert.deepEqual(reg.all().map((x) => x.id), ["r1"]);
  assert.deepEqual(reg.active().map((x) => x.id), ["r1"]);
});

test("fire resolves per renderer and dispatches the leaf value", async () => {
  const reg = createRegistry();
  const a = recordingRenderer("r1");
  reg.register(a.r);
  const out = await fire(manifest, { harness: "h", moment: "hook:Stop" }, reg);
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0], "a-done");
  assert.deepEqual(out, [{ renderer: "r1", intent: "done", value: "a-done" }]);
});

test("fire skips a renderer that resolves to nothing (returns null entry)", async () => {
  const reg = createRegistry();
  const a = recordingRenderer("r1");
  reg.register(a.r);
  const out = await fire(manifest, { intent: "nonexistent", renderers: ["r1"] }, reg);
  assert.equal(a.calls.length, 0);
  assert.deepEqual(out, [null]);
});

test("fire re-picks when a pool value names a missing animation", async () => {
  const reg = createRegistry();
  const p = recordingRenderer("rp");
  reg.register(p.r);
  // exists() says "missing" is absent; rng=0 would pick "missing" first (weight 5),
  // so fire must exclude it and re-pick "real".
  const out = await fire(manifest, { intent: "idle", renderers: ["rp"] }, reg,
    { rng: () => 0, exists: (name) => name !== "missing" });
  assert.equal(p.calls[0], "real");
  assert.equal(out[0].value, "real");
});
