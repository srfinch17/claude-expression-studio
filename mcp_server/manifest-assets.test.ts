// mcp_server/manifest-assets.test.ts
// Regression guard: every esp32-8x8 binding leaf name in shared/manifest.json must
// resolve to a REAL renderable asset, i.e. present in CANNED, in FIRMWARE_NAMES,
// or on disk as expressions/<name>.json.  This is the test that would have caught
// the missing `done` asset (fixed in the Plan 3b fix wave).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANNED } from "./expressions.ts";
import { FIRMWARE_NAMES } from "../shared/firmware-names.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_DIR = __dirname;
const EXPR_DIR = path.join(MCP_DIR, "expressions");
const MANIFEST_PATH = path.join(MCP_DIR, "..", "shared", "manifest.json");

/** Extract every animation name that the esp32-8x8 renderer must be able to render. */
function leafNames(manifest: Record<string, unknown>): string[] {
  const renderers = manifest.renderers as Record<string, { bindings?: Record<string, unknown> }>;
  const bindings = renderers["esp32-8x8"]?.bindings ?? {};
  const names = new Set<string>();
  for (const binding of Object.values(bindings)) {
    if (typeof binding === "string") {
      names.add(binding);
    } else if (binding && typeof binding === "object") {
      const pool = (binding as Record<string, unknown>).pool;
      if (pool && typeof pool === "object") {
        for (const name of Object.keys(pool as object)) names.add(name);
      }
    }
  }
  return [...names];
}

test("every esp32-8x8 binding resolves to a real renderable asset", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const names = leafNames(manifest);
  const missing: string[] = [];
  for (const name of names) {
    const inCanned   = name in CANNED;
    const inFirmware = FIRMWARE_NAMES.has(name);
    const inExprDir  = existsSync(path.join(EXPR_DIR, `${name}.json`));
    if (!inCanned && !inFirmware && !inExprDir) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `Missing renderable assets for binding(s): ${missing.join(", ")}`,
  );
});
