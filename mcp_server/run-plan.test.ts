// mcp_server/run-plan.test.ts
// NOTE: imports the COMPILED ./dist/run-plan.js, run via `npm test` (which runs tsc first).
// run-plan.ts uses `.js`-specifier sibling imports that Node's type-strip can't resolve from
// source, so the test exercises the build (the same pattern as engine-server.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { executePlan } from "./dist/run-plan.js";

// A board that is UNREACHABLE: fetch rejects. This is the bug-scenario the fix exists for, 
// the broadcast to the virtual board must STILL fire (it sat after a bare `await post` before,
// so a rejected fetch unwound past it and board.html froze on its last frame).
const unreachablePost = async () => {
  throw new Error("fetch failed");
};
const okPost = async () => ({ ok: true, status: 200, body: "" });

// A minimal valid saved expression (8 rows × 1 frame) for the frames path.
const fakeExpr = {
  description: "test",
  colors: { R: "#ff0000" },
  frames: [[
    "R.......", "........", "........", "........",
    "........", "........", "........", "........",
  ]],
};

test("animation plan: an UNREACHABLE board still broadcasts to the virtual board + returns a graceful note (never throws)", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const note = await executePlan(
    { kind: "animation", type: "fire", params: { speed: 50 }, brightness: 5 },
    { post: unreachablePost, loadExpression: async () => null, broadcast: (e: Record<string, unknown>) => seen.push(e) },
  );
  assert.equal(seen.length, 1, "broadcast MUST fire even when the board is unreachable");
  assert.equal(seen[0].kind, "animation");
  assert.equal(seen[0].type, "fire");
  assert.match(note, /unreachable/);
});

test("frames plan: an UNREACHABLE board still broadcasts the frames intent + returns gracefully", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const note = await executePlan(
    { kind: "frames", name: "wait-rainbow", brightness: 5 },
    { post: unreachablePost, loadExpression: async () => fakeExpr, broadcast: (e: Record<string, unknown>) => seen.push(e) },
  );
  assert.equal(seen.length, 1, "broadcast MUST fire even when the board is unreachable");
  assert.equal(seen[0].kind, "frames");
  assert.equal(seen[0].name, "wait-rainbow");
  assert.match(note, /unreachable/);
});

test("reachable board: broadcasts AND returns the normal note", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const note = await executePlan(
    { kind: "animation", type: "fire", params: {}, brightness: 5 },
    { post: okPost, loadExpression: async () => null, broadcast: (e: Record<string, unknown>) => seen.push(e) },
  );
  assert.equal(seen.length, 1);
  assert.equal(note, "fire (transient anim)");
});

test("noop plan: no post, no broadcast", async () => {
  let posted = false;
  let broadcast = false;
  const note = await executePlan(
    { kind: "noop" },
    {
      post: async () => { posted = true; return { ok: true, status: 200, body: "" }; },
      loadExpression: async () => null,
      broadcast: () => { broadcast = true; },
    },
  );
  assert.equal(note, "no binding");
  assert.equal(posted, false);
  assert.equal(broadcast, false);
});
