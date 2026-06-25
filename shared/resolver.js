// shared/resolver.js
// Pure, data-driven resolution for the Expression Trigger Manifest.
// No I/O — the caller passes an already-parsed manifest object (cf. catalog.js).
// MIRRORED in claude-hooks/manifest_resolver.py; keep the two in lockstep
// (both are proven against shared/resolver-fixtures.json).

// moment key (e.g. "hook:Stop") -> the intent a harness maps it to, or null.
export function intentForMoment(manifest, harnessId, momentKey) {
  const h = manifest.harnesses && manifest.harnesses[harnessId];
  if (!h) return null;
  for (const m of h.moments || []) if (m.on === momentKey) return m.intent;
  return null;
}

// A renderer's effective bindings: inherited bindings merged UNDER its own.
// `inherits` may chain; cycles are guarded by _seen.
export function effectiveBindings(manifest, rendererId, _seen = new Set()) {
  const r = manifest.renderers && manifest.renderers[rendererId];
  if (!r || _seen.has(rendererId)) return {};
  _seen.add(rendererId);
  const inherited = r.inherits ? effectiveBindings(manifest, r.inherits, _seen) : {};
  return { ...inherited, ...(r.bindings || {}) };
}

// Walk the fallback chain from `intent` toward its root; return the first intent
// that has a binding on this renderer, or null. (A conformant manifest always
// binds the roots, so null only happens for malformed/partial manifests.)
export function resolveBoundIntent(manifest, rendererId, intent) {
  const bindings = effectiveBindings(manifest, rendererId);
  const seen = new Set();
  let cur = intent;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (Object.prototype.hasOwnProperty.call(bindings, cur)) return cur;
    const def = manifest.intents && manifest.intents[cur];
    cur = def && def.fallback != null ? def.fallback : null;
  }
  return null;
}

// Weighted random pick. weights: { name: number>=0 }. rng() in [0,1).
// `exclude`: a name to avoid when alternatives exist (noRepeat). Mirrors wait.ts.
export function pickWeighted(weights, rng = Math.random, exclude = null) {
  let names = Object.keys(weights);
  if (names.length === 0) return null;
  if (exclude != null && names.length > 1) {
    const filtered = names.filter((n) => n !== exclude);
    if (filtered.length) names = filtered;
  }
  let entries = names
    .map((n) => [n, Math.max(0, typeof weights[n] === "number" ? weights[n] : 1)])
    .filter(([, w]) => w > 0);
  if (entries.length === 0) entries = names.map((n) => [n, 1]); // all zero -> uniform
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [n, w] of entries) { r -= w; if (r < 0) return n; }
  return entries[entries.length - 1][0]; // float-rounding safety
}

// Top-level resolve. opts: { harness, renderer, moment?, intent? }.
// ctx: { rng?, last? } — `last` is a mutable map keyed `${renderer}:${bound}`
// (the fallback-RESOLVED intent, not the raw input intent) giving noRepeat its
// memory. Returns { intent, value } or null (degrade to nothing).
export function resolve(manifest, opts, ctx = {}) {
  if (!manifest || !opts) return null; // lenient at runtime: degrade, never throw
  const rng = ctx.rng || Math.random;
  const intent = opts.intent != null
    ? opts.intent
    : intentForMoment(manifest, opts.harness, opts.moment);
  if (!intent) return null;
  const bound = resolveBoundIntent(manifest, opts.renderer, intent);
  if (!bound) return null;
  const binding = effectiveBindings(manifest, opts.renderer)[bound];
  if (binding && typeof binding === "object" && binding.pool) {
    const key = `${opts.renderer}:${bound}`;
    const exclude = binding.noRepeat && ctx.last ? (ctx.last[key] ?? null) : null;
    const picked = pickWeighted(binding.pool, rng, exclude);
    if (ctx.last && picked != null) ctx.last[key] = picked;
    return { intent: bound, value: picked };
  }
  return { intent: bound, value: binding };
}
