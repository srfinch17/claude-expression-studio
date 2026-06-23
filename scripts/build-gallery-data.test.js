import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGalleryData, loadCanned } from "./build-gallery-data.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("buildGalleryData merges canned + saved, classifies, lists firmware", async () => {
  const canned = await loadCanned(join(ROOT, "mcp_server/dist/expressions.js"));
  const data = buildGalleryData({
    canned,
    savedDir: join(ROOT, "mcp_server/expressions"),
    waitWeightsPath: join(ROOT, "mcp_server/wait-weights.json"),
    boredDir: join(ROOT, "claude-hooks/bored_animations"),
  });
  const names = data.expressions.map((e) => e.name);
  assert.ok(names.includes("claude-idle"), "saved orphan present");
  assert.ok(data.firmware.includes("claudesweep"), "firmware listed");
  const orphans = data.expressions.filter((e) => e.group === "orphan").map((e) => e.name).sort();
  assert.deepEqual(orphans, ["claude-idle", "idea"], "exactly the two known orphans (saved tier only)");
  // canned expressions form their own group, never orphan
  const cannedEntries = data.expressions.filter((e) => e.source === "canned");
  assert.ok(cannedEntries.length > 0, "canned expressions present");
  for (const e of cannedEntries) assert.equal(e.group, "canned", `${e.name} is grouped canned`);
  // every entry carries frames + a valid group
  for (const e of data.expressions) {
    assert.ok(Array.isArray(e.frames) && e.frames.length > 0, `${e.name} has frames`);
    assert.ok(["wait","ask","bored","orphan","canned"].includes(e.group), `${e.name} grouped`);
  }
});
