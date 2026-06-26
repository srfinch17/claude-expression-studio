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

// --- mutation ops (each returns a new manifest; never mutates input) ---

const clone = (m) => JSON.parse(JSON.stringify(m));

// clone the manifest, ensure renderers[rid].bindings exists, run fn on it, return the clone.
function withBindings(manifest, rendererId, fn) {
  const m = clone(manifest);
  m.renderers = m.renderers || {};
  m.renderers[rendererId] = m.renderers[rendererId] || {};
  m.renderers[rendererId].bindings = m.renderers[rendererId].bindings || {};
  fn(m.renderers[rendererId].bindings);
  return m;
}

export function assign(manifest, rendererId = "esp32-8x8", intent, name, weight = 1) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (cur == null) { b[intent] = name; return; }
    if (typeof cur === "string") { if (cur !== name) b[intent] = { pool: { [cur]: 1, [name]: weight } }; return; }
    if (isPool(cur)) cur.pool[name] = weight;
  });
}

export function remove(manifest, rendererId = "esp32-8x8", intent, name) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (typeof cur === "string") { if (cur === name) delete b[intent]; return; }
    if (isPool(cur)) {
      delete cur.pool[name];
      if (Object.keys(cur.pool).length === 0) delete b[intent];
    }
  });
}

export function reweight(manifest, rendererId = "esp32-8x8", intent, name, weight) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur) || !(name in cur.pool)) return;
    const v = cur.pool[name];
    if (v && typeof v === "object") v.weight = weight; // keep params/label
    else cur.pool[name] = weight;
  });
}

export function move(manifest, rendererId = "esp32-8x8", fromIntent, toIntent, name) {
  return withBindings(manifest, rendererId, (b) => {
    if (fromIntent === toIntent) return;
    const src = b[fromIntent];
    let val = 1;
    if (typeof src === "string" && src === name) { delete b[fromIntent]; }
    else if (isPool(src) && name in src.pool) {
      val = src.pool[name];
      delete src.pool[name];
      if (Object.keys(src.pool).length === 0) delete b[fromIntent];
    } else return; // name not in source -> no-op
    const dst = b[toIntent];
    if (dst == null) b[toIntent] = { pool: { [name]: val } };
    else if (typeof dst === "string") b[toIntent] = { pool: { [dst]: 1, [name]: val } };
    else if (isPool(dst)) dst.pool[name] = val;
  });
}

export function singleToPool(manifest, rendererId = "esp32-8x8", intent) {
  return withBindings(manifest, rendererId, (b) => {
    if (typeof b[intent] === "string") b[intent] = { pool: { [b[intent]]: 1 } };
  });
}

export function poolToSingle(manifest, rendererId = "esp32-8x8", intent) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (isPool(cur)) {
      const names = Object.keys(cur.pool);
      if (names.length === 1) b[intent] = names[0];
    }
  });
}

export function setPoolOption(manifest, rendererId = "esp32-8x8", intent, key, value) {
  return withBindings(manifest, rendererId, (b) => {
    const cur = b[intent];
    if (!isPool(cur)) return;
    if (value == null || value === false) delete cur[key];
    else cur[key] = value;
  });
}
