#!/usr/bin/env python3
"""Python mirror of shared/resolver.js, pure, no I/O. Keep in lockstep with the
JS version (both proven against shared/resolver-fixtures.json). Returns dicts with
the SAME keys as the JS object ({"intent":..., "value":...}) so fixtures match."""
import random


def intent_for_moment(manifest, harness_id, moment_key):
    h = (manifest.get("harnesses") or {}).get(harness_id)
    if not h:
        return None
    for m in h.get("moments", []):
        if m.get("on") == moment_key:
            return m.get("intent")
    return None


def effective_bindings(manifest, renderer_id, _seen=None):
    if _seen is None:
        _seen = set()
    r = (manifest.get("renderers") or {}).get(renderer_id)
    if not r or renderer_id in _seen:
        return {}
    _seen.add(renderer_id)
    inherited = effective_bindings(manifest, r["inherits"], _seen) if r.get("inherits") else {}
    out = dict(inherited)
    out.update(r.get("bindings") or {})
    return out


def resolve_bound_intent(manifest, renderer_id, intent):
    bindings = effective_bindings(manifest, renderer_id)
    seen = set()
    cur = intent
    while cur is not None and cur not in seen:
        seen.add(cur)
        if cur in bindings:
            return cur
        d = (manifest.get("intents") or {}).get(cur)
        cur = d["fallback"] if d and d.get("fallback") is not None else None
    return None


def pick_weighted(weights, rng=random.random, exclude=None):
    names = list(weights.keys())
    if not names:
        return None
    if exclude is not None and len(names) > 1:
        filtered = [n for n in names if n != exclude]
        if filtered:
            names = filtered
    def _w(v):
        if isinstance(v, (int, float)):
            return v
        if isinstance(v, dict) and isinstance(v.get("weight"), (int, float)):
            return v["weight"]
        return 1
    entries = [(n, max(0, _w(weights[n]))) for n in names]
    entries = [(n, w) for n, w in entries if w > 0]
    if not entries:
        entries = [(n, 1) for n in names]
    total = sum(w for _, w in entries)
    r = rng() * total
    for n, w in entries:
        r -= w
        if r < 0:
            return n
    return entries[-1][0]


def resolve(manifest, opts, ctx=None):
    if ctx is None:
        ctx = {}
    if not manifest or not opts:  # lenient at runtime: degrade, never throw
        return None
    rng = ctx.get("rng") or random.random
    intent = opts.get("intent")
    if intent is None:
        intent = intent_for_moment(manifest, opts.get("harness"), opts.get("moment"))
    if not intent:
        return None
    bound = resolve_bound_intent(manifest, opts["renderer"], intent)
    if not bound:
        return None
    binding = effective_bindings(manifest, opts["renderer"]).get(bound)
    if isinstance(binding, dict) and binding.get("pool"):
        key = f'{opts["renderer"]}:{bound}'
        last = ctx.get("last") or {}
        exclude = last.get(key) if binding.get("noRepeat") else None
        picked = pick_weighted(binding["pool"], rng, exclude)
        if ctx.get("last") is not None and picked is not None:
            ctx["last"][key] = picked
        out = {"intent": bound, "value": picked}
        entry = binding["pool"].get(picked) if picked is not None else None
        if isinstance(entry, dict):
            if entry.get("params") is not None:
                out["params"] = entry["params"]
            if entry.get("label") is not None:
                out["label"] = entry["label"]
        if binding.get("brightness") is not None:
            out["brightness"] = binding["brightness"]
        return out
    return {"intent": bound, "value": binding}
