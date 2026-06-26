// mcp_server/runplan-broadcast.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planToDisplayEvent } from "./display-event.ts";
import { SseHub } from "./sse.ts";

// This documents the contract Task 6 wires into runPlan: every non-noop plan, after the
// board POST, produces a DisplayEvent that is broadcast. We assert the mapping + that a
// connected client receives it (the integration in Task 8 exercises the real runPlan).
test("a frames plan broadcasts a frames DisplayEvent to clients", () => {
  const hub = new SseHub();
  const seen: string[] = [];
  hub.addClient({ write: (c: string) => seen.push(c) });
  const wire = { frames: ["A"], frame_ms: 150, loop: 0 };
  hub.broadcast(planToDisplayEvent({ kind: "frames", name: "done", brightness: 5 }, wire));
  assert.match(seen[0], /"kind":"frames"/);
  assert.match(seen[0], /"name":"done"/);
});
