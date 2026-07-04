// shared/coverage.js
// Pure "how often does each animation actually get shown?" analysis over the Trigger
// Manifest. No I/O, no DOM. Answers the question a big library raises: most animations
// never appear, because only a handful of lifecycle MOMENTS fire, and everything bound
// only to intents no moment triggers is effectively invisible.
//
// Model: every harness moment carries a realistic relative FREQUENCY. A moment routes
// that frequency to the pool at its fallback-resolved intent (via the shared resolver, so
// this matches runtime exactly). An animation's APPEARANCE score is the sum, over every
// firing pool it sits in, of moment-traffic * its weight-share of that pool. Animations in
// no firing pool score zero ("never shown on its own"). This is an estimate of ambient,
// automatic appearance; any animation can still be fired on demand via the tools.
//
// Approximation note: noRepeat pools are slightly more even than raw weight-share (the last
// pick is excluded), so weight-share marginally over-weights the heaviest member of a
// noRepeat pool. Negligible for the near-uniform pools that use noRepeat here.

import { resolveBoundIntent, effectiveBindings } from "./resolver.js";

// Relative moment frequencies for a typical active session. Tunable via opts.frequency.
// Hook moments are keyed by their `on`. "discretionary" fires when Claude chooses, so it is
// keyed by intent (one `on` maps to several intents with very different real cadence).
export const DEFAULT_MOMENT_FREQUENCY = {
  "hook:UserPromptSubmit": 100,        // every prompt
  "hook:Stop": 100,                    // every turn end
  "hook:PostToolUse:AskUserQuestion": 5,
  "hook:PostToolUse:ExitPlanMode": 5,
  "hook:PreToolUse:AskUserQuestion": 8,
  "hook:PreToolUse:ExitPlanMode": 4,
  "hook:Notification:permission_prompt": 10,
  "hook:SubagentStop": 6,
  "hook:PreCompact": 2,
  "hook:SessionStart": 3,
  "hook:SessionEnd": 3,
  discretionary: { screensaver: 35, celebrate: 4, fatal: 1, _default: 3 },
  _default: 3,
};

// Share thresholds (fraction of all board-time) that bucket an animation into a tier.
export const TIER_THRESHOLDS = { frequent: 0.07, occasional: 0.01 }; // rare = >0; never = 0

function weightOf(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && typeof v.weight === "number") return v.weight;
  return 1;
}

// A binding -> [{name, weight}]. string = single (weight 1); {pool} = its members; else [].
function poolEntries(binding) {
  if (binding == null) return [];
  if (typeof binding === "string") return [{ name: binding, weight: 1 }];
  if (binding && typeof binding === "object" && binding.pool) {
    return Object.entries(binding.pool).map(([name, v]) => ({ name, weight: weightOf(v) }));
  }
  return [];
}

function frequencyOf(moment, table) {
  const byOn = table[moment.on];
  if (typeof byOn === "number") return byOn;
  if (byOn && typeof byOn === "object") {
    return byOn[moment.intent] != null ? byOn[moment.intent]
      : (byOn._default != null ? byOn._default : (table._default != null ? table._default : 1));
  }
  return table._default != null ? table._default : 1;
}

function tierFor(share) {
  if (share <= 0) return "never";
  if (share >= TIER_THRESHOLDS.frequent) return "frequent";
  if (share >= TIER_THRESHOLDS.occasional) return "occasional";
  return "rare";
}

/**
 * computeCoverage(manifest, opts)
 * opts: { harness?, renderer?='esp32-8x8', animationNames?=[all library names], frequency? }
 * Pass the FULL library via animationNames so orphans surface as "never".
 *
 * Returns:
 *   perAnim: { [name]: { name, appearance, share, reachPct, tier, bound, boundIntents:[],
 *                         firingIntents:[] } }
 *   summary: { total, reachable, never, orphans, diversityPct, tiers:{frequent,occasional,rare,never},
 *              deadIntents:[], hogs:[{name,share}], topShare, totalTraffic }
 *   traffic: { [boundIntent]: frequency }   // how much each firing pool receives
 */
