import { test } from "node:test";
import assert from "node:assert/strict";
import { SseHub, type DisplayEvent } from "./sse.ts";

function fakeClient() {
  const chunks: string[] = [];
  return { chunks, write(c: string) { chunks.push(c); } };
}

test("broadcast writes SSE-framed JSON to every client", () => {
  const hub = new SseHub();
  const a = fakeClient(), b = fakeClient();
  hub.addClient(a); hub.addClient(b);
  const ev: DisplayEvent = { kind: "frames", name: "done", wire: { frames: ["x"], frame_ms: 150, loop: 0 } };
  hub.broadcast(ev);
  assert.equal(hub.clientCount(), 2);
  assert.equal(a.chunks[0], `data: ${JSON.stringify(ev)}\n\n`);
  assert.deepEqual(a.chunks, b.chunks);
});

test("a throwing client is dropped, others still receive, broadcast never throws", () => {
  const hub = new SseHub();
  const bad = { write() { throw new Error("client gone"); } };
  const good = fakeClient();
  hub.addClient(bad); hub.addClient(good);
  assert.doesNotThrow(() => hub.broadcast({ kind: "noop" }));
  assert.equal(hub.clientCount(), 1);          // bad was dropped
  assert.equal(good.chunks.length, 1);
});

test("removeClient drops the client; broadcast to none is a no-op", () => {
  const hub = new SseHub();
  const a = fakeClient();
  hub.addClient(a); hub.removeClient(a);
  assert.equal(hub.clientCount(), 0);
  assert.doesNotThrow(() => hub.broadcast({ kind: "noop" }));
  assert.equal(a.chunks.length, 0);
});
