// scripts/check-manifest.mjs
// Bespoke validator for shared/manifest.json. Enforces the semantic rules a JSON
// Schema cannot: no fallback cycles, every chain ends at a root, the 6 roots exist
// and are covered by every renderer, every binding references a real animation,
// pool weights are numbers >= 0, and x- intents declare a fallback.
// No external deps. CLI exits 0 (valid) / 1 (errors). Also exported for tests.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Firmware animation type names come from the SINGLE source of truth, not a private copy:
// a stale hardcoded subset here silently rejects valid firmware sims the Studio offers (e.g.
// "wave", "sun") on Save. shared/firmware-names.js is also what manifest-assets.test.ts uses.
import { FIRMWARE_NAMES } from "../shared/firmware-names.js";

export const REQUIRED_ROOTS = ["info", "working", "done", "attention", "fail", "idle"];

// Gather every name a binding may legally reference: saved + bored JSON file
// stems, canned keys (from the compiled MCP module), and firmware types.
export function collectAnimationNames(root) {
  const names = new Set(FIRMWARE_NAMES);   // firmware types are valid references but not JSON files
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
  // The full canned vocabulary (mcp_server/expressions.ts CANNED), listed explicitly: tsc
  // compiles CANNED with UNQUOTED identifier keys that the quoted-key regex above never matches,
  // and the dist may be stale or unbuilt. So this list, not the regex, is what actually lets a
  // manifest bind a canned glyph. Keep it in sync with CANNED; manifest-assets.test.ts checks the
  // live CANNED import for the authoritative guarantee.
  for (const n of ["smiley", "sad", "heart", "cross", "thumbsup", "ok", "sparkle", "alert",
                   "working", "party", "spaceship", "sleep"]) names.add(n);
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
  // reportedCycle dedupes: one structural cycle yields one error, not one per node.
  const reportedCycle = new Set();
  for (const name of Object.keys(intents)) {
    const seen = new Set();
    let cur = name;
    while (cur != null) {
      if (seen.has(cur)) {
        // Only report this cycle once, skip if any implicated node was already reported.
        if (![...seen].some((n) => reportedCycle.has(n)))
          errors.push(`intent "${name}" is in a fallback cycle`);
        for (const n of seen) reportedCycle.add(n);
        break;
      }
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
  const reportedMissingRenderer = new Set();
  const effective = (rid, seen = new Set()) => {
    const r = renderers[rid];
    if (!r) {
      if (!reportedMissingRenderer.has(rid)) {
        reportedMissingRenderer.add(rid);
        errors.push(`renderer "${rid}" inherits unknown renderer`);
      }
      return {};
    }
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
          const weight = typeof w === "number" ? w
            : (w && typeof w === "object" ? (typeof w.weight === "number" ? w.weight : 1) : NaN);
          if (typeof weight !== "number" || Number.isNaN(weight) || weight < 0)
            errors.push(`renderer "${rid}" pool "${intent}" has invalid weight for "${anim}"`);
        }
      }
    }
  }

  // 6. No duplicate moment `on` within a harness (intentForMoment returns the FIRST
  //    match, so a duplicate hook moment would silently never fire). "discretionary"
  //    is exempt: it is reached via the intent path, not moment-lookup, and is shared
  //    by the discretionary intents intentionally.
  for (const [hid, h] of Object.entries(manifest.harnesses || {})) {
    const seen = new Set();
    for (const m of (h.moments || [])) {
      const on = m && m.on;
      if (on == null || on === "discretionary") continue;
      if (seen.has(on)) errors.push(`harness "${hid}" has duplicate moment "${on}"`);
      seen.add(on);
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
// Run main() only when invoked directly as the CLI. Guard process.argv[1]: it is undefined when
// this module is imported from an argv-less context (e.g. `node -e`, or the engine's dynamic
// import in manifest-api.ts), and pathToFileURL(undefined) throws, which previously surfaced as
// a swallowed "engine error" 500 on the Studio's Save (PUT /api/manifest).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
