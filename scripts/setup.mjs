// scripts/setup.mjs, `npm run setup`: turnkey Claude Code onboarding for the LED-matrix
// companion. Wires the hooks (~/.claude/settings.json) + the MCP server (~/.claude.json)
// into the user's GLOBAL config, deploys the hook scripts to ~/.claude/hooks/, and points
// them at this repo via ~/.claude/hooks/matrix_config.json. No board required (panel-first).
//
// All risky logic lives in setup-lib.mjs (pure, unit-tested). run() here does the IO and is
// fully injectable (homeDir/repoDir/platform/nodePath) so setup.test.js drives it against a
// temp HOME + a staged repo, never touching the real ~/.claude.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  detectPython,
  pythonCandidatesFor,
  hooksBlock,
  mergeHooks,
  removeHooks,
  mcpRegistration,
  mergeMcp,
  removeMcp,
  launchCmdContents,
} from "./setup-lib.mjs";

const HOOK_ASSETS = ["matrix_signal.py", "matrix_idle.py", "manifest_resolver.py", "bored_animations"];

function parseArgs(argv) {
  const a = { board: null, uninstall: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--uninstall") a.uninstall = true;
    else if (t === "--dry-run" || t === "--print") a.dryRun = true;
    else if (t === "--help" || t === "-h") a.help = true;
    else if (t === "--board") a.board = argv[++i] || null;
    else if (t.startsWith("--board=")) a.board = t.slice("--board=".length);
  }
  return a;
}

// Read JSON, or {} when absent. A file that exists but does not parse is fatal: we must never
// back-up-and-overwrite a config we couldn't read, or we'd risk shredding the user's settings.
function readJsonOrEmpty(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, "utf8");
  if (raw.trim() === "") return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Refusing to touch ${file}: it exists but does not parse as JSON (${e.message}). Fix or move it, then re-run.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Refusing to touch ${file}: it parsed as JSON but is not an object. Fix or move it, then re-run.`);
  }
  return parsed;
}

function backupAndWrite(file, obj, backups, log) {
  if (fs.existsSync(file)) {
    const bak = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, bak);
    backups.push(bak);
    log(`  backed up ${path.basename(file)} -> ${path.basename(bak)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

export async function run(opts) {
  const {
    argv = [],
    homeDir = os.homedir(),
    repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    platform = process.platform,
    nodePath = process.execPath,
    exists,
    log = console.log,
  } = opts;
  const pythonCandidates = opts.pythonCandidates || pythonCandidatesFor(platform);

  const args = parseArgs(argv);
  if (args.help) {
    log("Usage: npm run setup [-- --board <url>] [--dry-run] [--uninstall]");
    return { help: true };
  }

  const claudeDir = path.join(homeDir, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsPath = path.join(claudeDir, "settings.json");
  const claudeJsonPath = path.join(homeDir, ".claude.json");
  const mcpServerDir = path.join(repoDir, "mcp_server");
  const distIndex = path.join(mcpServerDir, "dist", "index.js");
  const launchCmdPath = path.join(mcpServerDir, "mcp_launch.cmd");
  const signalScript = path.join(hooksDir, "matrix_signal.py");
  const configPath = path.join(hooksDir, "matrix_config.json");

  if (args.uninstall) {
    const backups = [];
    const settings = removeHooks(readJsonOrEmpty(settingsPath));
    const cj = removeMcp(readJsonOrEmpty(claudeJsonPath));
    if (fs.existsSync(settingsPath)) backupAndWrite(settingsPath, settings, backups, log);
    if (fs.existsSync(claudeJsonPath)) backupAndWrite(claudeJsonPath, cj, backups, log);
    const removed = [];
    for (const asset of [...HOOK_ASSETS, "matrix_config.json"]) {
      const p = path.join(hooksDir, asset);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(asset);
      }
    }
    log(`\nUninstalled. Removed hooks + MCP entry and deleted: ${removed.join(", ") || "(nothing)"}.`);
    log("Restart Claude Code for the change to take effect.");
    return { uninstalled: true, backups, removed };
  }

  // --- plan the merged config (shared by dry-run and real install) ---
  const python = detectPython(pythonCandidates, exists || ((c) => commandExists(c)));
  const ourHooks = hooksBlock(python, signalScript);
  const plannedSettings = mergeHooks(readJsonOrEmpty(settingsPath), ourHooks);
  const registration = mcpRegistration({ platform, mcpDir: mcpServerDir, distIndexPath: distIndex, nodePath, launchCmdPath, boardUrl: args.board });
  const plannedClaudeJson = mergeMcp(readJsonOrEmpty(claudeJsonPath), registration);
  const config = { mcp_dir: mcpServerDir, board_url: args.board || null };

  if (args.dryRun) {
    log("DRY RUN, nothing written.\n");
    log(`python: ${python}`);
    log(`would deploy to: ${hooksDir}`);
    log(`would write ${settingsPath}:\n` + JSON.stringify(plannedSettings, null, 2));
    log(`would write ${claudeJsonPath}:\n` + JSON.stringify(plannedClaudeJson, null, 2));
    log(`would write ${configPath}:\n` + JSON.stringify(config, null, 2));
    return { dryRun: true, python, plannedSettings, plannedClaudeJson, config };
  }

  // --- real install ---
  // 1. ensure the compiled MCP server exists (the engine that serves the panel + Studio).
  if (!fs.existsSync(distIndex)) {
    log("Building the MCP server (dist/index.js missing)…");
    try {
      execFileSync(nodePath, [path.join(repoDir, "scripts", "copy-shared-runtime.mjs")], { cwd: repoDir, stdio: "inherit" });
      execFileSync("npx", ["tsc", "--project", "tsconfig.json"], { cwd: mcpServerDir, stdio: "inherit", shell: platform === "win32" });
    } catch (e) {
      throw new Error(`MCP server build failed (${e.message}). Run \`npm run build:mcpb\` manually, then re-run setup.`);
    }
  }

  // 2. deploy hook assets + config.
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const asset of HOOK_ASSETS) {
    fs.cpSync(path.join(repoDir, "claude-hooks", asset), path.join(hooksDir, asset), { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

  // 3. windows: regenerate the launcher with this machine's node + this repo's dist.
  if (platform === "win32") {
    fs.writeFileSync(launchCmdPath, launchCmdContents(nodePath, distIndex));
  }

  // 4. back up + write the two global config files.
  const backups = [];
  log("Wiring config…");
  backupAndWrite(settingsPath, plannedSettings, backups, log);
  backupAndWrite(claudeJsonPath, plannedClaudeJson, backups, log);

  log("\n✅ Installed.");
  log(`  hooks deployed to ${hooksDir}`);
  log(`  python: ${python}`);
  log(`  board: ${args.board || "(none, using the no-board web panel)"}`);
  if (backups.length) log(`  backups: ${backups.map((b) => path.basename(b)).join(", ")}`);
  log("\nNext:");
  log("  1. Restart Claude Code (hooks + MCP servers load at session start).");
  log("  2. The MCP `matrix_studio` tool prints the local Studio/panel URL, open it to");
  log("     watch the companion and assign which animation fires on which hook.");
  log("  3. Silence everything anytime: `touch ~/.claude/hooks/.matrix_off` (delete to re-enable).");
  if (!args.board) log("  4. Have a board? Re-run with `npm run setup -- --board http://<board-ip>`.");
  return { installed: true, python, backups, board: args.board || null };
}

function commandExists(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// CLI entry (skipped on import for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ argv: process.argv.slice(2) }).catch((e) => {
    console.error("\n✖ " + e.message);
    process.exit(1);
  });
}
