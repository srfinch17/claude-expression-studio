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

/** The [cmd, args] to open a url in the OS default browser (fallback when no Chromium
 *  is found). Not app-mode. On Windows the `start "" <url>` form needs the empty title
 *  arg so a url in quotes is not mistaken for the window title. Pure, for testability. */
export function defaultOpenCommand(url, platform = process.platform) {
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}

// A profile dir UNIQUE per launch. Chrome enforces one running process per --user-data-dir,
// so a shared fixed dir would make a second mini-board window collide with the first's profile
// lock instead of opening an independent instance. A timestamp + random suffix keeps each
// launch isolated (and it is a throwaway widget profile under the OS temp dir).
function uniqueProfileDir() {
  return join(tmpdir(), `claude-mini-board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/**
 * Launch the mini-board window. Returns { ok, mode, browser?, url }.
 *   mode: "app"     -> opened chromeless in a Chromium --app window
 *         "default" -> no Chromium found, opened the url in the default browser
 *         "failed"  -> spawn threw
 * Detached + unref so the widget survives the caller exiting or the stdio pipe closing
 * (a normal MCP reconnect exits the server gracefully without waiting on this child's
 * process group, so the window stays up; only a forced whole-tree kill would close it).
 * `spawnFn` is injectable for tests; defaults to the real child_process.spawn.
 */
export function launchMini(url, opts = {}) {
  const platform = opts.platform || process.platform;
  const width = opts.width || 240;
  const height = opts.height || 240;
  const profileDir = opts.profileDir || uniqueProfileDir();
  const spawnFn = opts.spawnFn || spawn;
  const browser = opts.browser ?? findBrowser(platform, opts.env || process.env);
  try {
    if (browser) {
      const args = buildAppArgs(url, { width, height, x: opts.x, y: opts.y, profileDir });
      spawnFn(browser, args, { detached: true, stdio: "ignore" }).unref();
      return { ok: true, mode: "app", browser, url };
    }
    const [cmd, args] = defaultOpenCommand(url, platform);
    spawnFn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    return { ok: true, mode: "default", url };
  } catch (e) {
    return { ok: false, mode: "failed", url, error: e instanceof Error ? e.message : String(e) };
  }
}
