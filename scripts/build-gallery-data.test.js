import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildGalleryData, loadCanned } from "./build-gallery-data.mjs";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
import { bindingNames } from "../shared/catalog.js";

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
  const manifestPath = join(ROOT, "shared/manifest.json");
  const data = buildGalleryData({
    canned,
    savedDir: join(ROOT, "mcp_server/expressions"),
    manifestPath,
    boredDir: join(ROOT, "claude-hooks/bored_animations"),
    approvedPath: join(ROOT, "studio/approved.json"),
  });
  const groupOf = (n) => data.expressions.find((e) => e.name === n)?.group;

  // The gallery firmware list IS the registry (Task 1 wired FIRMWARE = Object.keys(FIRMWARE_SIMS)),
  // so assert that invariant, auto-tracks every sim added, never needs a hardcoded count bump.
  assert.ok(data.firmware.includes("claudesweep"), "includes a known firmware sim");
  assert.equal(data.firmware.length, Object.keys(FIRMWARE_SIMS).length, "gallery lists every registered firmware sim");

  // Classification INVARIANT, derived from the LIVE manifest so it survives re-wiring in the
  // Studio (binding membership is now editable taste data, not a fixed snapshot): orphan ==
  // saved AND bound nowhere; a saved expression the manifest binds is in a rotation tier, never
  // orphan. (The tier-assignment logic itself is unit-tested in shared/catalog.test.js.)
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const boundLeaves = new Set();
  for (const b of Object.values(manifest.renderers["esp32-8x8"].bindings))
    for (const n of bindingNames(b)) boundLeaves.add(n);
  for (const e of data.expressions) {
    if (e.source === "saved" && boundLeaves.has(e.name)) assert.notEqual(e.group, "orphan", `bound ${e.name} -> not orphan`);
    if (e.group === "orphan") assert.ok(e.source === "saved" && !boundLeaves.has(e.name), `orphan ${e.name} is saved + unbound`);
  }

  // Builder-level data completeness (binding-independent): a bored-ONLY entry (`rocket`: in the
  // bored dir, neither saved nor canned) must survive the saved>canned>bored merge, not be dropped.
  assert.ok(data.expressions.find((e) => e.name === "rocket"), "bored-only `rocket` not dropped by the merge");

  for (const e of data.expressions) {
    assert.ok(Array.isArray(e.frames) && e.frames.length > 0, `${e.name} has frames`);
    assert.ok(["wait","ask","bored","wired","orphan","canned"].includes(e.group), `${e.name} grouped`);
  }
});

// The classification edge cases (merge priority + ctx wiring) are tested with CONTROLLED data, not
// the live manifest, so they survive any re-wiring done in the Studio: a saved expression that the
// manifest binds is no longer an orphan, and an unbound name in BOTH the canned set and the bored
// dir must resolve to the bored tier (proving boredNames is threaded into the classifier ctx ahead
// of cannedNames). Live-data anchors here used to break the moment a user bound `heart`/`pacman`.
test("buildGalleryData merge/priority: bored-only survives; canned+bored(unbound)->bored; bound->not orphan", () => {
  const dir = mkdtempSync(join(tmpdir(), "gallery-merge-"));
  const saved = join(dir, "saved"); mkdirSync(saved);
  const bored = join(dir, "bored"); mkdirSync(bored);
  const frames = [["........","........","........","........","........","........","........","........"]];
  const expr = (description) => JSON.stringify({ frames, colors: {}, frame_ms: 150, loop: 0, description });
  writeFileSync(join(saved, "wired-one.json"), expr("saved + bound"));   // bound below -> must NOT be orphan
  writeFileSync(join(saved, "lonely.json"), expr("saved + unbound"));    // -> orphan
  writeFileSync(join(bored, "rk.json"), expr("bored only"));             // bored dir only
  writeFileSync(join(bored, "ht.json"), expr("overlaps canned"));        // also in canned (below)
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: "1.0", intents: {}, harnesses: {},
    renderers: { "esp32-8x8": { bindings: { fail: { pool: { "wired-one": 1 } } } } },
  }));
  const approvedPath = join(dir, "approved.json"); writeFileSync(approvedPath, JSON.stringify({ approved: [] }));
  const canned = { ht: { frames, colors: {}, frame_ms: 150, loop: 0, description: "canned ht" } };

  const data = buildGalleryData({ canned, savedDir: saved, manifestPath, boredDir: bored, approvedPath });
  const groupOf = (n) => data.expressions.find((e) => e.name === n)?.group;
  assert.ok(data.expressions.find((e) => e.name === "rk"), "bored-only `rk` not dropped by the merge");
  assert.equal(groupOf("rk"), "bored", "bored-only `rk` grouped bored");
  assert.equal(groupOf("ht"), "bored", "canned+bored `ht` (unbound) resolves to bored, not canned");
  assert.equal(groupOf("lonely"), "orphan", "saved + unbound -> orphan");
  assert.notEqual(groupOf("wired-one"), "orphan", "saved + manifest-bound -> NOT orphan");
});
