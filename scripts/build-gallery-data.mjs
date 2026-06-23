import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildCatalog } from "../shared/catalog.js";

const FIRMWARE = ["claudesweep","frostbite","fire","matrix_rain","snow","fireworks","dancefloor"];

// Dynamic-import the COMPILED MCP module so canned data has a single source of
// truth (never re-parse the .ts). Async; main() and tests await this first.
export async function loadCanned(cannedModulePath) {
  const mod = await import(pathToFileURL(cannedModulePath).href);
  return mod.CANNED;
}

export function buildGalleryData({ canned, savedDir, waitWeightsPath, boredDir }) {
  const waitWeights = JSON.parse(readFileSync(waitWeightsPath, "utf8")).weights || {};
  const waitNames = new Set([...Object.keys(waitWeights), "working", "claudesweep"]);
  const boredNames = new Set(
    readdirSync(boredDir).filter((n) => n.endsWith(".json")).map((n) => basename(n, ".json"))
  );

  const expressions = [];
  // CANNED tier — the on-demand matrix_express palette. Their OWN group; NOT run
  // through the rotation classifier (they are not wait/ask/bored members and are
  // never "orphans" — they are always reachable by name).
  for (const [name, e] of Object.entries(canned)) {
    expressions.push({ name, source: "canned", frames: e.frames, colors: e.colors,
      frame_ms: e.frame_ms || 150, loop: e.loop ?? 0, description: e.description || "", group: "canned" });
  }
  // SAVED tier — *.json files, classified into wait/ask/bored/orphan. The orphan
  // gate ({claude-idle, idea}) is defined over THIS tier only.
  const saved = [];
  for (const fn of readdirSync(savedDir).filter((n) => n.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(savedDir, fn), "utf8"));
    saved.push({ name: basename(fn, ".json"), source: "saved", frames: j.frames,
      colors: j.colors, frame_ms: j.frame_ms || 150, loop: j.loop ?? 0, description: j.description || "" });
  }
  const cat = buildCatalog(saved.map((e) => e.name), { waitNames, boredNames });
  const groupOf = {};
  for (const g of Object.keys(cat)) for (const n of cat[g]) groupOf[n] = g;
  for (const e of saved) { e.group = groupOf[e.name]; expressions.push(e); }

  return { expressions, firmware: FIRMWARE, groups: cat };
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
  mkdirSync(join(root, "studio"), { recursive: true });
  writeFileSync(join(root, "studio/gallery-data.json"), JSON.stringify(data, null, 2));
  const nCanned = data.expressions.filter(e => e.source === "canned").length;
  const nSaved = data.expressions.filter(e => e.source === "saved").length;
  console.log(`gallery-data.json: ${data.expressions.length} expressions (canned: ${nCanned}, saved: ${nSaved}), ${data.firmware.length} firmware sims`);
  console.log(`saved groups: wait=${data.groups.wait.length}, ask=${data.groups.ask.length}, bored=${data.groups.bored.length}, orphan=${data.groups.orphan.length}`);
  console.log(`orphans: [${data.groups.orphan.join(", ")}]`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
