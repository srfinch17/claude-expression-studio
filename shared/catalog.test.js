import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestRoles, classifyExpression, buildCatalog } from "./catalog.js";

// A compact manifest exercising every role source.
const MANIFEST = {
  intents: {
    info: { root: true }, working: { root: true }, done: { root: true },
    attention: { root: true }, fail: { root: true }, idle: { root: true },
    "awaiting-input": { fallback: "attention" }, celebrate: { fallback: "done" },
    fatal: { fallback: "error" }, error: { fallback: "fail" },
  },
  renderers: {
    "esp32-8x8": { bindings: {
      info: "smiley",
      working: { pool: { working: 10, "wait-claude": 40 } },
      done: "done",
      attention: "ask-attention",
      "awaiting-input": "ask-question",
      fail: "cross",
      idle: { pool: { fire: 1, snow: 1 } },
      celebrate: { pool: { party: 1, confetti: 1 } },
      fatal: "skull",
    } },
  },
};

const roles = manifestRoles(MANIFEST);

test("manifestRoles maps pool + single bindings to rotation roles", () => {
  assert.equal(roles.get("wait-claude"), "wait");   // working pool
  assert.equal(roles.get("ask-question"), "ask");    // awaiting-input
  assert.equal(roles.get("ask-attention"), "ask");   // attention
  assert.equal(roles.get("confetti"), "wired");      // celebrate (other intent)
  assert.equal(roles.get("skull"), "wired");         // fatal (other intent)
  assert.equal(roles.get("done"), "wired");          // done (other intent)
  assert.equal(roles.get("fire"), "bored");          // idle pool -> bored role
});

test("classifyExpression: manifest role wins, then bored dir, then canned, else orphan", () => {
  const ctx = {
    roles,
    boredNames: new Set(["pacman", "dizzy"]),
    cannedNames: new Set(["smiley", "done", "cross", "party", "sparkle", "working"]),
  };
  assert.equal(classifyExpression("wait-claude", ctx), "wait");
  assert.equal(classifyExpression("ask-question", ctx), "ask");
  assert.equal(classifyExpression("skull", ctx), "wired");
  assert.equal(classifyExpression("pacman", ctx), "bored");     // host watcher dir
  assert.equal(classifyExpression("sparkle", ctx), "canned");   // canned, unbound
  assert.equal(classifyExpression("goldfish", ctx), "orphan");  // saved, unbound
});

test("buildCatalog buckets names into the six roles", () => {
  const ctx = { roles, boredNames: new Set(["pacman"]), cannedNames: new Set(["sparkle"]) };
  const cat = buildCatalog(["wait-claude", "ask-question", "skull", "pacman", "sparkle", "goldfish"], ctx);
  assert.deepEqual(cat.wait, ["wait-claude"]);
  assert.deepEqual(cat.ask, ["ask-question"]);
  assert.deepEqual(cat.wired, ["skull"]);
  assert.deepEqual(cat.bored, ["pacman"]);
  assert.deepEqual(cat.canned, ["sparkle"]);
  assert.deepEqual(cat.orphan, ["goldfish"]);
});
