import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOMENTS,
  detectPython,
  buildHookCommand,
  hooksBlock,
  mergeHooks,
  removeHooks,
  mcpRegistration,
  mergeMcp,
  removeMcp,
  launchCmdContents,
} from "./setup-lib.mjs";

const SCRIPT = "/home/u/.claude/hooks/matrix_signal.py";

// --- detectPython ---

test("detectPython returns the first candidate that resolves", () => {
  const exists = (c) => c === "python3";
  assert.equal(detectPython(["python", "python3"], exists), "python3");
});

test("detectPython prefers earlier candidates", () => {
  assert.equal(detectPython(["python", "python3"], () => true), "python");
});

test("detectPython throws when nothing resolves", () => {
  assert.throws(() => detectPython(["python", "python3"], () => false), /python/i);
});

// --- buildHookCommand / hooksBlock ---

test("buildHookCommand quotes the script path and appends the moment key", () => {
  assert.equal(
    buildHookCommand("python3", SCRIPT, "hook:Stop"),
    `python3 "${SCRIPT}" hook:Stop`
  );
});

test("MOMENTS covers exactly the six wired moments", () => {
  const keys = MOMENTS.map((m) => m.key);
  assert.deepEqual(keys.sort(), [
    "hook:Notification:permission_prompt",
    "hook:PostToolUse:AskUserQuestion",
    "hook:PostToolUse:ExitPlanMode",
    "hook:PreToolUse:AskUserQuestion",
    "hook:PreToolUse:ExitPlanMode",
    "hook:Stop",
    "hook:UserPromptSubmit",
  ].sort());
});

test("hooksBlock emits all events with substituted path + python", () => {
  const h = hooksBlock("python3", SCRIPT);
  // UserPromptSubmit: one ungated group
  assert.equal(h.UserPromptSubmit.length, 1);
  assert.equal(h.UserPromptSubmit[0].hooks[0].command, `python3 "${SCRIPT}" hook:UserPromptSubmit`);
  assert.equal(h.UserPromptSubmit[0].matcher, undefined);
  // PreToolUse: two matchers
  assert.deepEqual(h.PreToolUse.map((g) => g.matcher), ["AskUserQuestion", "ExitPlanMode"]);
  // PostToolUse: two matchers
  assert.deepEqual(h.PostToolUse.map((g) => g.matcher), ["AskUserQuestion", "ExitPlanMode"]);
  // Notification: permission_prompt
  assert.equal(h.Notification[0].matcher, "permission_prompt");
  // Stop: ungated
  assert.equal(h.Stop[0].hooks[0].command, `python3 "${SCRIPT}" hook:Stop`);
  assert.equal(h.Stop[0].matcher, undefined);
});

// --- mergeHooks / removeHooks ---

test("mergeHooks preserves an unrelated hook and adds ours", () => {
  const existing = {
    model: "opus",
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo unrelated" }] }],
    },
  };
  const out = mergeHooks(existing, hooksBlock("python3", SCRIPT));
  assert.equal(out.model, "opus"); // untouched
  // unrelated Stop group kept, ours appended
  const cmds = out.hooks.Stop.map((g) => g.hooks[0].command);
  assert.ok(cmds.includes("echo unrelated"));
  assert.ok(cmds.some((c) => c.includes("matrix_signal.py")));
  // a brand-new event we added
  assert.ok(out.hooks.UserPromptSubmit.some((g) => g.hooks[0].command.includes("matrix_signal.py")));
});

test("mergeHooks is idempotent (no duplicate matrix entries on re-run)", () => {
  const ours = hooksBlock("python3", SCRIPT);
  const once = mergeHooks({}, ours);
  const twice = mergeHooks(once, ours);
  for (const event of Object.keys(twice.hooks)) {
    const matrixGroups = twice.hooks[event].filter((g) =>
      g.hooks.some((hh) => hh.command.includes("matrix_signal.py"))
    );
    const onceGroups = once.hooks[event].filter((g) =>
      g.hooks.some((hh) => hh.command.includes("matrix_signal.py"))
    );
    assert.equal(matrixGroups.length, onceGroups.length, `event ${event} duplicated`);
  }
});

