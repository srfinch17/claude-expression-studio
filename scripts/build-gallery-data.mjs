import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyExpression } from "../shared/catalog.js";

const FIRMWARE = ["claudesweep","frostbite","fire","matrix_rain","snow","fireworks","dancefloor"];

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

export function buildGalleryData({ canned, savedDir, waitWeightsPath, boredDir }) {
  const waitWeights = JSON.parse(readFileSync(waitWeightsPath, "utf8")).weights || {};
  const waitNames = new Set([...Object.keys(waitWeights), "working", "claudesweep"]);
  const boredNames = new Set(readDir(boredDir, "bored").map(([n]) => n));
  const cannedNames = new Set(Object.keys(canned));

  // Merge expression DATA from all three sources, de-duped by name. Data priority
  // when a name is in multiple sources: saved > canned > bored (set lowest first
  // so higher priority overwrites). bored_animations/ is a real data source so
  // bored-only animations (e.g. `rocket`) are not dropped.
  const byName = new Map();
  for (const [name, data] of readDir(boredDir, "bored")) byName.set(name, data);
  for (const [name, e] of Object.entries(canned)) {
    byName.set(name, { source: "canned", frames: e.frames, colors: e.colors,
      frame_ms: e.frame_ms || 150, loop: e.loop ?? 0, description: e.description || "" });
  }
  for (const [name, data] of readDir(savedDir, "saved")) byName.set(name, data);

  // Classify every unique name by ROTATION ROLE (priority: ask > wait > bored via
  // classifyExpression). A canned name in no rotation → the "canned" on-demand
  // group; a non-canned (saved) name in no rotation → "orphan". So the orphan gate
  // is exactly the saved-and-unwired set {claude-idle, idea}.
  const expressions = [];
  const groups = { wait: [], ask: [], bored: [], canned: [], orphan: [] };
  for (const [name, data] of byName) {
    let group = classifyExpression(name, { waitNames, boredNames });
    if (group === "orphan" && cannedNames.has(name)) group = "canned";
    expressions.push({ name, ...data, group });
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
    waitWeightsPath: join(root, "mcp_server/wait-weights.json"),
    boredDir: join(root, "claude-hooks/bored_animations"),
  });
  writeFileSync(join(root, "studio/gallery-data.json"), JSON.stringify(data, null, 2));
  console.log(`gallery-data.json: ${data.expressions.length} expressions, ${data.firmware.length} firmware sims`);
  console.log(`groups: wait=${data.groups.wait.length}, ask=${data.groups.ask.length}, bored=${data.groups.bored.length}, canned=${data.groups.canned.length}, orphan=${data.groups.orphan.length}`);
  console.log(`orphans: [${data.groups.orphan.join(", ")}]`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
