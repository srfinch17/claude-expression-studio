import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGalleryData } from "./build-gallery-data.mjs";

// Minimal fixture: one saved expression "fish", empty bored dir, a manifest binding nothing.
function fixture(approvedNames) {
  const dir = mkdtempSync(join(tmpdir(), "gallery-"));
  const saved = join(dir, "saved"); mkdirSync(saved);
  const bored = join(dir, "bored"); mkdirSync(bored);
  writeFileSync(join(saved, "fish.json"), JSON.stringify({
    frames: [["........","........","........","........","........","........","........","........"]],
    colors: {}, frame_ms: 150, loop: 0, description: "test",
  }));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ version: "1.0", intents: {}, harnesses: {}, renderers: {} }));
  const approvedPath = join(dir, "approved.json");
  writeFileSync(approvedPath, JSON.stringify({ approved: approvedNames }));
  return { canned: {}, savedDir: saved, manifestPath, boredDir: bored, approvedPath };
}

test("buildGalleryData reads the approved flag from approvedPath", () => {
  const onF = buildGalleryData(fixture(["fish"]));
  assert.equal(onF.expressions.find((e) => e.name === "fish").approved, true);
  const offF = buildGalleryData(fixture([]));
  assert.equal(offF.expressions.find((e) => e.name === "fish").approved, false);
});
