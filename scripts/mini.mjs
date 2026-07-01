#!/usr/bin/env node
// scripts/mini.mjs, `npm run mini`: pop the desktop mini-board window.
//
// Opens studio/mini.html in a small, near-chromeless desktop window (Chromium --app
// mode) that mirrors the board and can be dragged anywhere on the desktop. Requires the
// Studio engine to be running (`npm run studio`); it says so if it isn't, rather than
// opening a window at a dead URL.
//
// Env: ENGINE_URL or ENGINE_PORT (default http://127.0.0.1:8787), MINI_SIZE (default 240).
import { launchMini } from "./mini-lib.mjs";

const port = Number(process.env.ENGINE_PORT) || 8787;
const base = (process.env.ENGINE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const url = `${base}/studio/mini.html`;

// Confirm the engine is serving the page before we open a window pointed at it.
let reachable = false;
try {
  reachable = (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
} catch { reachable = false; }

if (!reachable) {
  console.error(`Studio engine not reachable at ${base}. Start it first:\n  npm run studio`);
  console.error(`(or set ENGINE_URL / ENGINE_PORT if your engine runs elsewhere.)`);
  process.exit(1);
}

const size = Number(process.env.MINI_SIZE) || 240;
const res = launchMini(url, { width: size, height: size });

if (!res.ok) {
  console.error(`Could not open the mini-board window: ${res.error}`);
  console.error(`Open it yourself in a browser: ${url}`);
  process.exit(1);
}

console.log(
  res.mode === "app"
    ? `Mini-board open in a ${/edge/i.test(res.browser || "") ? "Edge" : "Chrome"} app window. Drag it onto your desktop wherever you like.`
    : `No Chrome/Edge found, so I opened ${url} in your default browser. Resize/position that window as a mini-board.`,
);
