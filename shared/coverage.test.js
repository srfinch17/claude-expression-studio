import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCoverage } from "./coverage.js";

// Small manifest exercising every path: a high-frequency pool with unequal weights, a
// single-string binding, a fallback (thinking -> working), a DEAD intent (delight: bound
// but no moment routes to it), a discretionary moment, and an orphan library name.
const M = {
  intents: {
    working: { root: true, fallback: null },
    done: { root: true, fallback: null },
    idle: { root: true, fallback: null },
    thinking: { fallback: "working" },
    delight: { fallback: "done" },
  },
  harnesses: {
    h: { moments: [
      { on: "hook:UserPromptSubmit", intent: "working" }, // 100
      { on: "hook:Stop", intent: "done" },                // 100
      { on: "hook:PreCompact", intent: "thinking" },      // 2, thinking unbound -> falls back to working
      { on: "discretionary", intent: "idle" },            // discretionary default = 3
    ] },
  },
  renderers: {
    r: { bindings: {
      working: { pool: { spin: 3, pulse: 1 } },  // 75% / 25%
      done: "check",
      idle: { pool: { stars: 1 } },
      delight: { pool: { sparkle: 1 } },          // dead: no moment reaches delight
    } },
  },
};
const NAMES = ["spin", "pulse", "check", "stars", "sparkle", "orphanX"];
const cov = () => computeCoverage(M, { harness: "h", renderer: "r", animationNames: NAMES });

test("fallback traffic lands on the bound ancestor", () => {
  // PreCompact->thinking is unbound, so its 2 flows to working (100 + 2).
  assert.equal(cov().traffic.working, 102);
  assert.equal(cov().traffic.done, 100);
  assert.equal(cov().traffic.idle, 3);
  assert.equal(cov().summary.totalTraffic, 205);
});

test("weight-share splits a pool's traffic", () => {
  const { perAnim } = cov();
  assert.ok(Math.abs(perAnim.spin.appearance - 76.5) < 1e-9);  // 102 * 3/4
  assert.ok(Math.abs(perAnim.pulse.appearance - 25.5) < 1e-9); // 102 * 1/4
  assert.ok(perAnim.spin.appearance > perAnim.pulse.appearance);
  assert.equal(perAnim.check.appearance, 100);                 // single binding gets all of done
});

test("tiers bucket by share of board-time", () => {
  const { perAnim } = cov();
  assert.equal(perAnim.check.tier, "frequent");   // 0.49
  assert.equal(perAnim.spin.tier, "frequent");    // 0.37
  assert.equal(perAnim.pulse.tier, "frequent");   // 0.124 (>= 0.07)
  assert.equal(perAnim.stars.tier, "occasional"); // 0.0146 (>= 0.01)
  assert.equal(perAnim.sparkle.tier, "never");    // dead intent -> 0
  assert.equal(perAnim.orphanX.tier, "never");    // unbound -> 0
});

test("orphan vs dead-intent are distinguished", () => {
  const { perAnim, summary } = cov();
  // sparkle is BOUND (to delight) but never fires; orphanX is bound to nothing.
  assert.equal(perAnim.sparkle.bound, true);
  assert.deepEqual(perAnim.sparkle.boundIntents, ["delight"]);
  assert.deepEqual(perAnim.sparkle.firingIntents, []);
  assert.equal(perAnim.orphanX.bound, false);
  assert.deepEqual(summary.orphans, ["orphanX"]);
  assert.deepEqual(summary.deadIntents, ["delight"]); // bound pool no moment reaches
});

test("summary diversity + tier counts", () => {
  const { summary } = cov();
  assert.equal(summary.total, 6);
  assert.equal(summary.reachable, 4);            // spin, pulse, check, stars
  assert.equal(summary.never, 2);                // sparkle, orphanX
  assert.equal(summary.diversityPct, 67);        // round(4/6*100)
  assert.equal(summary.tiers.frequent, 3);
  assert.equal(summary.tiers.occasional, 1);
  assert.equal(summary.tiers.never, 2);
  assert.equal(summary.hogs[0].name, "check");   // biggest airtime first
});

test("no moments -> nothing appears", () => {
  const empty = { ...M, harnesses: { h: { moments: [] } } };
  const { summary } = computeCoverage(empty, { harness: "h", renderer: "r", animationNames: NAMES });
  assert.equal(summary.reachable, 0);
  assert.equal(summary.diversityPct, 0);
  assert.equal(summary.totalTraffic, 0);
});

test("ambientNames reclassifies a manifest-orphan as reachable-via-watcher", () => {
  // orphanX fires through no manifest pool, but if it is an idle-watcher animation it still
  // appears, so it must count as "ambient", not "never", and drop out of the orphans list.
  const c = computeCoverage(M, { harness: "h", renderer: "r", animationNames: NAMES, ambientNames: ["orphanX"] });
  assert.equal(c.perAnim.orphanX.tier, "ambient");
  assert.equal(c.perAnim.sparkle.tier, "never");        // bound-to-dead-intent, NOT ambient
  assert.equal(c.summary.ambient, 1);
  assert.deepEqual(c.summary.ambientNames, ["orphanX"]);
  assert.deepEqual(c.summary.orphans, []);              // orphanX no longer counted a gap
  assert.equal(c.summary.never, 1);                     // just sparkle
  assert.equal(c.summary.diversityPct, 83);             // round((4 reachable + 1 ambient)/6)
});

test("frequency table is overridable", () => {
  // Flip done far above working; check should dominate even harder, spin drop in relative terms.
  const c = computeCoverage(M, { harness: "h", renderer: "r", animationNames: NAMES,
    frequency: { "hook:UserPromptSubmit": 1, "hook:Stop": 1000, "hook:PreCompact": 0, discretionary: { _default: 0 }, _default: 0 } });
  assert.ok(c.perAnim.check.share > 0.9);
  assert.equal(c.perAnim.stars.tier, "never"); // idle freq now 0
});
