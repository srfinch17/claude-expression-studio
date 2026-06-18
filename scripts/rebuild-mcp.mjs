#!/usr/bin/env node
// Claude Code hook: rebuild the MCP server when its TypeScript is stale.
//
// Wired to PostToolUse (fires the instant Claude edits a file) and SessionStart
// (catch-all for edits made outside Claude). It is event-agnostic: it ignores the
// hook's stdin payload and simply compares the newest mcp_server/*.ts mtime against
// the compiled dist/index.js. If sources are newer, it runs `tsc`. Otherwise it is a
// near-instant no-op, so it is cheap to fire on every edit in the repo.
//
// Why this exists: the live MCP server runs the COMPILED dist, so TS edits are
// invisible until rebuilt. Forgetting to rebuild left a stale dist (root cause of a
// debugging session on 2026-06-18). This removes the manual `npx tsc` step from the
// loop. The one thing it can't do is reconnect the already-running server — that's a
// user action (/mcp reconnect), which the success message reminds you to do.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcpDir = join(repoRoot, 'mcp_server');
const distEntry = join(mcpDir, 'dist', 'index.js');

if (!existsSync(mcpDir)) process.exit(0); // not this repo / nothing to do

// Newest mtime among compilable .ts files (mirror tsconfig: skip node_modules,
// dist, and *.test.ts which are excluded from the build).
function newestTsMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestTsMtime(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

const srcMtime = newestTsMtime(mcpDir);
const distMtime = existsSync(distEntry) ? statSync(distEntry).mtimeMs : 0;
if (srcMtime <= distMtime) process.exit(0); // dist is current — nothing to do

// On Windows the npm shim is npx.cmd; elsewhere it's npx. execFileSync with shell
// lets the platform resolve it without us hardcoding a path.
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
try {
  execFileSync(npx, ['tsc', '--project', 'tsconfig.json'], {
    cwd: mcpDir,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  process.stdout.write(JSON.stringify({
    systemMessage:
      '🔧 MCP server rebuilt (mcp_server/*.ts → dist). Run /mcp to reconnect so the changes take effect.',
  }));
  process.exit(0);
} catch (err) {
  const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
  process.stderr.write('MCP server build FAILED — fix these TypeScript errors:\n' + out + '\n');
  process.exit(2); // exit 2 surfaces the errors back to Claude so they get fixed
}
