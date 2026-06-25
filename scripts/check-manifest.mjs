// scripts/check-manifest.mjs
// Bespoke validator for shared/manifest.json. Enforces the semantic rules a JSON
// Schema cannot: no fallback cycles, every chain ends at a root, the 6 roots exist
// and are covered by every renderer, every binding references a real animation,
// pool weights are numbers >= 0, and x- intents declare a fallback.
// No external deps. CLI exits 0 (valid) / 1 (errors). Also exported for tests.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_ROOTS = ["info", "working", "done", "attention", "fail", "idle"];
// Firmware animation types that are valid references but are not JSON files.
const FIRMWARE = ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain", "snow", "claudesweep"];

// Gather every name a binding may legally reference: saved + bored JSON file
// stems, canned keys (from the compiled MCP module), and firmware types.
export function collectAnimationNames(root) {
  const names = new Set(FIRMWARE);
  const addDir = (dir) => {
    if (!existsSync(dir)) return;
    for (const fn of readdirSync(dir)) if (fn.endsWith(".json")) names.add(basename(fn, ".json"));
  };
  addDir(join(root, "mcp_server/expressions"));
  addDir(join(root, "claude-hooks/bored_animations"));
  // canned names from the compiled dist (best-effort; skip if not built).
  try {
    const cannedPath = join(root, "mcp_server/dist/expressions.js");
    if (existsSync(cannedPath)) {
      // Synchronous require-like read: parse exported keys without importing.
      const src = readFileSync(cannedPath, "utf8");
      // CANNED is an object literal/Map; capture top-level "name": entries.
      for (const m of src.matchAll(/["'`]([a-z0-9_-]+)["'`]\s*:/gi)) names.add(m[1]);
    }
  } catch { /* canned optional */ }
  // Always include the canned names this manifest relies on, in case dist is stale.
  for (const n of ["smiley", "done", "cross", "party", "working", "ok", "sleep", "alert"]) names.add(n);
  return names;
}

// Returns an array of human-readable error strings; empty array means valid.
export function validateManifest(manifest, animationNames) {
  const errors = [];
  const intents = manifest.intents || {};
  const renderers = manifest.renderers || {};

  // 1. Required roots exist and are marked root:true with fallback null.
  for (const root of REQUIRED_ROOTS) {
    const def = intents[root];
    if (!def) { errors.push(`missing required root intent "${root}"`); continue; }
    if (def.root !== true) errors.push(`root intent "${root}" must have root:true`);
    if (def.fallback != null) errors.push(`root intent "${root}" must have fallback:null`);
  }

  // 2. Fallbacks reference real intents; x- intents must declare a fallback.
  for (const [name, def] of Object.entries(intents)) {
    if (name.startsWith("x-") && def.fallback == null)
      errors.push(`extension intent "${name}" must declare a fallback`);
    if (def.fallback != null && !intents[def.fallback])
      errors.push(`intent "${name}" falls back to unknown intent "${def.fallback}"`);
  }

  // 3. Each chain has no cycle and terminates at a root (fallback null + root:true).
  for (const name of Object.keys(intents)) {
    const seen = new Set();
    let cur = name;
    while (cur != null) {
      if (seen.has(cur)) { errors.push(`intent "${name}" is in a fallback cycle`); break; }
      seen.add(cur);
      const def = intents[cur];
      if (!def) break; // unknown intent already reported by rule 2
      if (def.fallback == null) {
        if (def.root !== true)
          errors.push(`intent "${name}" chain dead-ends at non-root "${cur}" (must reach a root)`);
        break;
      }
      cur = def.fallback;
    }
  }

  // 4. Renderer inheritance resolves (no cycle, target exists) + covers the roots.
  const effective = (rid, seen = new Set()) => {
    const r = renderers[rid];
    if (!r) { errors.push(`renderer "${rid}" inherits unknown renderer`); return {}; }
    if (seen.has(rid)) { errors.push(`renderer "${rid}" has an inherits cycle`); return {}; }
    seen.add(rid);
    const inh = r.inherits ? effective(r.inherits, seen) : {};
    return { ...inh, ...(r.bindings || {}) };
  };
  for (const [rid, r] of Object.entries(renderers)) {
    const bindings = effective(rid);
    for (const root of REQUIRED_ROOTS)
      if (!(root in bindings)) errors.push(`renderer "${rid}" does not bind required root "${root}"`);

    // 5. Binding values: string -> anim exists; {pool} -> each key exists + weight>=0;
    //    other object -> renderer-custom (card), accepted.
    for (const [intent, value] of Object.entries(r.bindings || {})) {
      if (intents[intent] === undefined)
        errors.push(`renderer "${rid}" binds unknown intent "${intent}"`);
      if (typeof value === "string") {
        if (!animationNames.has(value))
          errors.push(`renderer "${rid}" intent "${intent}" references missing animation "${value}"`);
      } else if (value && typeof value === "object" && value.pool) {
        for (const [anim, w] of Object.entries(value.pool)) {
          if (!animationNames.has(anim))
            errors.push(`renderer "${rid}" pool "${intent}" references missing animation "${anim}"`);
          if (typeof w !== "number" || w < 0)
            errors.push(`renderer "${rid}" pool "${intent}" has invalid weight for "${anim}"`);
        }
      }
    }
  }
  return errors;
}

// CLI entrypoint.
function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(join(root, "shared/manifest.json"), "utf8"));
  const errors = validateManifest(manifest, collectAnimationNames(root));
  if (errors.length === 0) { console.log("manifest OK"); return; }
  console.error(`manifest INVALID (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