test("mergeHooks then removeHooks round-trips to the original unrelated content", () => {
  const original = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo unrelated" }] }],
      SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
    },
  };
  const merged = mergeHooks(original, hooksBlock("python3", SCRIPT));
  const restored = removeHooks(merged);
  assert.deepEqual(restored.hooks, original.hooks);
});

test("mergeHooks does not mutate its input", () => {
  const input = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo x" }] }] } };
  const snapshot = JSON.parse(JSON.stringify(input));
  mergeHooks(input, hooksBlock("python3", SCRIPT));
  assert.deepEqual(input, snapshot);
});

// --- mcpRegistration / mergeMcp / removeMcp ---

test("mcpRegistration on win32 uses the cmd.exe wrapper", () => {
  const reg = mcpRegistration({
    platform: "win32",
    mcpDir: "C:\\repo\\mcp_server",
    distIndexPath: "C:\\repo\\mcp_server\\dist\\index.js",
    nodePath: "C:\\node\\node.exe",
    launchCmdPath: "C:\\repo\\mcp_server\\mcp_launch.cmd",
    boardUrl: null,
  });
  assert.equal(reg.command, "cmd.exe");
  assert.deepEqual(reg.args, ["/c", "C:\\repo\\mcp_server\\mcp_launch.cmd"]);
  assert.equal(reg.env.MATRIX_MCP_DIR, "C:\\repo\\mcp_server");
  assert.equal(reg.env.ESP32_URL, undefined); // no board
  assert.equal(reg.type, "stdio");
});

test("mcpRegistration on posix launches node directly with dist/index.js", () => {
  const reg = mcpRegistration({
    platform: "linux",
    mcpDir: "/home/u/repo/mcp_server",
    distIndexPath: "/home/u/repo/mcp_server/dist/index.js",
    nodePath: "/usr/bin/node",
    launchCmdPath: "/home/u/repo/mcp_server/mcp_launch.cmd",
    boardUrl: "http://192.168.1.5",
  });
  assert.equal(reg.command, "/usr/bin/node");
  assert.deepEqual(reg.args, ["/home/u/repo/mcp_server/dist/index.js"]);
  assert.equal(reg.env.ESP32_URL, "http://192.168.1.5"); // board passed
});

test("mergeMcp preserves other servers and replaces a prior esp32-matrix", () => {
  const existing = {
    mcpServers: {
      playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
      "esp32-matrix": { command: "OLD" },
    },
  };
  const reg = mcpRegistration({ platform: "linux", mcpDir: "/r/mcp_server", distIndexPath: "/r/mcp_server/dist/index.js", nodePath: "/node", launchCmdPath: "/x", boardUrl: null });
  const out = mergeMcp(existing, reg);
  assert.ok(out.mcpServers.playwright); // preserved
  assert.equal(out.mcpServers["esp32-matrix"].command, "/node"); // replaced
  // idempotent
  const out2 = mergeMcp(out, reg);
  assert.deepEqual(out2.mcpServers["esp32-matrix"], out.mcpServers["esp32-matrix"]);
});

test("removeMcp drops only our server", () => {
  const existing = { mcpServers: { playwright: { command: "npx" }, "esp32-matrix": { command: "x" } } };
  const out = removeMcp(existing);
  assert.ok(out.mcpServers.playwright);
  assert.equal(out.mcpServers["esp32-matrix"], undefined);
});

// --- launchCmdContents ---

test("launchCmdContents embeds the node + dist path and disables echo", () => {
  const s = launchCmdContents("C:/node/node.exe", "C:/repo/mcp_server/dist/index.js");
  assert.match(s, /@echo off/);
  assert.ok(s.includes("C:/node/node.exe"));
  assert.ok(s.includes("C:/repo/mcp_server/dist/index.js"));
});
