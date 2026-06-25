import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  intentForMoment, effectiveBindings, resolveBoundIntent, pickWeighted, resolve,
} from "./resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, "resolver-fixtures.json"), "utf8"));

// Deterministic RNG: returns the given values in order (then repeats).
const seq = (values) => { let i = 0; return () => values[(i++) % values.length]; };

test("resolver matches every shared fixture case", () => {
  for (const c of FIX.cases) {
    const manifest = FIX.manifests[c.manifest];
    const ctx = { rng: seq(c.rngSeq && c.rngSeq.length ? c.rngSeq : [0]), last: {} };
    if (c.steps) {
      for (const step of c.steps) {
        const got = resolve(manifest, { harness: step.harness ?? c.harness,
          renderer: step.renderer ?? c.renderer,
          moment: step.moment ?? c.moment, intent: step.intent ?? c.intent }, ctx);
        assert.deepEqual(got, step.expect, `${c.name} (step intent=${step.intent})`);
      }
    } else {
      const got = resolve(manifest, { harness: c.harness, renderer: c.renderer,
        moment: c.moment, intent: c.intent }, ctx);
      assert.deepEqual(got, c.expect, c.name);
    }
  }
});

test("pickWeighted: zero weight disables; all-zero falls back to uniform", () => {
  assert.equal(pickWeighted({ a: 0, b: 5 }, () => 0.99), "b");
  assert.equal(pickWeighted({ a: 0, b: 0 }, () => 0), "a"); // all zero -> uniform, first bucket
});

test("pickWeighted: exclude avoids the repeat when alternatives exist", () => {
  assert.equal(pickWeighted({ a: 1, b: 1 }, () => 0, "a"), "b");
  // only one option and it's excluded -> still returns it (never blank)
  assert.equal(pickWeighted({ a: 1 }, () => 0, "a"), "a");
});

test("resolveBoundIntent returns null when no chain member is bound", () => {
  const m = { intents: { x: { fallback: null } }, renderers: { r: { bindings: {} } } };
  assert.equal(resolveBoundIntent(m, "r", "x"), null);
});

test("noRepeat remembers the last pick via ctx.last", () => {
  const m = { intents: { idle: { fallback: null, root: true } },
    renderers: { r: { bindings: { idle: { noRepeat: true, pool: { a: 1, b: 1 } } } } } };
  const ctx = { rng: () => 0, last: {} };
  const first = resolve(m, { renderer: "r", intent: "idle" }, ctx);   // rng 0 -> a
  const second = resolve(m, { renderer: "r", intent: "idle" }, ctx);  // exclude a -> b
  assert.equal(first.value, "a");
  assert.equal(second.value, "b");
});

test("resolve degrades to null (never throws) on a null manifest or opts", () => {
  assert.equal(resolve(null, { renderer: "r", intent: "idle" }), null);
  assert.equal(resolve({ intents: {}, renderers: {} }, null), null);
});
