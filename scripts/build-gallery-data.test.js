import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildGalleryData, loadCanned } from "./build-gallery-data.mjs";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

test("buildGalleryData merges canned + saved, classifies, lists firmware", async () => {
  const canned = await loadCanned(join(ROOT, "mcp_server/dist/expressions.js"));
  const data = buildGalleryData({
    canned,
    savedDir: join(ROOT, "mcp_server/expressions"),
    manifestPath: join(ROOT, "shared/manifest.json"),
    boredDir: join(ROOT, "claude-hooks/bored_animations"),
    approvedPath: join(ROOT, "studio/approved.json"),
  });
  // The gallery firmware list IS the registry (Task 1 wired FIRMWARE = Object.keys(FIRMWARE_SIMS)),
  // so assert that invariant — auto-tracks every sim added, never needs a hardcoded count bump.
  assert.ok(data.firmware.includes("claudesweep"), "includes a known firmware sim");
  assert.equal(data.firmware.length, Object.keys(FIRMWARE_SIMS).length, "gallery lists every registered firmware sim");

  // Orphan = saved AND unbound by the manifest. The unwired v1 library lands here…
  const orphans = data.expressions.filter((e) => e.group === "orphan").map((e) => e.name);
  for (const n of ["claude-idle", "idea", "task-complete", "goldfish"])
    assert.ok(orphans.includes(n), `${n} is an unwired orphan`);

  // …but a manifest-BOUND saved expression is NOT an orphan — it is wired.
  const groupOf = (n) => data.expressions.find((e) => e.name === n)?.group;
  assert.equal(groupOf("skull"), "wired", "skull is bound to fatal -> wired, not orphan");
  assert.equal(groupOf("swarm-merge"), "wired", "swarm-merge is bound to results-merged -> wired");

  // Rotation roles from the manifest:
  assert.equal(groupOf("wait-claude"), "wait", "in the working pool -> wait");
  assert.equal(groupOf("ask-question"), "ask", "bound to awaiting-input -> ask");
  assert.equal(groupOf("sparkle"), "canned", "canned + unbound -> canned");
  assert.equal(groupOf("pacman"), "bored", "host bored-watcher dir -> bored");

  // Builder-level data-completeness: a bored-ONLY animation (in claude-hooks/bored_animations/
  // but neither saved nor canned — verified: `rocket`) must survive the saved>canned>bored merge
  // and land grouped `bored`. The catalog unit tests can't catch this — it's the builder's merge.
  assert.ok(data.expressions.find((e) => e.name === "rocket"), "bored-only entry `rocket` not dropped by the merge");
  assert.equal(groupOf("rocket"), "bored", "bored-only `rocket` grouped bored");

  // Builder-level priority crossover: `heart` is in BOTH the canned glyphs AND the bored dir,
  // with no manifest binding. The builder must pass boredNames into ctx so it resolves to its
  // rotation tier (bored), NOT canned — if boredNames weren't wired through, heart would fall
  // through to the canned tier. Discriminates the ctx assembly in build-gallery-data.mjs.
  assert.equal(groupOf("heart"), "bored", "canned+bored `heart` resolves to bored, not canned");

  for (const e of data.expressions) {
    assert.ok(Array.isArray(e.frames) && e.frames.length > 0, `${e.name} has frames`);
    assert.ok(["wait","ask","bored","wired","orphan","canned"].includes(e.group), `${e.name} grouped`);
  }
});
