import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRender, engineDir } from "./engine.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isFw = (n: string) => ["fire", "claudesweep", "clock"].includes(n);

test("firmware value -> transient animation plan with params + brightness", () => {
  const plan = decideRender({ intent: "idle", value: "fire", params: { speed: 50 }, brightness: 5 }, isFw);
  assert.deepEqual(plan, { kind: "animation", type: "fire", params: { speed: 50 }, brightness: 5 });
});

test("frame-expression value -> frames plan (no params, no brightness)", () => {
  const plan = decideRender({ intent: "working", value: "wait-claude" }, isFw);
  assert.deepEqual(plan, { kind: "frames", name: "wait-claude" });
});

test("frame-expression value carries brightness when present", () => {
  const plan = decideRender({ intent: "x", value: "done", brightness: 5 }, isFw);
  assert.deepEqual(plan, { kind: "frames", name: "done", brightness: 5 });
});

test("null / non-string value -> noop", () => {
  assert.deepEqual(decideRender(null, isFw), { kind: "noop" });
  assert.deepEqual(decideRender({ intent: "x", value: 42 } as any, isFw), { kind: "noop" });
});

test("engineDir falls back to <mcpDir>/shared-runtime when no ../shared", () => {
  const fake = join(tmpdir(), "no-such-mcp-dir-3b");
  assert.ok(engineDir(fake).endsWith("shared-runtime"));
});
