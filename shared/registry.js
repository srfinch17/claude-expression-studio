// shared/registry.js — renderer registry + the fire() dispatcher over the resolver.
// fire() resolves the intent FOR EACH active renderer (bindings differ per renderer),
// then hands each renderer its own leaf binding value. It also owns the
// "pool entry names a missing animation -> skip & re-pick" fail-safe that the pure
// resolver cannot (the renderer/engine knows what exists; the resolver does not).
import { resolve, effectiveBindings, pickWeighted } from "./resolver.js";

export function createRegistry() {
  const map = new Map();
  return {
    register(r) { map.set(r.id, r); return r; },
    get(id) { return map.get(id); },
    all() { return [...map.values()]; },
    active() { return [...map.values()]; }, // v1: all registered renderers are active
  };
}

// Resolve for one renderer, honoring ctx.exists (optional) so a pooled binding whose
// pick names a non-existent animation is excluded and re-picked. Falls back to the
// plain resolver result when no exists() predicate is given.
function resolveExisting(manifest, rendererId, opts, ctx) {
  const base = resolve(manifest, { ...opts, renderer: rendererId }, ctx);
  if (!base || !ctx || typeof ctx.exists !== "function") return base;
  if (ctx.exists(base.value)) return base;
  // The pick named a missing animation. Re-pick from the same pool, excluding misses.
  const binding = effectiveBindings(manifest, rendererId)[base.intent];
  if (!binding || typeof binding !== "object" || !binding.pool) return base; // not a pool
  const remaining = Object.fromEntries(
    Object.entries(binding.pool).filter(([name]) => ctx.exists(name)));
  if (Object.keys(remaining).length === 0) return base; // all missing; caller no-ops
  const key = `${rendererId}:${base.intent}`;
  const exclude = binding.noRepeat && ctx.last ? (ctx.last[key] ?? null) : null;
  const value = pickWeighted(remaining, ctx.rng || Math.random, exclude);
  if (ctx.last && value != null) ctx.last[key] = value;
  const out = { intent: base.intent, value };
  const entry = value != null ? remaining[value] : null;
  if (entry && typeof entry === "object") {
    if (entry.params != null) out.params = entry.params;
    if (entry.label != null) out.label = entry.label;
  }
  if (binding.brightness != null) out.brightness = binding.brightness;
  return out;
}

export async function fire(manifest, opts, registry, ctx = {}) {
  const ids = opts.renderers || registry.active().map((r) => r.id);
  const out = [];
  for (const id of ids) {
    const renderer = registry.get(id);
    const res = renderer ? resolveExisting(manifest, id, opts, ctx) : null;
    if (renderer && res) {
      const { intent, value, ...meta } = res;     // meta = params?/label?/brightness?
      await renderer.render(value, meta);
      out.push({ renderer: id, ...res });
    }
    else out.push(null);
  }
  return out;
}
