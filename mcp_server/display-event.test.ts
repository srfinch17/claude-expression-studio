// mcp_server/display-event.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planToDisplayEvent } from "./display-event.ts";

test("frames plan carries name, wire, brightness", () => {
  const wire = { frames: ["A"], frame_ms: 150, loop: 0 };
  const ev = planToDisplayEvent({ kind: "frames", name: "done", brightness: 5 }, wire);
  assert.deepEqual(ev, { kind: "frames", name: "done", wire, brightness: 5 });
});

test("animation plan carries type + params + brightness", () => {
  const ev = planToDisplayEvent({ kind: "animation", type: "fire", params: { intensity: 7 }, brightness: 40 });
  assert.deepEqual(ev, { kind: "animation", type: "fire", params: { intensity: 7 }, brightness: 40 });
});

test("noop plan maps to a noop event", () => {
  assert.deepEqual(planToDisplayEvent({ kind: "noop" }), { kind: "noop" });
});

test("frames without brightness omits the key", () => {
  const ev = planToDisplayEvent({ kind: "frames", name: "smiley" }, { frames: [], frame_ms: 150, loop: 0 });
  assert.ok(!("brightness" in ev));
});
