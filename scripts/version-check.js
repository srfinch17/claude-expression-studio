// Check version drift: compare the repo's canonical VERSION against what each
// artifact actually reports, and print a per-artifact ✓ / ⚠ report.
//
//   npm run check                  (uses ESP32_URL or the mDNS default)
//   node scripts/version-check.js  [boardUrl]
//
// Also imported by the matrix_version MCP tool, which calls checkVersions()
// and formats the same rows. Exit code is non-zero on any drift or if the
// board is unreachable, so this can gate CI later if desired.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compareArtifact } from "./version-lib.js";
import { readVersion } from "./version-stamp.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BOARD = process.env.ESP32_URL ?? "http://esp32matrix.local";

/**
 * Build the drift report. Returns:
 *   { expected, reachable, rows: [{ artifact, reported, status }] }
 * `status` is "match" | "drift" | "unknown" | "unreachable".
 *
 * `fetchFn` and `root` are injectable so this is testable without a board.
 */
export async function checkVersions({ root = REPO_ROOT, boardUrl = DEFAULT_BOARD, fetchFn = fetch } = {}) {
  const expected = await readVersion(root);

  // MCP version is local — read it straight from its manifest.
  let mcpVersion = "unknown";
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "mcp_server", "package.json"), "utf8"));
    mcpVersion = pkg.version ?? "unknown";
  } catch { /* leave as unknown */ }

  let bundleVersion = "unknown";
  try {
    const m = JSON.parse(await readFile(path.join(root, "mcp_server", "manifest.json"), "utf8"));
    bundleVersion = m.version ?? "unknown";
  } catch { /* leave as unknown */ }

  const rows = [
    { artifact: "mcp", reported: mcpVersion, status: compareArtifact(mcpVersion, expected) },
    { artifact: "mcp-bundle", reported: bundleVersion, status: compareArtifact(bundleVersion, expected) },
  ];

  // Firmware + web come from the board's /api/status in one call.
  let reachable = true;
  try {
    const res = await fetchFn(`${boardUrl}/api/status`, { signal: AbortSignal.timeout(8000) });
    const status = await res.json();
    const fw = status.fw_version;
    const web = status.web_version;
    rows.unshift(
      { artifact: "firmware", reported: fw ?? "unknown", status: compareArtifact(fw, expected), built: status.fw_built },
      { artifact: "web", reported: web ?? "unknown", status: compareArtifact(web, expected) },
    );
  } catch {
    reachable = false;
    rows.unshift(
      { artifact: "firmware", reported: "?", status: "unreachable" },
      { artifact: "web", reported: "?", status: "unreachable" },
    );
  }

  return { expected, reachable, rows };
}

/** Format a report (from checkVersions) as a human-readable block. */
export function formatReport({ expected, rows }) {
  const mark = { match: "✓", drift: "⚠ DRIFT", unknown: "? unknown", unreachable: "✗ unreachable" };
  const lines = [`repo VERSION: ${expected}`];
  for (const r of rows) {
    const built = r.built ? `  (built ${r.built})` : "";
    const hint =
      r.status === "drift" ? `  → stale, redeploy ${r.artifact}` :
      r.status === "unknown" && r.artifact !== "mcp" ? "  → pre-versioning deploy, redeploy to track" : "";
    lines.push(`  ${r.artifact.padEnd(9)} ${String(r.reported).padEnd(8)} ${mark[r.status]}${built}${hint}`);
  }
  return lines.join("\n");
}

// CLI entry
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const boardUrl = process.argv[2] || DEFAULT_BOARD;
  const report = await checkVersions({ boardUrl });
  console.log(formatReport(report));
  const bad = report.rows.some((r) => r.status === "drift" || r.status === "unreachable");
  process.exit(bad ? 1 : 0);
}
