import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolve, effectiveBindings } from "./resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
const ROOTS = ["info", "working", "done", "attention", "fail", "idle"];

test("seed manifest: Stop -> done -> 'done' on esp32-8x8", () => {
  const got = resolve(MANIFEST, { harness: "claude-code", renderer: "esp32-8x8", moment: "hook:Stop" });
  assert.deepEqual(got, { intent: "done", value: "done" });
});

test("seed manifest: SubagentStop -> results-merged -> swarm-merge", () => {
  const got = resolve(MANIFEST, { harness: "claude-code", renderer: "esp32-8x8", moment: "hook:SubagentStop" });
  assert.deepEqual(got, { intent: "results-merged", value: "swarm-merge" });
});

test("seed manifest: web-sim inherits esp32-8x8 bindings", () => {
  const got = resolve(MANIFEST, { renderer: "web-sim", intent: "done" });
  assert.deepEqual(got, { intent: "done", value: "done" });
});

test("seed manifest: every renderer covers the 6 roots", () => {
  for (const rid of Object.keys(MANIFEST.renderers)) {
    const b = effectiveBindings(MANIFEST, rid);
    for (const root of ROOTS) assert.ok(root in b, `${rid} binds root ${root}`);
  }
});

test("seed manifest: a working pool pick returns a pool member", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "working" }, { rng: () => 0 });
  assert.ok([
    "working", "wait-claude", "wait-rainbow", "wait-orbit", "claudesweep",
    "wait-logo-breathe", "wait-logo-chase", "wait-logo-boot", "wait-logo-ripple",
  ].includes(got.value));
});

test("seed manifest: working pool is faithful to wait-weights.json (9 members, exact weights)", () => {
  const b = effectiveBindings(MANIFEST, "esp32-8x8");
  assert.deepEqual(b.working, { pool: {
    "wait-claude": 40, "wait-rainbow": 30, "wait-orbit": 20, "claudesweep": 20,
    "working": 10, "wait-logo-breathe": 8, "wait-logo-chase": 8,
    "wait-logo-boot": 8, "wait-logo-ripple": 8,
  } });
});

test("seed manifest: presence intent 'ok' resolves (ok -> approve -> done -> 'done')", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "ok" });
  assert.deepEqual(got, { intent: "done", value: "done" });
});

test("seed manifest: presence intent 'question' resolves (question -> awaiting-input -> 'ask-question')", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "question" });
  assert.deepEqual(got, { intent: "awaiting-input", value: "ask-question" });
});

// The `idle` conformance root is the QUIET "ambient / away" status (the sleep glyph),
// renderable by every renderer — distinct from the firmware-only `screensaver` rotation.
// presence_set(intent:"idle") resolves this; matrix_idle resolves `screensaver` (below).
test("seed manifest: presence intent 'idle' resolves to the quiet sleep glyph (not the screensaver)", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "idle" });
  assert.deepEqual(got, { intent: "idle", value: "sleep" });
});

// The screensaver rotation is its own intent (fallback -> idle): the lossless 8-app
// firmware pool with per-app params, labels, noRepeat, and ambient brightness 5.
test("seed manifest: 'screensaver' intent resolves the firmware pool (lossless, brightness 5)", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "screensaver" }, { rng: () => 0 });
  assert.deepEqual(got, {
    intent: "screensaver", value: "fire",
    params: { speed: 50, intensity: 70 }, label: "🔥 fire", brightness: 5,
  });
});
