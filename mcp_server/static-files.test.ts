import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeResolve, contentType, serveStatic, resolveStaticBase } from "./static-files.ts";

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "eng-static-"));
  await mkdir(path.join(base, "studio"), { recursive: true });
  await mkdir(path.join(base, "shared"), { recursive: true });
  await writeFile(path.join(base, "studio", "index.html"), "<h1>studio</h1>");
  await writeFile(path.join(base, "shared", "render.js"), "export const x=1;");
  return base;
}

test("safeResolve blocks path traversal, allows in-tree", () => {
  assert.equal(safeResolve("/base", "/../etc/passwd"), null);
  assert.ok(safeResolve("/base", "/studio/index.html")?.endsWith(path.join("base", "studio", "index.html")));
});

test("contentType maps known extensions", () => {
  assert.equal(contentType("a.html"), "text/html; charset=utf-8");
  assert.equal(contentType("a.js"), "text/javascript; charset=utf-8");
  assert.equal(contentType("a.json"), "application/json; charset=utf-8");
  assert.equal(contentType("a.bin"), "application/octet-stream");
});

test("serveStatic returns files, maps / to studio/index.html, 404s missing", async () => {
  const base = await fixture();
  const root = await serveStatic("/", base);
  assert.equal(root.status, 200);
  assert.equal(root.type, "text/html; charset=utf-8");
  assert.match(root.body.toString(), /studio/);
  const sh = await serveStatic("/shared/render.js", base);
  assert.equal(sh.status, 200);
  assert.equal(sh.type, "text/javascript; charset=utf-8");
  const miss = await serveStatic("/studio/nope.html", base);
  assert.equal(miss.status, 404);
});

test("resolveStaticBase prefers a repo root that has studio/index.html", async () => {
  const base = await fixture();
  // mcpDir = <base>/mcp_server ; repo root = <base> which HAS studio/index.html
  assert.equal(resolveStaticBase(path.join(base, "mcp_server")), base);
});
