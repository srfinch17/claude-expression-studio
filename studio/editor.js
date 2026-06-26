// studio/editor.js — PURE manifest binding-edit operations for the Studio Editor.
// No DOM, no I/O. Every mutation op returns a NEW manifest (deep JSON clone) and edits
// only renderers[rendererId].bindings — preserving all other fields (intents, harnesses,
// other renderers, untouched bindings, per-entry params/label) byte-for-byte. Default
// renderer is "esp32-8x8" (web-sim inherits it; the card renderer is out of scope).
import { effectiveBindings } from "../shared/resolver.js";
import { bindingNames } from "../shared/catalog.js";

// --- read helpers ---

// The renderer's own (editable) bindings object, or {}.
export function ownBindings(manifest, rendererId = "esp32-8x8") {
  const r = manifest && manifest.renderers && manifest.renderers[rendererId];
  return (r && r.bindings) || {};
}

export function isPool(binding) {
  return !!(binding && typeof binding === "object" && binding.pool);
}

// Weight of a pool entry value: number | {weight} | anything else -> 1.
export function entryWeight(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.weight === "number") return v.weight;
  return 1;
}

// Normalize a binding to [{name, weight}]. string -> single (weight 1); pool -> members; null -> [].
export function bindingEntries(binding) {
  if (binding == null) return [];
  if (typeof binding === "string") return [{ name: binding, weight: 1 }];
  if (isPool(binding)) return Object.entries(binding.pool).map(([name, v]) => ({ name, weight: entryWeight(v) }));
  return [];
}

// {name: percent-of-pool} by weight, rounded. single -> {name:100}; null -> {}.
export function poolPercentages(binding) {
  const entries = bindingEntries(binding);
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  const out = {};
  for (const e of entries) out[e.name] = total > 0 ? Math.round((Math.max(0, e.weight) / total) * 100) : 0;
  return out;
}

// Names in allNames referenced by NO effective binding of the renderer (= orphans).
export function computeOrphans(manifest, rendererId, allNames) {
  const bound = new Set();
  for (const b of Object.values(effectiveBindings(manifest, rendererId))) {
    for (const n of bindingNames(b)) bound.add(n);
  }
  return allNames.filter((n) => !bound.has(n));
}
