// Wait-animation library — the pool Claude draws from when it shows "I'm busy".
//
// matrix_express("wait") plays a RANDOM one of these (no immediate repeat); a
// specific one is still playable by its own name (e.g. matrix_express("wait-rainbow")
// or "working" for the default snake spinner).
//
// THE POOL IS CONVENTION-BASED, so adding a wait animation is painless:
//   - a canned built-in below (rebuild), OR
//   - ANY saved expression named "wait-..." — created live via
//     matrix_animate({ save_as: "wait-foo", ... }). It auto-joins the pool with
//     ZERO code change, zero rebuild, zero reconnect.
//
// Mirrors idle.ts (IDLE_APPS + pickIdleApp): a list + a pure, rng-injectable picker.

// Canned expressions (in expressions.ts CANNED) that count as wait animations.
// "working" = the original snake spinner = the "Default" wait.
export const WAIT_BUILTINS: string[] = ["working"];

// Saved expressions whose name starts with this prefix auto-join the wait pool.
export const WAIT_PREFIX = "wait-";

// Build the full pool from the built-ins plus any saved expression names that match
// the wait- convention. De-duped, preserving built-ins first.
export function buildWaitPool(savedNames: string[]): string[] {
  const matched = savedNames.filter((n) => n.startsWith(WAIT_PREFIX));
  return [...new Set([...WAIT_BUILTINS, ...matched])];
}

// Relative likelihoods for the wait pool: variant name -> weight (>= 0). Higher =
// more likely. Unlisted variants default to 1; a weight of 0 disables a variant.
// e.g. { "wait-rainbow": 4, "working": 1 } makes the wheel show 4/(4+1) = 80%.
// Stored in mcp_server/wait-weights.json (read at runtime — no rebuild to retune).
export type WaitWeights = Record<string, number>;

// Pick a wait animation by WEIGHTED random — each call is independent so the weights
// are honored exactly (a variant at 80% genuinely shows ~80% of the time, repeats
// and all; that's the point of a preference, so there is intentionally NO
// no-immediate-repeat rule here — that would override the weighting). weights is
// optional (empty = uniform); rng is injectable so tests are deterministic. Falls
// back to the first built-in if the pool is empty, and to uniform if weights zero
// out every candidate.
export function pickWait(
  pool: string[],
  weights: WaitWeights = {},
  rng: () => number = Math.random,
): string {
  if (pool.length === 0) return WAIT_BUILTINS[0];

  // weight = weights[name] ?? 1 (clamped >= 0); drop zero-weight candidates.
  let entries = pool
    .map((name) => ({ name, w: Math.max(0, weights[name] ?? 1) }))
    .filter((e) => e.w > 0);
  if (entries.length === 0) entries = pool.map((name) => ({ name, w: 1 })); // all zeroed → uniform

  const total = entries.reduce((s, e) => s + e.w, 0);
  let r = rng() * total;
  for (const e of entries) {
    r -= e.w;
    if (r < 0) return e.name;
  }
  return entries[entries.length - 1].name; // float-rounding safety
}
