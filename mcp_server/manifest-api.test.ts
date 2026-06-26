import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest, writeManifestValidated } from "./manifest-api.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const REAL_MANIFEST = path.join(REPO_ROOT, "shared", "manifest.json");

async function tmpDirWithManifest() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eng-mf-"));
  await cp(REAL_MANIFEST, path.join(dir, "manifest.json"));
  return dir;
}

test("readManifest parses the file", async () => {
  const dir = await tmpDirWithManifest();
  const m = await readManifest(dir) as any;
  assert.ok(m.intents && m.renderers);
});

test("writeManifestValidated rejects an invalid manifest and writes nothing", async () => {
  const dir = await tmpDirWithManifest();
  const before = await readFile(path.join(dir, "manifest.json"), "utf8");
  const res = await writeManifestValidated(dir, { version: 1, intents: {}, harnesses: {}, renderers: {} }, REPO_ROOT);
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.length > 0);
  const after = await readFile(path.join(dir, "manifest.json"), "utf8");
  assert.equal(after, before);                   // unchanged on invalid
});

test("writeManifestValidated accepts the real manifest round-trip", async () => {
  const dir = await tmpDirWithManifest();
  const m = await readManifest(dir);
  const res = await writeManifestValidated(dir, m, REPO_ROOT);
  assert.equal(res.ok, true);
  const reparsed = await readManifest(dir);
  assert.deepEqual(reparsed, m);                 // lossless
});
