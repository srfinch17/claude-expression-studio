// Unit tests for the versioning tooling. Run with `npm test` (node --test).
// Covers the pure logic (semver math, drift comparison) and the check
// report-building against mock /api/status payloads, no board required.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
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

// Build a throwaway repo tree so stamp() has real files to write.
async function fixtureRoot(version) {
  const root = await mkdtemp(path.join(tmpdir(), "vtest-"));
  await mkdir(path.join(root, "esp32_matrix_webserver", "data"), { recursive: true });
  await mkdir(path.join(root, "mcp_server"), { recursive: true });
  await writeFile(path.join(root, "VERSION"), version + "\n");
  await writeFile(
    path.join(root, "mcp_server", "package.json"),
    JSON.stringify({ name: "esp32-matrix-mcp", version: "0.0.0", type: "module" }, null, 2) + "\n",
  );
  await writeFile(
    path.join(root, "mcp_server", "manifest.json"),
    JSON.stringify({ manifest_version: "0.3", name: "esp32-matrix", version: "0.0.0", server: { type: "node", entry_point: "dist/index.js" } }, null, 2) + "\n",
  );
  return root;
}

test("stamp writes the version into all four artifacts", async () => {
  const root = await fixtureRoot("0.1.0");
  await stamp("0.3.0", root);

  const h = await readFile(path.join(root, "esp32_matrix_webserver", "version.h"), "utf8");
  assert.match(h, /#define FW_VERSION "0\.3\.0"/);

  const web = JSON.parse(await readFile(path.join(root, "esp32_matrix_webserver", "data", "version.json"), "utf8"));
  assert.equal(web.version, "0.3.0");
  assert.ok(web.stamped, "version.json carries a stamped timestamp");

  const pkg = JSON.parse(await readFile(path.join(root, "mcp_server", "package.json"), "utf8"));
  assert.equal(pkg.version, "0.3.0");
  assert.equal(pkg.name, "esp32-matrix-mcp", "stamp preserves other package.json fields");

  const manifest = JSON.parse(await readFile(path.join(root, "mcp_server", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.name, "esp32-matrix", "stamp preserves other manifest fields");
});

// A fake fetch returning a chosen /api/status body.
function fakeFetch(body) {
  return async () => ({ json: async () => body });
}

test("checkVersions reports match when board agrees", async () => {
  const root = await fixtureRoot("0.2.0");
  await stamp("0.2.0", root); // make mcp package.json match
  const report = await checkVersions({
    root,
    boardUrl: "http://x",
    fetchFn: fakeFetch({ fw_version: "0.2.0", fw_built: "Jun 16 2026", web_version: "0.2.0" }),
  });
  assert.equal(report.reachable, true);
  const byArtifact = Object.fromEntries(report.rows.map((r) => [r.artifact, r.status]));
  assert.deepEqual(byArtifact, { firmware: "match", web: "match", mcp: "match", "mcp-bundle": "match" });
});

test("checkVersions flags firmware drift and unknown web", async () => {
  const root = await fixtureRoot("0.2.0");
  await stamp("0.2.0", root);
  const report = await checkVersions({
    root,
    boardUrl: "http://x",
    fetchFn: fakeFetch({ fw_version: "0.1.0", web_version: "unknown" }),
  });
  const byArtifact = Object.fromEntries(report.rows.map((r) => [r.artifact, r.status]));
  assert.equal(byArtifact.firmware, "drift");
  assert.equal(byArtifact.web, "unknown");
});

test("checkVersions marks board unreachable without throwing", async () => {
  const root = await fixtureRoot("0.2.0");
  const report = await checkVersions({
    root,
    boardUrl: "http://x",
    fetchFn: async () => { throw new Error("ECONNREFUSED"); },
  });
  assert.equal(report.reachable, false);
  const fw = report.rows.find((r) => r.artifact === "firmware");
  assert.equal(fw.status, "unreachable");
});
