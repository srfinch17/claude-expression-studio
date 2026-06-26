// mcp_server/engine-server.test.ts
// NOTE: this test imports the COMPILED ./dist/*.js (Node type-strip can't resolve
// engine-server's .js-specifier sibling imports to .ts). Run it via `npm test`, which
// runs `tsc` FIRST — running `node --test` on this file standalone tests STALE dist and
// can pass against old code. (See Plan 4 / the "tests must discriminate" project rule.)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
// NOTE: engine-server.ts uses .js imports (Node16/tsc convention), which Node's type-strip
// runner cannot resolve to .ts sources. We import the compiled dist file instead; the
// rebuild hook keeps dist/ current on every .ts edit.
import { startEngineServer } from "./dist/engine-server.js";

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url)); // mcp_server/ ; repo root is ..

test("serves studio index, GET manifest, and rejects a bad PUT", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  const idx = await fetch(`${eng.url}/studio/index.html`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /<!DOCTYPE html>|<html/i);

  const mf = await fetch(`${eng.url}/api/manifest`);
  assert.equal(mf.status, 200);
  const json = await mf.json() as any;
  assert.ok(json.intents && json.renderers);

  const bad = await fetch(`${eng.url}/api/manifest`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, intents: {}, harnesses: {}, renderers: {} }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as any).ok, false);
});

test("GET /events streams a DisplayEvent broadcast over SSE", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  const res = await fetch(`${eng.url}/events`, { headers: { accept: "text/event-stream" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

  const reader = res.body!.getReader();
  // wait until the server has registered our client, then broadcast
  await new Promise((r) => setTimeout(r, 50));
  eng.hub.broadcast({ kind: "frames", name: "done", wire: { frames: ["A"], frame_ms: 150, loop: 0 } });

  // Collect chunks until the broadcast data arrives (skips the initial ': ok' comment)
  let text = "";
  const deadline = Date.now() + 5000;
  while (!text.includes("data: ")) {
    if (Date.now() > deadline) throw new Error("SSE: expected data not received within 5s");
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /data: /);
  assert.match(text, /"name":"done"/);
  await reader.cancel();
});

test("GET /api/framebuffer proxies the board's framebuffer", async () => {
  // fake "board" that returns a framebuffer
  const px = Array.from({ length: 64 }, (_, i) => (i === 0 ? " FF0000".trim() : "000000"));
  const board = http.createServer((req, res) => {
    if (req.url === "/api/display/framebuffer") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ px }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => board.listen(0, "127.0.0.1", () => r()));
  const boardUrl = `http://127.0.0.1:${(board.address() as any).port}`;

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl });
  after(() => { eng.close(); board.close(); });

  const r = await fetch(`${eng.url}/api/framebuffer`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.px.length, 64);
  assert.equal(body.px[0], "FF0000");
});

test("GET /api/framebuffer returns 503 reachable:false when the board is unreachable", async () => {
  // an unused port → connection refused
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl: "http://127.0.0.1:1" });
  after(() => eng.close());
  const r = await fetch(`${eng.url}/api/framebuffer`);
  assert.equal(r.status, 503);
  assert.equal((await r.json() as any).reachable, false);
});
