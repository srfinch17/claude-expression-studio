import { test } from "node:test";
import assert from "node:assert/strict";
import { copySharedRuntime } from "./copy-shared-runtime.mjs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("copySharedRuntime places the engine files in mcp_server/shared-runtime", () => {
  const dst = copySharedRuntime();
  for (const f of ["manifest.json", "resolver.js", "firmware-names.js"])
    assert.ok(existsSync(join(dst, f)), `${f} copied`);
  // manifest is valid JSON with the 6 conformance roots
  const m = JSON.parse(readFileSync(join(dst, "manifest.json"), "utf8"));
  for (const root of ["info", "working", "done", "attention", "fail", "idle"])
    assert.ok(root in m.intents, `manifest has root ${root}`);
  assert.ok(dst.endsWith(join("mcp_server", "shared-runtime")));
  assert.ok(dst.startsWith(ROOT));
});

test("copySharedRuntime stages the Studio tree into mcp_server/studio-dist", () => {
  copySharedRuntime();
  const distRoot = join(ROOT, "mcp_server", "studio-dist");
  assert.ok(existsSync(join(distRoot, "studio", "index.html")), "studio/index.html staged");
  assert.ok(existsSync(join(distRoot, "studio", "board.html")), "studio/board.html staged");
  assert.ok(existsSync(join(distRoot, "shared", "render.js")), "shared/render.js staged");
});
