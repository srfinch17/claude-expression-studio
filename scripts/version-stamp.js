// Stamp the canonical VERSION into every artifact's source.
//
//   VERSION ──►  mcp_server/package.json   ("version" — MCP server's runtime self-report)
//           ──►  mcp_server/manifest.json  ("version" — .mcpb bundle manifest)
//           ──►  shared/manifest.json      ("appVersion" — trigger manifest; its
//                                           schema "version" field is left untouched)
//
// This is the studio repo. Its one independently-deployed artifact is the MCP
// server, shipped as an .mcpb bundle. The firmware + web bundle live in the
// separate peckworks-esp32s3matrix repo and stamp themselves there.
//
// Run directly (`node scripts/version-stamp.js`) or import `stamp()` for tests.
// Idempotent.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseSemver } from "./version-lib.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Read and validate the canonical version from the VERSION file. */
export async function readVersion(root = REPO_ROOT) {
  const raw = await readFile(path.join(root, "VERSION"), "utf8");
  const version = raw.trim();
  parseSemver(version); // throws if malformed
  return version;
}

/** Write `version` into all three artifact sources under `root`. */
export async function stamp(version, root = REPO_ROOT) {
  parseSemver(version); // guard against stamping garbage

  // 1. MCP server manifest (its runtime self-report) — read/modify/write to preserve the rest.
  const pkgPath = path.join(root, "mcp_server", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.version = version;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  // 2. .mcpb bundle manifest — read/modify/write to preserve other fields.
  const manifestPath = path.join(root, "mcp_server", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // 3. Trigger manifest — stamp the product version into `appVersion`, leaving the
  //    hand-aligned schema "version" field (and the file's formatting) untouched.
  //    A targeted text edit, NOT a JSON round-trip, so the manifest's alignment survives.
  const triggerPath = path.join(root, "shared", "manifest.json");
  let trigger = await readFile(triggerPath, "utf8");
  if (/"appVersion"\s*:/.test(trigger)) {
    trigger = trigger.replace(/"appVersion"\s*:\s*"[^"]*"/, `"appVersion": "${version}"`);
  } else {
    // Insert an appVersion line right after the schema "version" line, matching its
    // indent and line ending. Capture only horizontal whitespace ([ \t]*, not \s* —
    // \s swallows newlines, and JS treats a lone \r as a ^ boundary in CRLF files),
    // and reuse the captured eol so the real (CRLF) manifest stays CRLF.
    trigger = trigger.replace(
      /([ \t]*)"version"\s*:\s*"[^"]*",(\r?\n)/,
      (line, indent, eol) => `${line}${indent}"appVersion": "${version}",${eol}`,
    );
  }
  await writeFile(triggerPath, trigger, "utf8");

  return version;
}

// CLI entry: stamp the current VERSION into every artifact.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = await readVersion();
  await stamp(version);
  console.log(`Stamped v${version} → mcp_server/package.json, mcp_server/manifest.json, shared/manifest.json (appVersion)`);
}
