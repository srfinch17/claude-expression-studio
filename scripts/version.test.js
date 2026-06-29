// Unit tests for the versioning tooling. Run with `npm test` (node --test).
// Covers the pure logic (semver math, drift comparison), the stamp targets
// (MCP package.json + .mcpb manifest + trigger manifest appVersion), and the
// drift check against the local MCP self-report. No board or network needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseSemver, nextVersion, compareArtifact } from "./version-lib.js";
import { stamp } from "./version-stamp.js";
import { checkVersions } from "./version-check.js";

test("parseSemver accepts x.y.z and rejects junk", () => {
  assert.deepEqual(parseSemver("0.1.0"), [0, 1, 0]);
  assert.deepEqual(parseSemver(" 12.3.45 \n"), [12, 3, 45]);
  for (const bad of ["1.0", "v1.0.0", "1.0.0-rc", "", "a.b.c"]) {
    assert.throws(() => parseSemver(bad), /Malformed version/);
  }
});

test("nextVersion bumps each component and resets lower ones", () => {
  assert.equal(nextVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(nextVersion("0.1.9", "minor"), "0.2.0");
  assert.equal(nextVersion("1.4.7", "major"), "2.0.0");
  assert.throws(() => nextVersion("0.1.0", "bogus"), /Unknown bump type/);
});

test("compareArtifact classifies match / drift / unknown", () => {
  assert.equal(compareArtifact("0.1.0", "0.1.0"), "match");
  assert.equal(compareArtifact("0.0.9", "0.1.0"), "drift");
  for (const u of [undefined, null, "", "unknown"]) {
    assert.equal(compareArtifact(u, "0.1.0"), "unknown");
  }
});

// A hand-aligned trigger manifest, like the real shared/manifest.json: padded
// columns AND CRLF line endings (the real file is CRLF). The padding proves
// stamp() does a targeted edit rather than a reformatting JSON round-trip; the
// CRLF proves the insert regex tolerates Windows line endings, not just LF.
const TRIGGER_MANIFEST = [
  "{",
  '  "version": "1.0",',
  '  "intents": {',
  '    "info":    { "fallback": null, "root": true },',
  '    "working": { "fallback": null, "root": true }',
  "  }",
  "}",
  "",
].join("\r\n");

// Build a throwaway studio repo tree so stamp() has real files to write. There
// is NO esp32_matrix_webserver/ here — that's the firmware repo — so a stamp
// that wrongly reached for firmware artifacts would fail.
async function fixtureRoot(version) {
  const root = await mkdtemp(path.join(tmpdir(), "vtest-"));
  await mkdir(path.join(root, "mcp_server"), { recursive: true });
  await mkdir(path.join(root, "shared"), { recursive: true });
  await writeFile(path.join(root, "VERSION"), version + "\n");
  await writeFile(
    path.join(root, "mcp_server", "package.json"),
    JSON.stringify({ name: "esp32-matrix-mcp", version: "0.0.0", type: "module" }, null, 2) + "\n",
  );
  await writeFile(
    path.join(root, "mcp_server", "manifest.json"),
    JSON.stringify({ manifest_version: "0.3", name: "esp32-matrix", version: "0.0.0", server: { type: "node", entry_point: "dist/index.js" } }, null, 2) + "\n",
  );
  await writeFile(path.join(root, "shared", "manifest.json"), TRIGGER_MANIFEST);
  return root;
}

test("stamp writes the version into the three studio artifacts and nothing else", async () => {
  const root = await fixtureRoot("0.1.0");
  await stamp("0.3.0", root);

  const pkg = JSON.parse(await readFile(path.join(root, "mcp_server", "package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.0");
  assert.equal(pkg.name, "esp32-matrix-mcp", "stamp preserves other package.json fields");

  const manifest = JSON.parse(await readFile(path.join(root, "mcp_server", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.name, "esp32-matrix", "stamp preserves other manifest fields");

  const trigger = JSON.parse(await readFile(path.join(root, "shared", "manifest.json"), "utf8"));
  assert.equal(trigger.appVersion, "0.3.0", "product version stamped into appVersion");
  assert.equal(trigger.version, "1.0", "schema version field is left untouched");

  // Discriminating: the firmware + web bundle live in the other repo. stamp()
  // must not reach across to an esp32_matrix_webserver/ tree here.
  await assert.rejects(
    access(path.join(root, "esp32_matrix_webserver")),
    "stamp() must not write any firmware artifact in the studio repo",
  );
});

test("stamp edits the trigger manifest in place without reformatting it", async () => {
  const root = await fixtureRoot("0.2.0");
  await stamp("0.2.0", root);
  const text = await readFile(path.join(root, "shared", "manifest.json"), "utf8");
  // The hand-aligned intent rows survive verbatim (a JSON round-trip would expand them).
  assert.match(text, /"info":    \{ "fallback": null, "root": true \}/);
  // The inserted appVersion line uses the file's CRLF line ending, not a bare LF.
  assert.match(text, /"appVersion": "0\.2\.0",\r\n/);
  assert.ok(!/[^\r]\n/.test(text), "no bare LF introduced — file stays CRLF throughout");
});

test("stamp is idempotent on the trigger manifest (no duplicate appVersion)", async () => {
  const root = await fixtureRoot("0.2.0");
  await stamp("0.2.0", root);
  await stamp("0.4.0", root);
  const text = await readFile(path.join(root, "shared", "manifest.json"), "utf8");
  assert.equal((text.match(/"appVersion"/g) || []).length, 1, "exactly one appVersion line");
  assert.match(text, /"appVersion": "0\.4\.0"/);
});

test("checkVersions reports match when the MCP package.json agrees", async () => {
  const root = await fixtureRoot("0.2.0");
  await stamp("0.2.0", root);
  const report = await checkVersions({ root });
  const byArtifact = Object.fromEntries(report.rows.map((r) => [r.artifact, r.status]));
  // Studio checks exactly one artifact — the MCP server. No firmware/web rows.
  assert.deepEqual(byArtifact, { mcp: "match" });
});

test("checkVersions flags drift when the MCP package.json is stale", async () => {
  const root = await fixtureRoot("0.2.0");
  // package.json fixture is at 0.0.0; VERSION is 0.2.0 → drift.
  const report = await checkVersions({ root });
  const mcp = report.rows.find((r) => r.artifact === "mcp");
  assert.equal(mcp.status, "drift");
  assert.equal(mcp.reported, "0.0.0");
});

test("checkVersions marks the MCP unknown when package.json is unreadable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vtest-"));
  await writeFile(path.join(root, "VERSION"), "0.2.0\n");
  const report = await checkVersions({ root });
  const mcp = report.rows.find((r) => r.artifact === "mcp");
  assert.equal(mcp.status, "unknown");
});
