import { test } from "node:test";
import assert from "node:assert/strict";
import { findBrowser, buildAppArgs } from "./mini-lib.mjs";

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
