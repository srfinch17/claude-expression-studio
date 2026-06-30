#!/usr/bin/env node
// scripts/studio.mjs — `npm run studio`: launch the Studio engine for local development.
// Serves the studio/ + shared/ tree, the manifest read/write API (so the Editor can Save), the
// expression/approval write routes, the /api/framebuffer board proxy, and the /events SSE virtual
// board — all bound to 127.0.0.1. In dev it reads/writes THIS repo's shared/manifest.json, so
// edits made in the browser persist straight to the repo (and `npm run check:manifest` will agree).
//
// Requires the engine to be compiled first (mcp_server/dist/). Run `npm test` or
// `cd mcp_server && npx tsc` if dist is missing — this script says so rather than crashing.
//
// Env: ENGINE_PORT (default 8787; falls back to an OS-assigned port if busy),
//      ESP32_URL (board base URL for the framebuffer mirror; default http://esp32matrix.local).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(repoRoot, "mcp_server");
const distEntry = path.join(mcpDir, "dist", "engine-server.js");

if (!existsSync(distEntry)) {
  console.error("Studio engine not built. Run:  cd mcp_server && npx tsc   (or: npm test)");
  process.exit(1);
}

const { startEngineServer } = await import(pathToFileURL(distEntry).href);
const port = Number(process.env.ENGINE_PORT) || 8787;
const boardUrl = process.env.ESP32_URL || "http://esp32matrix.local";
const s = await startEngineServer({ mcpDir, port, boardUrl });

console.log(`\nStudio engine up: ${s.url}`);
console.log(`  Editor:  ${s.url}/studio/editor.html   (bind/reweight intents — Save persists to shared/manifest.json)`);
console.log(`  Gallery: ${s.url}/studio/index.html`);
console.log(`  Board:   ${s.url}/studio/board.html`);
console.log(`\n  board: ${boardUrl}    Ctrl+C to stop.\n`);
