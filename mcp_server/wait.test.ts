import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WAIT_BUILTINS, WAIT_PREFIX, WAIT_ANIMATIONS, buildWaitPool, pickWait, isWaitAnimation } from "./wait.ts";

test("buildWaitPool keeps built-ins, firmware-anims, and saved wait- names, de-duped", () => {
  const pool = buildWaitPool(["wait-rainbow", "smiley", "wait-pulse", "wait-rainbow"]);
  assert.deepEqual(pool, ["working", "claudesweep", "wait-rainbow", "wait-pulse"]);
});

test("buildWaitPool ignores saved names that don't match the prefix", () => {
  assert.deepEqual(buildWaitPool(["dizzy", "pacman"]), [...WAIT_BUILTINS, ...WAIT_ANIMATIONS]);
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
  // Use a hand-crafted pool that doesn't include claudesweep, so the weights are clean.
  const pool = ["working", "wait-rainbow"];
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
  // Use a hand-crafted pool so weight distribution is predictable.
  const pool = ["working", "wait-rainbow"];
  const weights = { "wait-rainbow": 4, working: 1 };
  // rng=0 always selects the first entry's slice → working ("working" is index 0),
  // so use a value inside the rainbow slice and confirm it repeats.
  const seq = Array.from({ length: 5 }, () => pickWait(pool, weights, () => 0.9));
  assert.deepEqual(seq, Array(5).fill("wait-rainbow"));
});

test("pickWait weight 0 disables a variant", () => {
  // Use a hand-crafted pool that doesn't include claudesweep to keep this deterministic.
  const pool = ["working", "wait-rainbow"];
  for (let i = 0; i < 50; i++) {
    assert.equal(pickWait(pool, { working: 0 }, Math.random), "wait-rainbow");
  }
});

test("pickWait falls back to uniform if weights zero out every candidate", () => {
  const pool = ["working", "wait-rainbow"];
  assert.ok(pool.includes(pickWait(pool, { working: 0, "wait-rainbow": 0 }, () => 0)));
});

test("buildWaitPool includes firmware-animation entries", () => {
  const pool = buildWaitPool([]);
  assert.ok(pool.includes("claudesweep"), "claudesweep should be in the pool");
});

test("isWaitAnimation distinguishes firmware anims from expressions", () => {
  assert.equal(isWaitAnimation("claudesweep"), true);
  assert.equal(isWaitAnimation("working"), false);
  assert.equal(isWaitAnimation("wait-rainbow"), false);
});

test("WAIT_ANIMATIONS contains claudesweep", () => {
  assert.ok(WAIT_ANIMATIONS.includes("claudesweep"));
});

test("shipped wait-weights.json keeps wait-claude dominant over the logo family, variants at 8", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "wait-weights.json"), "utf8")) as { weights: Record<string, number> };
  const weights = raw.weights;
  assert.ok(weights && typeof weights === "object", "wait-weights.json must have a nested 'weights' object");
  const family = ["wait-logo-breathe", "wait-logo-chase", "wait-logo-boot", "wait-logo-ripple"];
  for (const name of family) {
    assert.equal(weights[name], 8, `${name} should be weighted 8`);
  }
  // wait-claude is the single largest entry AND outweighs the whole logo family.
  const max = Math.max(...Object.values(weights));
  assert.equal(weights["wait-claude"], max);
  const familyTotal = family.reduce((s, n) => s + weights[n], 0);
  assert.ok(weights["wait-claude"] >= familyTotal, "wait-claude (40) must stay >= the logo family total (32)");
});
