import { test } from "node:test";
import assert from "node:assert/strict";
import { findBrowser, buildAppArgs, defaultOpenCommand, launchMini } from "./mini-lib.mjs";

// findBrowser(platform, env, exists) -> a Chromium binary path or null.

test("findBrowser picks Chrome on Windows when it exists", () => {
  const env = { "PROGRAMFILES": "C:\\Program Files", "LOCALAPPDATA": "C:\\Users\\x\\AppData\\Local" };
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const found = findBrowser("win32", env, (p) => p === chrome);
  assert.equal(found, chrome);
});

test("findBrowser falls back to Edge on Windows when Chrome is absent", () => {
  const env = { "PROGRAMFILES(X86)": "C:\\Program Files (x86)" };
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const found = findBrowser("win32", env, (p) => p === edge);
  assert.equal(found, edge);
});

test("findBrowser returns null on Windows when no Chromium is installed", () => {
  assert.equal(findBrowser("win32", {}, () => false), null);
});

test("findBrowser finds Chrome on macOS", () => {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  assert.equal(findBrowser("darwin", {}, (p) => p === mac), mac);
});

test("findBrowser finds a chromium binary on Linux", () => {
  const bin = "/usr/bin/google-chrome";
  assert.equal(findBrowser("linux", {}, (p) => p === bin), bin);
});

// buildAppArgs(url, opts) -> arg array for a Chromium --app launch.

test("buildAppArgs opens the url in app mode at the requested size", () => {
  const args = buildAppArgs("http://127.0.0.1:8787/studio/mini.html", {
    width: 240, height: 240, profileDir: "/tmp/mini",
  });
  assert.ok(args.includes("--app=http://127.0.0.1:8787/studio/mini.html"), "app url flag");
  assert.ok(args.includes("--window-size=240,240"), "window size");
  assert.ok(args.some((a) => a.startsWith("--user-data-dir=")), "isolated profile so it opens clean");
});

test("buildAppArgs positions the window when x/y are given, omits otherwise", () => {
  const withPos = buildAppArgs("http://x/mini.html", { width: 240, height: 240, x: 40, y: 60, profileDir: "/tmp/m" });
  assert.ok(withPos.includes("--window-position=40,60"));
  const noPos = buildAppArgs("http://x/mini.html", { width: 240, height: 240, profileDir: "/tmp/m" });
  assert.ok(!noPos.some((a) => a.startsWith("--window-position=")));
});

// defaultOpenCommand(url, platform) -> [cmd, args] for the no-Chromium fallback.

test("defaultOpenCommand uses `start` on Windows with an empty title arg", () => {
  const [cmd, args] = defaultOpenCommand("http://x/mini.html", "win32");
  assert.equal(cmd, "cmd");
  // `start "" <url>`: the empty title arg is required so a quoted url isn't taken as the title.
  assert.deepEqual(args, ["/c", "start", "", "http://x/mini.html"]);
});

test("defaultOpenCommand uses `open` on macOS and `xdg-open` on Linux", () => {
  assert.deepEqual(defaultOpenCommand("u", "darwin"), ["open", ["u"]]);
  assert.deepEqual(defaultOpenCommand("u", "linux"), ["xdg-open", ["u"]]);
});

// launchMini(url, opts) -> spawns (injected spawnFn) and reports the mode.

function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args) => { calls.push({ cmd, args }); return { unref() {} }; };
  fn.calls = calls;
  return fn;
}

test("launchMini opens app mode when a browser is found", () => {
  const spawnFn = fakeSpawn();
  const res = launchMini("http://x/mini.html", { platform: "linux", browser: "/usr/bin/google-chrome", spawnFn });
  assert.equal(res.ok, true);
  assert.equal(res.mode, "app");
  assert.equal(spawnFn.calls[0].cmd, "/usr/bin/google-chrome");
  assert.ok(spawnFn.calls[0].args.some((a) => a.startsWith("--app=")));
});

test("launchMini falls back to the default browser when no Chromium is found", () => {
  const spawnFn = fakeSpawn();
  const res = launchMini("http://x/mini.html", { platform: "linux", browser: null, spawnFn });
  assert.equal(res.mode, "default");
  assert.equal(spawnFn.calls[0].cmd, "xdg-open");
});

test("launchMini reports mode 'failed' when the spawn throws (never crashes the caller)", () => {
  const spawnFn = () => { throw new Error("ENOENT"); };
  const res = launchMini("http://x/mini.html", { platform: "linux", browser: "/usr/bin/google-chrome", spawnFn });
  assert.equal(res.ok, false);
  assert.equal(res.mode, "failed");
  assert.match(res.error, /ENOENT/);
});

test("launchMini gives each launch a UNIQUE profile dir so two windows don't collide on Chrome's profile lock", () => {
  const s1 = fakeSpawn(), s2 = fakeSpawn();
  launchMini("http://x/mini.html", { platform: "linux", browser: "/usr/bin/google-chrome", spawnFn: s1 });
  launchMini("http://x/mini.html", { platform: "linux", browser: "/usr/bin/google-chrome", spawnFn: s2 });
  const dir1 = s1.calls[0].args.find((a) => a.startsWith("--user-data-dir="));
  const dir2 = s2.calls[0].args.find((a) => a.startsWith("--user-data-dir="));
  assert.ok(dir1 && dir2, "both launches set a profile dir");
  assert.notEqual(dir1, dir2, "profile dirs must differ between launches");
});
