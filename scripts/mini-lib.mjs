// scripts/mini-lib.mjs, the launcher brains for the desktop mini-board.
//
// Opens studio/mini.html in a small, near-chromeless desktop window using a Chromium
// browser's `--app` mode (no tabs, no address bar, just a thin OS title bar that also
// drags the window). Zero dependencies: the window is the engine-served page plus a
// launch command. Pure helpers (findBrowser, buildAppArgs) are unit-tested; launchMini
// does the actual detached spawn (or a default-browser fallback) and is exercised by the
// CLI (scripts/mini.mjs) and the matrix_mini MCP tool.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Candidate Chromium binaries per platform, in preference order (Chrome first, then Edge).
function candidates(platform, env) {
  if (platform === "win32") {
    const pf = env["PROGRAMFILES"] || "C:\\Program Files";
    const pfx86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = env["LOCALAPPDATA"] || "";
    const out = [
      join(pf, "Google\\Chrome\\Application\\chrome.exe"),
      join(pfx86, "Google\\Chrome\\Application\\chrome.exe"),
    ];
    if (local) out.push(join(local, "Google\\Chrome\\Application\\chrome.exe"));
    out.push(
      join(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
      join(pfx86, "Microsoft\\Edge\\Application\\msedge.exe"),
    );
    return out;
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  // linux + everything else
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

/** First existing Chromium binary for the platform, or null. `exists` is injectable for tests. */
export function findBrowser(platform = process.platform, env = process.env, exists = existsSync) {
  for (const c of candidates(platform, env)) {
    if (exists(c)) return c;
  }
  return null;
}

/** Chromium `--app` args: a chromeless window at the given size/position with an
 *  isolated profile (so it opens clean and doesn't disturb the user's main session). */
export function buildAppArgs(url, { width, height, x, y, profileDir }) {
  const args = [
    `--app=${url}`,
    `--window-size=${width},${height}`,
    `--user-data-dir=${profileDir}`,
    // Keep the isolated instance from nagging; it is a throwaway widget profile.
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (Number.isFinite(x) && Number.isFinite(y)) args.push(`--window-position=${x},${y}`);
  return args;
}

// Open a url in the OS default browser (fallback when no Chromium is found). Not app-mode.
function openDefault(url, platform) {
  if (platform === "win32") return spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", shell: false });
  if (platform === "darwin") return spawn("open", [url], { detached: true, stdio: "ignore" });
  return spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}

/**
 * Launch the mini-board window. Returns { ok, mode, browser?, url }.
 *   mode: "app"     -> opened chromeless in a Chromium --app window
 *         "default" -> no Chromium found, opened the url in the default browser
 *         "failed"  -> spawn threw
 * Detached so the widget outlives the caller (CLI process or MCP server).
 */
export function launchMini(url, opts = {}) {
  const platform = opts.platform || process.platform;
  const width = opts.width || 240;
  const height = opts.height || 240;
  const profileDir = opts.profileDir || join(tmpdir(), "claude-mini-board");
  const browser = opts.browser ?? findBrowser(platform, opts.env || process.env);
  try {
    if (browser) {
      const args = buildAppArgs(url, { width, height, x: opts.x, y: opts.y, profileDir });
      const child = spawn(browser, args, { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true, mode: "app", browser, url };
    }
    const child = openDefault(url, platform);
    child.unref();
    return { ok: true, mode: "default", url };
  } catch (e) {
    return { ok: false, mode: "failed", url, error: e instanceof Error ? e.message : String(e) };
  }
}
