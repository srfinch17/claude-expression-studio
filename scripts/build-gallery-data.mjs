// scripts/build-gallery-data.mjs — the Gallery's build step. Bakes studio/gallery-data.json
// (the static data studio/gallery.js fetches) so the Gallery renders with no server: it
// merges expression data from all three sources — canned glyphs (the compiled MCP module),
// saved JSON (mcp_server/expressions/), and the bored watcher's lineup
// (claude-hooks/bored_animations/) — de-duped by name (saved > canned > bored), then tags
// each with its manifest-derived rotation role via shared/catalog.js. "orphan" = saved but
// unbound by the manifest (the unwired library). Pure buildGalleryData() is unit-tested; main()
// wires the real repo paths. Run via `npm run build:gallery` (also part of build:pages).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { manifestRoles, classifyExpression } from "../shared/catalog.js";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";

const FIRMWARE = Object.keys(FIRMWARE_SIMS);

// User-approved ("done") expressions live in studio/approved.json (the engine-owned approval
// source). The studio gallery renders a green ✓ on these. The expression editor's save
// auto-removes a name here (edit → orange / pending re-review). buildGalleryData reads the
// file via the required `approvedPath` param.
function readApproved(approvedPath) {
  try { return new Set(JSON.parse(readFileSync(approvedPath, "utf8")).approved || []); }
  catch { return new Set(); }
}

// Dynamic-import the COMPILED MCP module so canned data has a single source of
// truth (never re-parse the .ts). Async; main() and tests await this first.
export async function loadCanned(cannedModulePath) {
  const mod = await import(pathToFileURL(cannedModulePath).href);
  return mod.CANNED;
}

// helper: read all *.json in a dir into [name, {source, frames, colors, frame_ms, loop, description}]
function readDir(dir, source) {
  const out = [];
  for (const fn of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(dir, fn), "utf8"));
    out.push([basename(fn, ".json"), { source, frames: j.frames, colors: j.colors,
      frame_ms: j.frame_ms || 150, loop: j.loop ?? 0, description: j.description || "" }]);
  }
  return out;
}

export function buildGalleryData({ canned, savedDir, manifestPath, boredDir, approvedPath }) {
  const approved = readApproved(approvedPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const roles = manifestRoles(manifest);                       // name -> wait/ask/bored/wired
  const boredNames = new Set(readDir(boredDir, "bored").map(([n]) => n));
  const cannedNames = new Set(Object.keys(canned));

  // Merge expression DATA from all three sources, de-duped by name (saved > canned > bored).
  const byName = new Map();
  for (const [name, data] of readDir(boredDir, "bored")) byName.set(name, data);
  for (const [name, e] of Object.entries(canned)) {
    byName.set(name, { source: "canned", frames: e.frames, colors: e.colors,
      frame_ms: e.frame_ms || 150, loop: e.loop ?? 0, description: e.description || "" });
  }
  for (const [name, data] of readDir(savedDir, "saved")) byName.set(name, data);

  // Classify every unique name by manifest-derived rotation role. Orphan = saved AND
  // unbound by the manifest (the unwired v1 library + the saved-but-unbound glyphs).
  const expressions = [];
  const groups = { wait: [], ask: [], bored: [], wired: [], canned: [], orphan: [] };
  const ctx = { roles, boredNames, cannedNames };
  for (const [name, data] of byName) {
    const group = classifyExpression(name, ctx);
    expressions.push({ name, ...data, group, approved: approved.has(name) });
    groups[group].push(name);
  }

  return { expressions, firmware: FIRMWARE, groups };
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const canned = await loadCanned(join(root, "mcp_server/dist/expressions.js"));
  const data = buildGalleryData({
    canned,
    savedDir: join(root, "mcp_server/expressions"),
    manifestPath: join(root, "shared/manifest.json"),
    boredDir: join(root, "claude-hooks/bored_animations"),
    approvedPath: join(root, "studio/approved.json"),
  });
  writeFileSync(join(root, "studio/gallery-data.json"), JSON.stringify(data, null, 2));
  console.log(`gallery-data.json: ${data.expressions.length} expressions, ${data.firmware.length} firmware sims`);
  console.log(`groups: wait=${data.groups.wait.length}, ask=${data.groups.ask.length}, bored=${data.groups.bored.length}, wired=${data.groups.wired.length}, canned=${data.groups.canned.length}, orphan=${data.groups.orphan.length}`);
  console.log(`orphans: [${data.groups.orphan.join(", ")}]`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
