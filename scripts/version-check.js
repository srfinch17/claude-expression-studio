// Check version drift: compare the repo's canonical VERSION against what the
// MCP server actually reports, and print a per-artifact ✓ / ⚠ report.
//
//   npm run check
//   node scripts/version-check.js
//
// This is the studio repo. Its one independently-deployed artifact is the MCP
// server; its self-report is the `version` in mcp_server/package.json (read at
// runtime by the server / the matrix_version tool). The firmware + web bundle
// live in the separate peckworks-esp32s3matrix repo and are checked there.
//
// Exit code is non-zero on drift or if the MCP version can't be read, so this
// can gate CI later if desired.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compareArtifact } from "./version-lib.js";
import { readVersion } from "./version-stamp.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Build the drift report. Returns:
 *   { expected, rows: [{ artifact, reported, status }] }
 * `status` is "match" | "drift" | "unknown".
 *
 * `root` is injectable so this is testable against a throwaway tree.
 */
export async function checkVersions({ root = REPO_ROOT } = {}) {
  const expected = await readVersion(root);

  // The MCP server reads its own package.json version at runtime, so that file
  // is the self-report source for the deployed artifact.
  let mcpVersion = "unknown";
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "mcp_server", "package.json"), "utf8"));
    mcpVersion = pkg.version ?? "unknown";
  } catch { /* leave as unknown */ }

  const rows = [
    { artifact: "mcp", reported: mcpVersion, status: compareArtifact(mcpVersion, expected) },
  ];

  return { expected, rows };
}

/** Format a report (from checkVersions) as a human-readable block. */
export function formatReport({ expected, rows }) {
  const mark = { match: "✓", drift: "⚠ DRIFT", unknown: "? unknown" };
  const lines = [`repo VERSION: ${expected}`];
  for (const r of rows) {
    const hint =
      r.status === "drift" ? `  → stale, rebuild + reconnect ${r.artifact}` :
      r.status === "unknown" ? "  → couldn't read version, rebuild to track" : "";
    lines.push(`  ${r.artifact.padEnd(9)} ${String(r.reported).padEnd(8)} ${mark[r.status]}${hint}`);
  }
  return lines.join("\n");
}

// CLI entry
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkVersions();
  console.log(formatReport(report));
  const bad = report.rows.some((r) => r.status === "drift" || r.status === "unknown");
  process.exit(bad ? 1 : 0);
}
