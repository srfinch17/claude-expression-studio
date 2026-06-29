import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateManifest, collectAnimationNames } from "./check-manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = JSON.parse(readFileSync(join(ROOT, "shared/manifest.json"), "utf8"));
const NAMES = collectAnimationNames(ROOT);

// A minimal valid manifest (roots bound, no dangling fallbacks).
const ok = () => ({
  version: "1.0",
  intents: {
    info: { fallback: null, root: true }, working: { fallback: null, root: true },
    done: { fallback: null, root: true }, attention: { fallback: null, root: true },
    fail: { fallback: null, root: true }, idle: { fallback: null, root: true },
    error: { fallback: "fail" },
  },
  harnesses: { "claude-code": { moments: [{ on: "hook:Stop", intent: "done" }] } },
  renderers: { r: { bindings: {
    info: "skull", working: "skull", done: "skull",
    attention: "skull", fail: "skull", idle: "skull", error: "skull",
  } } },
});

test("the real seed manifest is valid", () => {
  assert.deepEqual(validateManifest(SEED, NAMES), []);
});

test("minimal manifest is valid", () => {
  assert.deepEqual(validateManifest(ok(), new Set(["skull"])), []);
});

test("flags a fallback to a nonexistent intent", () => {
  const m = ok(); m.intents.error.fallback = "ghost";
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /ghost/.test(e)));
});

test("flags a fallback cycle exactly once (no per-node over-reporting)", () => {
  const m = ok();
  m.intents.a = { fallback: "b" }; m.intents.b = { fallback: "a" };
  const errs = validateManifest(m, new Set(["skull"]));
  assert.equal(errs.filter((e) => /cycle/i.test(e)).length, 1);
});

test("flags a non-root intent whose chain dead-ends (fallback null, not root)", () => {
  const m = ok(); m.intents.lonely = { fallback: null };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /lonely/.test(e) && /root/i.test(e)));
});

test("flags a missing required root", () => {
  const m = ok(); delete m.intents.idle;
  // idle no longer an intent AND not bound -> at least one error mentions idle
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /idle/.test(e)));
});

test("flags a renderer not covering a root", () => {
  const m = ok(); delete m.renderers.r.bindings.fail;
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /fail/.test(e) && /root/i.test(e)));
});

test("flags a binding referencing a missing animation", () => {
  const m = ok(); m.renderers.r.bindings.done = "no-such-anim";
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /no-such-anim/.test(e)));
});

test("flags a negative pool weight", () => {
  const m = ok(); m.renderers.r.bindings.idle = { pool: { skull: -2 } };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /weight/i.test(e)));
});

test("flags an x- intent with no fallback", () => {
  const m = ok(); m.intents["x-thing"] = { fallback: null };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /x-thing/.test(e)));
});

test("collectAnimationNames includes canned, saved, bored, firmware", () => {
  for (const n of ["done", "skull", "claudesweep"]) assert.ok(NAMES.has(n), `${n} known`);
});

// Firmware names must come from shared/firmware-names.js (the single source), not a stale
// hardcoded subset — else the Studio can assign a real firmware sim the validator then rejects
// on Save. wave/sun/comet/spiral/starfield/liquid/rainbow/breathe are sims that the old 8-name
// list omitted. This case fails against that stale list and passes once it's single-sourced.
test("collectAnimationNames knows every firmware sim the Studio offers (not just the old 8)", () => {
  for (const n of ["wave", "sun", "comet", "spiral", "starfield", "liquid", "rainbow", "breathe"])
    assert.ok(NAMES.has(n), `${n} must be a recognized firmware name`);
});

// --- Task 3: rich pool shape + duplicate-moment rule ---

const RICH_NAMES = new Set(["a-info", "a-work", "a-done", "a-att", "a-fail", "fire", "snow"]);
function richRoots(extra = {}) {
  return { info: "a-info", working: "a-work", done: "a-done", attention: "a-att", fail: "a-fail", ...extra };
}
function mf(bindings, moments = [{ on: "hook:Stop", intent: "done" }]) {
  return {
    version: "1.0",
    intents: {
      info: { fallback: null, root: true }, working: { fallback: null, root: true },
      done: { fallback: null, root: true }, attention: { fallback: null, root: true },
      fail: { fallback: null, root: true }, idle: { fallback: null, root: true },
    },
    harnesses: { h: { moments } },
    renderers: { r: { bindings } },
  };
}

test("validator accepts a rich pool (object entries + brightness)", () => {
  const errors = validateManifest(mf(richRoots({
    idle: { brightness: 5, pool: { fire: { weight: 1, params: { speed: 50 }, label: "fire" }, snow: 3 } },
  })), RICH_NAMES);
  assert.deepEqual(errors, []);
});

test("validator flags a negative weight inside an object pool entry", () => {
  const errors = validateManifest(mf(richRoots({
    idle: { pool: { fire: { weight: -2 } } },
  })), RICH_NAMES);
  assert.ok(errors.some((e) => /invalid weight/i.test(e) && /fire/.test(e)), errors.join("; "));
});

test("validator flags a missing animation inside an object pool entry", () => {
  const errors = validateManifest(mf(richRoots({
    idle: { pool: { ghost: { weight: 1 } } },
  })), RICH_NAMES);
  assert.ok(errors.some((e) => /missing animation "ghost"/i.test(e)), errors.join("; "));
});

test("validator flags a duplicate moment `on` within a harness", () => {
  const errors = validateManifest(mf(richRoots({ idle: "fire" }), [
    { on: "hook:Stop", intent: "done" },
    { on: "hook:Stop", intent: "working" },
  ]), RICH_NAMES);
  assert.ok(errors.some((e) => /duplicate moment/i.test(e) && /hook:Stop/.test(e)), errors.join("; "));
});

test("validator does NOT flag repeated on:\"discretionary\" (intent-path, not moment-lookup)", () => {
  const errors = validateManifest(mf(richRoots({ idle: "fire" }), [
    { on: "hook:Stop", intent: "done" },
    { on: "discretionary", intent: "idle" },
    { on: "discretionary", intent: "fail" },
  ]), RICH_NAMES);
  assert.deepEqual(errors, []);
});
