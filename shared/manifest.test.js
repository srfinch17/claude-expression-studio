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
  assert.ok(["working", "wait-claude", "wait-rainbow", "wait-orbit", "claudesweep"].includes(got.value));
});
