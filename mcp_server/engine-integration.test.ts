// mcp_server/engine-integration.test.ts — capstone integration test: engine boot, static
// serving, SSE broadcast, and manifest round-trip (side-effect-free).
// NOTE: this test imports the COMPILED ./dist/*.js (Node type-strip can't resolve
// engine-server's .js-specifier sibling imports to .ts). Run it via `npm test`, which
// runs `tsc` FIRST — running `node --test` on this file standalone tests STALE dist and
// can pass against old code. (See Plan 4 / the "tests must discriminate" project rule.)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startEngineServer } from "./dist/engine-server.js";
import { planToDisplayEvent } from "./dist/display-event.js";

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(MCP_DIR, "..");

test("engine serves board.html + a broadcast reaches a live SSE client", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  // the virtual board page is served
  const board = await fetch(`${eng.url}/studio/board.html`);
  assert.equal(board.status, 200);
  assert.match(await board.text(), /EventSource\("\/events"\)/);

  // a frames render (as runPlan would emit) reaches a connected client
  const res = await fetch(`${eng.url}/events`, { headers: { accept: "text/event-stream" } });
  const reader = res.body!.getReader();
  await new Promise((r) => setTimeout(r, 50));
  const wire = { frames: ["ff0000" + "000000".repeat(63)], frame_ms: 120, loop: 0 };
  eng.hub.broadcast(planToDisplayEvent({ kind: "frames", name: "smiley" }, wire));
  // Collect chunks until the broadcast data arrives (skips the initial ': ok' SSE comment)
  let text = "";
  const deadline = Date.now() + 5000;
  while (!text.includes('"name":"smiley"')) {
    if (Date.now() > deadline) throw new Error("SSE: expected data not received within 5s");
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /"name":"smiley"/);
  assert.match(text, /"frame_ms":120/);
  await reader.cancel();
});

test("manifest round-trips through the live engine into a TEMP file (side-effect-free)", async () => {
  // Copy the real manifest into a temp dir and point the engine there, so the PUT never
  // touches the tracked shared/manifest.json. repoRoot stays the real repo (for the
  // validator's collectAnimationNames, which scans expressions/bored dirs).
  const tmp = await mkdtemp(path.join(os.tmpdir(), "eng-mf-"));
  await cp(path.join(REPO_ROOT, "shared", "manifest.json"), path.join(tmp, "manifest.json"));
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, manifestDir: tmp, repoRoot: REPO_ROOT });
  after(() => eng.close());
  const m = await (await fetch(`${eng.url}/api/manifest`)).json();
  const put = await fetch(`${eng.url}/api/manifest`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(m),
  });
  assert.equal(put.status, 200);
  assert.equal((await put.json() as any).ok, true);
});
