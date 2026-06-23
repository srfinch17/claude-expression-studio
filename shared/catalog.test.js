import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExpression, buildCatalog } from "./catalog.js";

const ctx = {
  waitNames: new Set(["working", "claudesweep", "wait-claude", "wait-rainbow"]),
  boredNames: new Set(["bored-eyes", "bounce", "dizzy", "pacman", "shooting-star", "wink", "yawn"]),
};

test("classifyExpression routes by prefix then membership", () => {
  assert.equal(classifyExpression("ask-question", ctx), "ask");
  assert.equal(classifyExpression("wait-rainbow", ctx), "wait");
  assert.equal(classifyExpression("dizzy", ctx), "bored");
  assert.equal(classifyExpression("claude-idle", ctx), "orphan");
  assert.equal(classifyExpression("idea", ctx), "orphan");
});

test("buildCatalog groups names and isolates the two known orphans", () => {
  const names = [
    "ask-question", "wait-claude", "wait-rainbow", "dizzy", "pacman",
    "claude-idle", "idea",
  ];
  const cat = buildCatalog(names, ctx);
  assert.deepEqual(cat.orphan.sort(), ["claude-idle", "idea"]);
  assert.ok(cat.wait.includes("wait-claude"));
  assert.ok(cat.bored.includes("dizzy"));
  assert.ok(cat.ask.includes("ask-question"));
});
