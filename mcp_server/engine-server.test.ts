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
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
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

test("GET /api/presence proxies the board's presence message", async () => {
  const msg = { intent: "working", headline: "Refactoring", urgency: "ambient", ts: 1719500000 };
  const board = http.createServer((req, res) => {
    if (req.url === "/api/presence") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(msg));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => board.listen(0, "127.0.0.1", () => r()));
  const boardUrl = `http://127.0.0.1:${(board.address() as any).port}`;

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl });
  after(() => { eng.close(); board.close(); });

  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.intent, "working");
  assert.equal(body.headline, "Refactoring");
  assert.equal(body.ts, 1719500000);
});

test("GET /api/presence returns 503 reachable:false when the board is unreachable and nothing stored", async () => {
  // Honest "no source": unreachable board AND an empty store → 503 (the card's no-source messaging).
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl: "http://127.0.0.1:1" });
  after(() => eng.close());
  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 503);
  assert.equal((await r.json() as any).reachable, false);
});

test("POST /api/presence stores a message; GET returns it (no board) with a stamped ts", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 }); // no boardUrl configured
  after(() => eng.close());

  const before = Math.floor(Date.now() / 1000);
  const post = await fetch(`${eng.url}/api/presence`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "working", headline: "Building" }),
  });
  assert.equal(post.status, 204);

  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.intent, "working");
  assert.equal(body.headline, "Building");
  assert.ok(body.ts >= before, "engine stamps ts in epoch seconds so the card's age reads correctly");
});

test("GET /api/presence prefers the live board over the stored message", async () => {
  // Board stays source-of-truth: a reachable board wins even when the engine store is newer.
  const boardMsg = { intent: "done", headline: "from board", ts: 1719500000 };
  const board = http.createServer((req, res) => {
    if (req.url === "/api/presence") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(boardMsg));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => board.listen(0, "127.0.0.1", () => r()));
  const boardUrl = `http://127.0.0.1:${(board.address() as any).port}`;

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl });
  after(() => { eng.close(); board.close(); });

  // Store a DIFFERENT message first; the board must still win.
  await fetch(`${eng.url}/api/presence`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "working", headline: "from store" }),
  });

  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.intent, "done");
  assert.equal(body.headline, "from board");
});

test("/api/presence rejects non-GET/POST verbs with 405", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());
  const r = await fetch(`${eng.url}/api/presence`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(r.status, 405);
});

test("GET /api/presence falls back to the store when the board responds non-2xx", async () => {
  // The board is reachable but errors (e.g. its own 503 low-memory guard) — the engine must treat
  // that like unreachable and serve the stored copy, not relay the error as authoritative.
  const board = http.createServer((req, res) => {
    if (req.url === "/api/presence") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "low memory" }));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => board.listen(0, "127.0.0.1", () => r()));
  const boardUrl = `http://127.0.0.1:${(board.address() as any).port}`;

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl });
  after(() => { eng.close(); board.close(); });

  await fetch(`${eng.url}/api/presence`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "working", headline: "stored" }),
  });
  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.intent, "working");
  assert.equal(body.headline, "stored");
});

test("GET /api/presence falls back to the stored message when the board is unreachable", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, boardUrl: "http://127.0.0.1:1" });
  after(() => eng.close());

  await fetch(`${eng.url}/api/presence`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "idle", headline: "stored" }),
  });

  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.equal(body.intent, "idle");
  assert.equal(body.headline, "stored");
});

test("POST /api/presence with a non-JSON body returns 400 and does not corrupt the store", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  await fetch(`${eng.url}/api/presence`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "working" }),
  });
  const bad = await fetch(`${eng.url}/api/presence`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "not json",
  });
  assert.equal(bad.status, 400);

  const r = await fetch(`${eng.url}/api/presence`);
  assert.equal(r.status, 200);
  assert.equal((await r.json() as any).intent, "working");
});

test("POST /api/presence rejects a non-object or intent-less body with 400 and stores nothing", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  // JSON-but-not-a-presence: primitives/arrays (would TypeError on ts-stamp → 500) and an
  // intent-less object (would store renderable garbage). All must be a clean 400.
  for (const bad of ["5", "\"hi\"", "null", "[1,2]", JSON.stringify({ headline: "no intent" })]) {
    const r = await fetch(`${eng.url}/api/presence`, {
      method: "POST", headers: { "content-type": "application/json" }, body: bad,
    });
    assert.equal(r.status, 400, `body ${bad} -> 400`);
  }
  // Nothing valid was ever stored → GET (no board) is the honest 503.
  const g = await fetch(`${eng.url}/api/presence`);
  assert.equal(g.status, 503);
});

