import { test } from "node:test";
import assert from "node:assert/strict";
import { WAIT_BUILTINS, WAIT_PREFIX, buildWaitPool, pickWait } from "./wait.ts";

test("buildWaitPool keeps built-ins and adds saved wait- names, de-duped", () => {
  const pool = buildWaitPool(["wait-rainbow", "smiley", "wait-pulse", "wait-rainbow"]);
  assert.deepEqual(pool, ["working", "wait-rainbow", "wait-pulse"]);
});

test("buildWaitPool ignores saved names that don't match the prefix", () => {
  assert.deepEqual(buildWaitPool(["dizzy", "pacman"]), [...WAIT_BUILTINS]);
});

test("WAIT_PREFIX is the documented convention", () => {
  assert.equal(WAIT_PREFIX, "wait-");
});

test("pickWait always returns a member of the pool", () => {
  const pool = buildWaitPool(["wait-rainbow"]);
  for (let i = 0; i < 50; i++) assert.ok(pool.includes(pickWait(pool)));
});

test("pickWait returns the sole entry when pool length===1", () => {
  assert.equal(pickWait(["working"]), "working");
});

test("pickWait falls back to the first built-in on an empty pool", () => {
  assert.equal(pickWait([]), WAIT_BUILTINS[0]);
});

test("pickWait honors weights ~80/20 across sequential picks (no forced alternation)", () => {
  const pool = buildWaitPool(["wait-rainbow"]); // ["working","wait-rainbow"]
  const weights = { "wait-rainbow": 4, working: 1 };
  let rainbow = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    // sweep rng deterministically across [0,1)
    if (pickWait(pool, weights, () => i / N) === "wait-rainbow") rainbow++;
  }
  assert.ok(rainbow / N > 0.75 && rainbow / N < 0.85, `expected ~80%, got ${(rainbow / N) * 100}%`);
});

test("pickWait allows back-to-back repeats (a heavy weight isn't forced to alternate)", () => {
  const pool = buildWaitPool(["wait-rainbow"]);
  const weights = { "wait-rainbow": 4, working: 1 };
  // rng=0 always selects the first entry's slice → working ("working" is index 0),
  // so use a value inside the rainbow slice and confirm it repeats.
  const seq = Array.from({ length: 5 }, () => pickWait(pool, weights, () => 0.9));
  assert.deepEqual(seq, Array(5).fill("wait-rainbow"));
});

test("pickWait weight 0 disables a variant", () => {
  const pool = buildWaitPool(["wait-rainbow"]);
  for (let i = 0; i < 50; i++) {
    assert.equal(pickWait(pool, { working: 0 }, Math.random), "wait-rainbow");
  }
});

test("pickWait falls back to uniform if weights zero out every candidate", () => {
  const pool = ["working", "wait-rainbow"];
  assert.ok(pool.includes(pickWait(pool, { working: 0, "wait-rainbow": 0 }, () => 0)));
});
