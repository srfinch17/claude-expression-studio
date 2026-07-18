import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./setup.mjs";

const REAL_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Stage a throwaway repo skeleton (real hook sources + a dummy built dist) and an empty
// HOME, so run() exercises real fs without touching the actual repo or ~/.claude.
function stage() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mx-setup-"));
  const repoDir = path.join(base, "repo");
  const homeDir = path.join(base, "home");
  fs.mkdirSync(homeDir, { recursive: true });
  fs.cpSync(path.join(REAL_REPO, "claude-hooks"), path.join(repoDir, "claude-hooks"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "mcp_server", "dist"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "mcp_server", "dist", "index.js"), "// dummy\n");
  return { base, repoDir, homeDir };
}

const baseOpts = (repoDir, homeDir, argv) => ({
  argv,
  homeDir,
  repoDir,
  platform: process.platform,
  nodePath: process.execPath,
  pythonCandidates: ["python", "python3"],
  exists: () => true,
  log: () => {},
  build: () => {}, // the staged repo has a dummy dist; the real build is not under test
});

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const settingsPath = (h) => path.join(h, ".claude", "settings.json");
const claudeJsonPath = (h) => path.join(h, ".claude.json");

test("--dry-run writes nothing but reports the merged config", async () => {
  const { base, repoDir, homeDir } = stage();
  try {
    const res = await run(baseOpts(repoDir, homeDir, ["--dry-run"]));
    assert.equal(res.dryRun, true);
    assert.ok(!fs.existsSync(settingsPath(homeDir)), "settings.json must not be written");
    assert.ok(!fs.existsSync(claudeJsonPath(homeDir)), ".claude.json must not be written");
    assert.ok(!fs.existsSync(path.join(homeDir, ".claude", "hooks", "matrix_signal.py")));
    // the planned merge is surfaced for inspection
    const blob = JSON.stringify(res.plannedSettings) + JSON.stringify(res.plannedClaudeJson);
    assert.ok(blob.includes("matrix_signal.py"));
    assert.ok(blob.includes("expression-studio"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("install deploys hooks + config + wires both global files", async () => {
  const { base, repoDir, homeDir } = stage();
  try {
    await run(baseOpts(repoDir, homeDir, []));
    const hooksDir = path.join(homeDir, ".claude", "hooks");
    assert.ok(fs.existsSync(path.join(hooksDir, "matrix_signal.py")));
    assert.ok(fs.existsSync(path.join(hooksDir, "matrix_idle.py")));
    assert.ok(fs.existsSync(path.join(hooksDir, "manifest_resolver.py")));
    assert.ok(fs.existsSync(path.join(hooksDir, "bored_animations")));
    // config points at the repo's mcp_server, no board by default
    const cfg = read(path.join(hooksDir, "matrix_config.json"));
    assert.equal(cfg.mcp_dir.replace(/\\/g, "/"), path.join(repoDir, "mcp_server").replace(/\\/g, "/"));
    assert.ok(!cfg.board_url);
    // hooks wired
    const settings = read(settingsPath(homeDir));
    assert.ok(JSON.stringify(settings.hooks).includes("matrix_signal.py"));
    // mcp wired
    const cj = read(claudeJsonPath(homeDir));
    assert.ok(cj.mcpServers["expression-studio"]);
    assert.equal(cj.mcpServers["expression-studio"].env.MATRIX_MCP_DIR.replace(/\\/g, "/"), path.join(repoDir, "mcp_server").replace(/\\/g, "/"));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("--board sets ESP32_URL in the mcp env and the config", async () => {
  const { base, repoDir, homeDir } = stage();
  try {
    await run(baseOpts(repoDir, homeDir, ["--board", "http://192.168.1.9"]));
    const cfg = read(path.join(homeDir, ".claude", "hooks", "matrix_config.json"));
    assert.equal(cfg.board_url, "http://192.168.1.9");
    const cj = read(claudeJsonPath(homeDir));
    assert.equal(cj.mcpServers["expression-studio"].env.ESP32_URL, "http://192.168.1.9");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("install backs up a pre-existing settings.json and preserves unrelated keys", async () => {
  const { base, repoDir, homeDir } = stage();
  try {
    fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    fs.writeFileSync(settingsPath(homeDir), JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] } }, null, 2));
    await run(baseOpts(repoDir, homeDir, []));
    // a backup exists
    const baks = fs.readdirSync(path.join(homeDir, ".claude")).filter((f) => f.startsWith("settings.json.bak-"));
    assert.equal(baks.length, 1);
    const settings = read(settingsPath(homeDir));
    assert.equal(settings.model, "opus"); // unrelated key preserved
    const cmds = settings.hooks.Stop.map((g) => g.hooks[0].command);
    assert.ok(cmds.includes("echo keep")); // unrelated hook preserved
    assert.ok(cmds.some((c) => c.includes("matrix_signal.py"))); // ours added
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("--uninstall removes our entries + deployed scripts, keeps unrelated", async () => {
  const { base, repoDir, homeDir } = stage();
  try {
    fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    fs.writeFileSync(settingsPath(homeDir), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] } }));
    await run(baseOpts(repoDir, homeDir, []));
    await run(baseOpts(repoDir, homeDir, ["--uninstall"]));
    const settings = read(settingsPath(homeDir));
    assert.ok(!JSON.stringify(settings.hooks || {}).includes("matrix_signal.py"));
    assert.ok(JSON.stringify(settings.hooks.Stop).includes("echo keep")); // unrelated kept
    const cj = read(claudeJsonPath(homeDir));
    assert.ok(!cj.mcpServers || !cj.mcpServers["expression-studio"]);
    assert.ok(!fs.existsSync(path.join(homeDir, ".claude", "hooks", "matrix_signal.py")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("a malformed existing settings.json aborts without overwriting", async () => {
  const { base, repoDir, homeDir } = stage();
  try {
    fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
    const bad = "{ this is not json";
    fs.writeFileSync(settingsPath(homeDir), bad);
    await assert.rejects(() => run(baseOpts(repoDir, homeDir, [])), /parse|json/i);
    assert.equal(fs.readFileSync(settingsPath(homeDir), "utf8"), bad); // untouched
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