test("POST /api/render fans a DisplayEvent out to SSE virtual boards", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  const res = await fetch(`${eng.url}/events`, { headers: { accept: "text/event-stream" } });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  await new Promise((r) => setTimeout(r, 50)); // let the server register our client

  const post = await fetch(`${eng.url}/api/render`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "animation", type: "fire" }),
  });
  assert.equal(post.status, 204);

  let text = "";
  const deadline = Date.now() + 5000;
  while (!text.includes("data: ")) {
    if (Date.now() > deadline) throw new Error("SSE: render event not received within 5s");
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /"kind":"animation"/);
  assert.match(text, /"fire"/);
  await reader.cancel();
});

test("POST /api/render with an unparseable body returns 400", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());
  const r = await fetch(`${eng.url}/api/render`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "not json",
  });
  assert.equal(r.status, 400);
});

test("PUT /api/expression/:name writes the file, un-approves, regenerates gallery-data", async () => {
  const repo = path.join(MCP_DIR, "..");
  const exprPath = path.join(MCP_DIR, "expressions", "zzz-test.json");
  const approvedPath = path.join(repo, "studio", "approved.json");
  const galleryPath = path.join(repo, "studio", "gallery-data.json");
  const blank = ["........","........","........","........","........","........","........","........"];
  const seed = { frames: [blank], colors: {}, frame_ms: 150, loop: 0, description: "seed" };
  writeFileSync(exprPath, JSON.stringify(seed, null, 2));
  const approvedRaw = readFileSync(approvedPath, "utf8");
  const galleryRaw = readFileSync(galleryPath, "utf8");   // the engine regenerates this mid-test — restore it too
  const approvedBefore = JSON.parse(approvedRaw); approvedBefore.approved.push("zzz-test");
  writeFileSync(approvedPath, JSON.stringify(approvedBefore, null, 2));

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  try {
    const edited = { ...seed, frames: [["A.......", ...blank.slice(1)]], colors: { A: "#00ff00" }, description: "edited" };
    const r = await fetch(`${eng.url}/api/expression/zzz-test`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edited),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json() as any, { ok: true });
    assert.equal(JSON.parse(readFileSync(exprPath, "utf8")).description, "edited");              // file written
    assert.ok(!JSON.parse(readFileSync(approvedPath, "utf8")).approved.includes("zzz-test"));    // un-approved
    const gd = JSON.parse(readFileSync(galleryPath, "utf8"));                                    // gallery regenerated
    const e = gd.expressions.find((x: any) => x.name === "zzz-test");
    assert.equal(e.description, "edited");
    assert.equal(e.approved, false);

    const bad = await fetch(`${eng.url}/api/expression/zzz-test`, {                              // bad shape -> 400
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edited, frames: [["x"]] }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json() as any).ok, false);

    const missing = await fetch(`${eng.url}/api/expression/does-not-exist`, {                    // unknown -> 404
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edited),
    });
    assert.equal(missing.status, 404);
  } finally {
    await eng.close();
    if (existsSync(exprPath)) rmSync(exprPath);          // remove the throwaway source
    writeFileSync(approvedPath, approvedRaw);            // restore approved.json byte-for-byte
    writeFileSync(galleryPath, galleryRaw);              // restore gallery-data.json byte-for-byte (engine regen added zzz-test)
  }
});

test("POST /api/approval/:name toggles approved.json + regenerates gallery-data", async () => {
  const repo = path.join(MCP_DIR, "..");
  const exprPath = path.join(MCP_DIR, "expressions", "zzz-approve.json");
  const approvedPath = path.join(repo, "studio", "approved.json");
  const galleryPath = path.join(repo, "studio", "gallery-data.json");
  const blank = ["........","........","........","........","........","........","........","........"];
  writeFileSync(exprPath, JSON.stringify({ frames: [blank], colors: {}, frame_ms: 150, loop: 0, description: "seed" }, null, 2));
  const approvedRaw = readFileSync(approvedPath, "utf8");
  const galleryRaw = readFileSync(galleryPath, "utf8");

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  try {
    // approve
    const a = await fetch(`${eng.url}/api/approval/zzz-approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }),
    });
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json() as any, { ok: true, approved: true });
    assert.ok(JSON.parse(readFileSync(approvedPath, "utf8")).approved.includes("zzz-approve"));
    assert.equal(JSON.parse(readFileSync(galleryPath, "utf8")).expressions.find((e: any) => e.name === "zzz-approve").approved, true);

    // un-approve
    const u = await fetch(`${eng.url}/api/approval/zzz-approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: false }),
    });
    assert.equal(u.status, 200);
    assert.ok(!JSON.parse(readFileSync(approvedPath, "utf8")).approved.includes("zzz-approve"));

    // non-boolean body -> 400
    const bad = await fetch(`${eng.url}/api/approval/zzz-approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: "yes" }),
    });
    assert.equal(bad.status, 400);

    // unknown name -> 404
    const missing = await fetch(`${eng.url}/api/approval/does-not-exist`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await eng.close();
    if (existsSync(exprPath)) rmSync(exprPath);
    writeFileSync(approvedPath, approvedRaw);   // restore byte-for-byte
    writeFileSync(galleryPath, galleryRaw);     // restore byte-for-byte (engine regen mutated it)
  }
});
