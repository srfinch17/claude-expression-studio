import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_APPS, IDLE_BRIGHTNESS, pickIdleApp, type IdleApp } from "./idle.ts";

const KNOWN_TYPES = ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain"];

test("IDLE_APPS is non-empty and well-formed", () => {
  assert.ok(IDLE_APPS.length > 0);
  for (const a of IDLE_APPS) {
    assert.equal(typeof a.type, "string");
    assert.equal(typeof a.label, "string");
    assert.ok(a.params && typeof a.params === "object" && !Array.isArray(a.params));
    assert.ok(KNOWN_TYPES.includes(a.type), `unknown animation type: ${a.type}`);
  }
});

test("IDLE_BRIGHTNESS is the ambient baseline 5", () => {
  assert.equal(IDLE_BRIGHTNESS, 5);
});

test("pickIdleApp always returns a member of the list", () => {
  for (let i = 0; i < 50; i++) assert.ok(IDLE_APPS.includes(pickIdleApp(IDLE_APPS, null)));
});

test("pickIdleApp never repeats lastType across a run (>=2 apps)", () => {
  let last: string | null = null;
  for (let i = 0; i < 200; i++) {
    const app = pickIdleApp(IDLE_APPS, last);
    assert.notEqual(app.type, last);
    last = app.type;
  }
});

test("pickIdleApp avoids lastType even when rng would pick it", () => {
  // rng()=0 → index 0 of the pool. With lastType = IDLE_APPS[0].type, index 0
  // is filtered out, so the result must differ from it.
  const app = pickIdleApp(IDLE_APPS, IDLE_APPS[0].type, () => 0);
  assert.notEqual(app.type, IDLE_APPS[0].type);
});

test("pickIdleApp returns the sole app when length===1 (no repeat-avoidance lockup)", () => {
  const one: IdleApp[] = [{ type: "fire", label: "🔥", params: {} }];
  assert.equal(pickIdleApp(one, "fire").type, "fire");
});

test("pickIdleApp throws on an empty list", () => {
  assert.throws(() => pickIdleApp([], null), /empty/);
});