export function computeCoverage(manifest, opts = {}) {
  const renderer = opts.renderer || "esp32-8x8";
  const harness = opts.harness || Object.keys((manifest && manifest.harnesses) || {})[0];
  const table = opts.frequency || DEFAULT_MOMENT_FREQUENCY;
  const bindings = effectiveBindings(manifest || {}, renderer);
  const moments = (manifest && manifest.harnesses && manifest.harnesses[harness] && manifest.harnesses[harness].moments) || [];

  // 1. Route each moment's frequency to its fallback-resolved (actually-firing) intent.
  const traffic = {};
  let totalTraffic = 0;
  for (const m of moments) {
    const bound = resolveBoundIntent(manifest, renderer, m.intent);
    if (!bound) continue;
    const f = frequencyOf(m, table);
    traffic[bound] = (traffic[bound] || 0) + f;
    totalTraffic += f;
  }

  // 2. Seed every library animation (so orphans/never surface), then accumulate appearance.
  const names = opts.animationNames && opts.animationNames.length
    ? opts.animationNames.slice()
    : uniqueBoundNames(bindings);
  const perAnim = {};
  const ensure = (n) => (perAnim[n] || (perAnim[n] = {
    name: n, appearance: 0, share: 0, reachPct: 0, tier: "never",
    bound: false, boundIntents: [], firingIntents: [],
  }));
  for (const n of names) ensure(n);

  // Record every binding membership (even dead intents) so boundIntents/orphan are exact.
  for (const [intent, binding] of Object.entries(bindings)) {
    const isFiring = traffic[intent] > 0;
    const entries = poolEntries(binding);
    const wTotal = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
    for (const { name, weight } of entries) {
      const a = ensure(name);
      a.bound = true;
      if (!a.boundIntents.includes(intent)) a.boundIntents.push(intent);
      if (isFiring) {
        if (!a.firingIntents.includes(intent)) a.firingIntents.push(intent);
        const share = wTotal > 0 ? Math.max(0, weight) / wTotal : 1 / entries.length; // all-zero -> uniform (mirrors pickWeighted)
        a.appearance += traffic[intent] * share;
      }
    }
  }

  // 3. Normalize to share of all board-time, assign tiers. Names in ambientNames that the
  // manifest never fires are reclassified "ambient": they still appear, just through a
  // non-manifest path (the idle/bored watcher), so they are not a coverage gap.
  const ambientSet = new Set(opts.ambientNames || []);
  let topShare = 0;
  for (const a of Object.values(perAnim)) {
    a.share = totalTraffic > 0 ? a.appearance / totalTraffic : 0;
    a.tier = tierFor(a.share);
    if (a.tier === "never" && ambientSet.has(a.name)) a.tier = "ambient";
    if (a.share > topShare) topShare = a.share;
  }
  for (const a of Object.values(perAnim)) {
    a.reachPct = Math.round(a.share * 1000) / 10;                 // absolute airtime %, 1 decimal
    a.relPct = topShare > 0 ? Math.round((a.share / topShare) * 100) : 0; // 0..100 vs the busiest
  }

  // 4. Summary. "reachable" = fires via the manifest; "ambient" = fires only via the idle
  // watcher; "never" = neither. diversityPct counts everything that appears automatically.
  const all = Object.values(perAnim);
  const tiers = { frequent: 0, occasional: 0, rare: 0, ambient: 0, never: 0 };
  for (const a of all) tiers[a.tier]++;
  const reachable = all.filter((a) => a.share > 0).length;
  const ambient = tiers.ambient;
  const orphans = all.filter((a) => !a.bound && !ambientSet.has(a.name)).map((a) => a.name).sort();
  const ambientNames = all.filter((a) => a.tier === "ambient").map((a) => a.name).sort();
  const deadIntents = Object.keys(bindings).filter((i) => !(traffic[i] > 0)).sort();
  const hogs = all.filter((a) => a.share > 0).sort((x, y) => y.share - x.share)
    .slice(0, 6).map((a) => ({ name: a.name, share: a.share, reachPct: a.reachPct }));

  return {
    perAnim,
    traffic,
    summary: {
      total: all.length,
      reachable,
      ambient,
      ambientNames,
      never: all.length - reachable - ambient,
      orphans,
      deadIntents,
      diversityPct: all.length ? Math.round(((reachable + ambient) / all.length) * 100) : 0,
      tiers,
      hogs,
      topShare,
      totalTraffic,
    },
  };
}

function uniqueBoundNames(bindings) {
  const set = new Set();
  for (const b of Object.values(bindings)) for (const { name } of poolEntries(b)) set.add(name);
  return [...set];
}
