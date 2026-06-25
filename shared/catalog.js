// Maps an expression name to the Studio rotation role it plays, derived from the
// Trigger Manifest's bindings (the single source of truth). "bored" is the one role
// still taken from directory membership: the host-side bored-watcher lineup
// (claude-hooks/bored_animations/ played by matrix_idle.py) is an orthogonal system,
// distinct from the manifest's `idle` binding (firmware screensaver apps).
import { effectiveBindings } from "./resolver.js";

// Which manifest intent a name binds to maps to a coarse rotation role.
const INTENT_ROLE = { working: "wait", "awaiting-input": "ask", attention: "ask", idle: "bored" };
// Priority when a name is referenced by multiple intents (lower wins).
const RANK = { wait: 0, ask: 1, bored: 2, wired: 3 };

// The animation names a binding references: a single value or every pool key.
// (Object bindings like the card's {glyph,text,color} reference no animation name.)
function bindingNames(binding) {
  if (binding == null) return [];
  if (typeof binding === "string") return [binding];
  if (typeof binding === "object" && binding.pool) return Object.keys(binding.pool);
  return [];
}

// name -> role, built from a renderer's effective (inheritance-merged) bindings.
export function manifestRoles(manifest, rendererId = "esp32-8x8") {
  const roles = new Map();
  const bindings = effectiveBindings(manifest, rendererId);
  for (const [intent, binding] of Object.entries(bindings)) {
    const role = INTENT_ROLE[intent] || "wired";
    for (const name of bindingNames(binding)) {
      const cur = roles.get(name);
      if (!cur || RANK[role] < RANK[cur]) roles.set(name, role);
    }
  }
  return roles;
}

// ctx: { roles: Map (from manifestRoles), boredNames: Set, cannedNames: Set }.
export function classifyExpression(name, ctx) {
  const role = ctx.roles && ctx.roles.get(name);
  if (role) return role;
  if (ctx.boredNames && ctx.boredNames.has(name)) return "bored";
  if (ctx.cannedNames && ctx.cannedNames.has(name)) return "canned";
  return "orphan";
}

export function buildCatalog(names, ctx) {
  const cat = { wait: [], ask: [], bored: [], wired: [], canned: [], orphan: [] };
  for (const name of names) cat[classifyExpression(name, ctx)].push(name);
  return cat;
}
