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
  const groupOf = (n) => data.expressions.find((e) => e.name === n)?.group;
  assert.ok(data.firmware.includes("claudesweep") && data.firmware.length === 7, "7 firmware sims listed");

  // The orphan gate: saved-but-unwired expressions. The known unwired ones plus the v1
  // animation library (built unwired, awaiting the event-assignment pass) all land here.
  const orphans = data.expressions.filter((e) => e.group === "orphan").map((e) => e.name);
  for (const n of ["claude-idle", "idea", "task-complete", "goldfish", "skull"])
    assert.ok(orphans.includes(n), `${n} is an unwired orphan`);

  // Rotation role wins over data-origin tier for dual-members:
  assert.equal(groupOf("sparkle"), "canned", "pure on-demand glyph → canned");
  assert.equal(groupOf("heart"), "bored", "canned+bored → bored (rotation wins)");
  assert.equal(groupOf("working"), "wait", "canned+wait → wait (rotation wins)");
  // Completeness: a bored-only animation (no canned/saved counterpart) is not dropped.
  assert.equal(groupOf("rocket"), "bored", "bored-only animation present and grouped bored");

  // Every entry carries frames + a valid group.
  for (const e of data.expressions) {
    assert.ok(Array.isArray(e.frames) && e.frames.length > 0, `${e.name} has frames`);
    assert.ok(["wait","ask","bored","orphan","canned"].includes(e.group), `${e.name} grouped`);
  }
});
