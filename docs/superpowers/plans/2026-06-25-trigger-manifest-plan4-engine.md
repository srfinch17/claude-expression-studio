# Trigger Manifest — Plan 4 (The Engine: serve the Studio + live virtual board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the MCP server into a small local **engine** — alongside its stdio MCP protocol it runs a localhost HTTP server that serves the Studio, exposes a manifest read/write API, and pushes every rendered intent to a browser **virtual board** so the display works (and is shareable) with or without hardware.

**Architecture:** A side HTTP server (Node built-in `node:http`, bound to `127.0.0.1` only) coexists with the existing `StdioServerTransport`. It serves static Studio + shared files from a base dir (repo-first in dev, a packed `studio-dist/` tree in the `.mcpb`), exposes `GET/PUT /api/manifest` (validated writes), and holds a **Server-Sent Events** hub. Every board render (`runPlan`) emits a typed *display event* that is both POSTed to the real board (as today) AND broadcast over SSE; the virtual board page renders those events with the existing `web-sim` renderer + `Panel`. No new runtime dependency.

**Tech Stack:** TypeScript (compiled to `dist/`), Node `node:http` + Server-Sent Events (zero-dep), the existing `shared/` render core (`render.js` `Panel`, `renderers/web-sim.js`, `expressions.js`, `firmware-sims.js`), the existing `@anthropic-ai/mcpb` packer.

## Global Constraints

- **Privacy:** never use the maintainer's real name in code/comments/docs — refer to "the user". (verbatim from CLAUDE.md)
- **No new runtime dependency in `mcp_server/package.json`** — the `.mcpb` is kept dependency-clean on purpose (a native `@napi-rs/canvas` dep was previously *removed* for this reason). The HTTP + live-push layer MUST use Node built-ins only (`node:http`, SSE). `ws`/WebSocket is explicitly out (see Decision D1).
- **Bind to `127.0.0.1` ONLY**, never `0.0.0.0` — the engine is a local tool and must not be exposed to the LAN.
- **Repo-first / bundle-fallback** path resolution for all engine assets (mirror the existing `engineDir()` pattern in `mcp_server/engine.ts:34`): prefer live repo source in dev, fall back to the in-bundle copy when packed.
- **Never break the MCP protocol pipe:** all engine logging goes to `stderr` (`console.error`), never `stdout` (stdout is the JSON-RPC channel). (existing rule, `index.ts:763`)
- **Never blank the board / never throw out of a tool:** the engine's broadcast is best-effort and MUST NOT change the existing board-render behavior or throw if no SSE clients are connected.
- **Tests:** `mcp_server/**/*.test.ts` run via `node --test` (TS type-strip, no compile step); `shared/**/*.test.js` and `scripts/**/*.test.js` via `node --test`. The whole gate is `npm test` (which runs `check:manifest` first). Keep it green at every commit.
- **TS config:** `mcp_server/tsconfig.json` has NO `noUnusedLocals` (dead-code-until-wired compiles); test files are excluded from `dist`.

---

## Decisions baked into this plan

- **D1 — Server-Sent Events, not WebSocket.** The spec (§7) names "WebSocket," but the virtual board's only requirement is a **one-way push** (engine → browser renders frames; user *input* goes through the REST API, not the socket). SSE delivers exactly that over plain `node:http` with **zero dependencies**, browser-native `EventSource` (auto-reconnect included), and no upgrade handshake — which satisfies the Global Constraint "no new runtime dependency" that the WebSocket route would violate. **If** a future feature needs browser→engine streaming (none in v1), revisit `ws`. *(Flagged for the user's review: this is a deliberate, rationale-backed deviation from the spec's wording, not from its intent.)*
- **D2 — The virtual board is a live MIRROR, always broadcast.** Rather than branch on "hardware present vs absent," the engine ALWAYS emits the display event to SSE clients AND POSTs to the board as it does today. The virtual board therefore mirrors the real panel when hardware exists, and *is* the display when it doesn't. Simpler, and useful even with hardware.
- **D3 — Port strategy:** try `ENGINE_PORT` (env) or default **8787**; if taken, ask the OS for an ephemeral free port (`listen(0)`). The chosen URL is logged to stderr, returned by a new `matrix_studio` MCP tool, and written to `mcp_server/.engine-url` (gitignored) so any caller can find it.
- **D4 — Static root = a base dir with `studio/` + `shared/` under it.** The existing Studio pages import `../shared/*.js`, so the engine serves a tree where both `/studio/...` and `/shared/...` resolve. Dev base = repo root; bundle base = `MCP_DIR/studio-dist/`. `/` redirects to `/studio/index.html`.
- **D5 — Scope boundary vs Plans 5 & 6.** Plan 4 ships the engine + the *existing* Studio gallery served live + the virtual board + the manifest read/write API (proven round-trip). The **rich assignment UI** that USES the write API to place the ~40 animations is **Plan 6**; the **public Pages showcase** is **Plan 5**. Plan 4 adds only a minimal "save the manifest" affordance to prove the write path end-to-end.

---

## File Structure

**New files (all under `mcp_server/`, compiled with the server):**
- `mcp_server/sse.ts` — the SSE hub: holds connected `ServerResponse` clients, `addClient(res)`, `broadcast(event)`, `clientCount()`. Pure of HTTP routing; unit-testable with a fake response.
- `mcp_server/static-files.ts` — `resolveStaticBase(mcpDir)` (repo-first/bundle-fallback) + `serveStatic(req, res, base)`: safe path resolution (no `..` escape), content-type by extension, 404s cleanly. Unit-testable against a temp dir.
- `mcp_server/manifest-api.ts` — `readManifest(dir)` / `writeManifestValidated(dir, json)`: the latter runs the shared validator before writing, returns `{ok, errors?}`. Unit-testable.
- `mcp_server/engine-server.ts` — `startEngineServer({mcpDir, broadcastRef, port?})`: wires `node:http` → static-files + manifest-api + SSE `/events`, binds `127.0.0.1`, resolves the port (D3), returns `{url, port, hub, close()}`. The one module that touches `http`.
- `mcp_server/display-event.ts` — `planToDisplayEvent(plan, expr?)`: PURE map from a `RenderPlan` (+ the resolved expression for the frames case) to the wire `DisplayEvent` the virtual board consumes. Unit-testable.
- `studio/board.js` — the virtual board page logic: `applyEvent(event, {panel, webSim})` PURE mapping (unit-testable, mirrors `web-sim.js` style) + the `EventSource` glue.
- `studio/board.html` — the virtual board page (canvas + the bloom `Panel`, opens `EventSource('/events')`). DOM glue; manual browser smoke.
- Tests: `mcp_server/sse.test.ts`, `mcp_server/static-files.test.ts`, `mcp_server/manifest-api.test.ts`, `mcp_server/display-event.test.ts`, `mcp_server/engine-integration.test.ts`, `studio/board.test.js`.

**Modified files:**
- `mcp_server/index.ts` — import + start the engine server in `main()`; give the SSE hub a module-level `broadcastRef` that `runPlan()` calls after deciding a plan; add the `matrix_studio` tool (list + handler).
- `scripts/copy-shared-runtime.mjs` — also stage `studio/` + `shared/` + `studio/gallery-data.json` into `mcp_server/studio-dist/` for the packed engine.
- `scripts/copy-shared-runtime.test.ts`/`.test.js` — assert the new staged files exist.
- `package.json` (root) — `build:mcpb` already calls `copy-shared-runtime.mjs`; confirm `build:gallery` runs first so `gallery-data.json` exists to stage.
- `.gitignore` — add `mcp_server/studio-dist/` and `mcp_server/.engine-url`.
- `mcp_server/manifest.json` (the `.mcpb` manifest) — bump `description` to mention the Studio URL; no schema change.

---

## Task 1: SSE hub (`mcp_server/sse.ts`)

**Files:**
- Create: `mcp_server/sse.ts`
- Test: `mcp_server/sse.test.ts`

**Interfaces:**
- Produces:
  - `interface DisplayEvent { kind: "frames" | "animation" | "noop"; name?: string; wire?: unknown; type?: string; params?: Record<string, unknown>; brightness?: number; }`
  - `interface SseClient { write(chunk: string): void; end?(): void; on?(ev: string, cb: () => void): void; }`
  - `class SseHub { addClient(res: SseClient): void; removeClient(res: SseClient): void; broadcast(event: DisplayEvent): void; clientCount(): number; }`
  - `broadcast` writes `data: ${JSON.stringify(event)}\n\n` to every client; a throwing client is dropped, never propagates.

- [ ] **Step 1: Write the failing test**

```ts
// mcp_server/sse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SseHub, type DisplayEvent } from "./sse.ts";

function fakeClient() {
  const chunks: string[] = [];
  return { chunks, write(c: string) { chunks.push(c); } };
}

test("broadcast writes SSE-framed JSON to every client", () => {
  const hub = new SseHub();
  const a = fakeClient(), b = fakeClient();
  hub.addClient(a); hub.addClient(b);
  const ev: DisplayEvent = { kind: "frames", name: "done", wire: { frames: ["x"], frame_ms: 150, loop: 0 } };
  hub.broadcast(ev);
  assert.equal(hub.clientCount(), 2);
  assert.equal(a.chunks[0], `data: ${JSON.stringify(ev)}\n\n`);
  assert.deepEqual(a.chunks, b.chunks);
});

test("a throwing client is dropped, others still receive, broadcast never throws", () => {
  const hub = new SseHub();
  const bad = { write() { throw new Error("client gone"); } };
  const good = fakeClient();
  hub.addClient(bad); hub.addClient(good);
  assert.doesNotThrow(() => hub.broadcast({ kind: "noop" }));
  assert.equal(hub.clientCount(), 1);          // bad was dropped
  assert.equal(good.chunks.length, 1);
});

test("removeClient drops the client; broadcast to none is a no-op", () => {
  const hub = new SseHub();
  const a = fakeClient();
  hub.addClient(a); hub.removeClient(a);
  assert.equal(hub.clientCount(), 0);
  assert.doesNotThrow(() => hub.broadcast({ kind: "noop" }));
  assert.equal(a.chunks.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp_server && node --test sse.test.ts`
Expected: FAIL — `Cannot find module './sse.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mcp_server/sse.ts — a tiny Server-Sent Events fan-out hub. No HTTP knowledge here:
// it holds "clients" (anything with write()) and frames each DisplayEvent as one SSE
// message. A client that throws on write (browser tab closed) is dropped, never
// propagated — broadcast() is best-effort and MUST NOT throw into runPlan().

export interface DisplayEvent {
  kind: "frames" | "animation" | "noop";
  name?: string;
  wire?: unknown;                       // expressionToWire() output for the frames path
  type?: string;                        // firmware animation type
  params?: Record<string, unknown>;
  brightness?: number;
}

export interface SseClient {
  write(chunk: string): void;
  end?(): void;
  on?(ev: string, cb: () => void): void;
}

export class SseHub {
  private clients = new Set<SseClient>();
  addClient(res: SseClient): void { this.clients.add(res); }
  removeClient(res: SseClient): void { this.clients.delete(res); }
  clientCount(): number { return this.clients.size; }
  broadcast(event: DisplayEvent): void {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of [...this.clients]) {
      try { c.write(msg); } catch { this.clients.delete(c); }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp_server && node --test sse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp_server/sse.ts mcp_server/sse.test.ts
git commit -m "feat(engine): SSE hub for pushing display events to virtual boards"
```

---

## Task 2: Static file server (`mcp_server/static-files.ts`)

**Files:**
- Create: `mcp_server/static-files.ts`
- Test: `mcp_server/static-files.test.ts`

**Interfaces:**
- Consumes: `engineDir`-style repo-first/bundle-fallback idea (see `mcp_server/engine.ts:34`).
- Produces:
  - `resolveStaticBase(mcpDir: string): string` — returns the repo root if `<repo>/studio/index.html` exists, else `<mcpDir>/studio-dist`.
  - `safeResolve(base: string, urlPath: string): string | null` — joins + normalizes; returns `null` if the result escapes `base` (path traversal) or is empty.
  - `contentType(file: string): string` — by extension (`.html`,`.js`,`.mjs`,`.json`,`.css`,`.svg`,`.png`,`.ico`; default `application/octet-stream`).
  - `async serveStatic(urlPath: string, base: string): Promise<{ status: number; type: string; body: Buffer }>` — reads the file; `/` and `''` map to `studio/index.html`; missing → `{status:404}`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp_server/static-files.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeResolve, contentType, serveStatic, resolveStaticBase } from "./static-files.ts";

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "eng-static-"));
  await mkdir(path.join(base, "studio"), { recursive: true });
  await mkdir(path.join(base, "shared"), { recursive: true });
  await writeFile(path.join(base, "studio", "index.html"), "<h1>studio</h1>");
  await writeFile(path.join(base, "shared", "render.js"), "export const x=1;");
  return base;
}

test("safeResolve blocks path traversal, allows in-tree", () => {
  assert.equal(safeResolve("/base", "/../etc/passwd"), null);
  assert.ok(safeResolve("/base", "/studio/index.html")?.endsWith(path.join("base", "studio", "index.html")));
});

test("contentType maps known extensions", () => {
  assert.equal(contentType("a.html"), "text/html; charset=utf-8");
  assert.equal(contentType("a.js"), "text/javascript; charset=utf-8");
  assert.equal(contentType("a.json"), "application/json; charset=utf-8");
  assert.equal(contentType("a.bin"), "application/octet-stream");
});

test("serveStatic returns files, maps / to studio/index.html, 404s missing", async () => {
  const base = await fixture();
  const root = await serveStatic("/", base);
  assert.equal(root.status, 200);
  assert.equal(root.type, "text/html; charset=utf-8");
  assert.match(root.body.toString(), /studio/);
  const sh = await serveStatic("/shared/render.js", base);
  assert.equal(sh.status, 200);
  assert.equal(sh.type, "text/javascript; charset=utf-8");
  const miss = await serveStatic("/studio/nope.html", base);
  assert.equal(miss.status, 404);
});

test("resolveStaticBase prefers a repo root that has studio/index.html", async () => {
  const base = await fixture();
  // mcpDir = <base>/mcp_server ; repo root = <base> which HAS studio/index.html
  assert.equal(resolveStaticBase(path.join(base, "mcp_server")), base);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp_server && node --test static-files.test.ts`
Expected: FAIL — `Cannot find module './static-files.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mcp_server/static-files.ts — serve the Studio + shared tree over http. Base is the
// repo root in dev (live edits) or the packed studio-dist/ in the .mcpb. All path
// resolution is sandboxed to `base` (no `..` escape).
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export function resolveStaticBase(mcpDir: string): string {
  const repo = path.join(mcpDir, "..");
  if (existsSync(path.join(repo, "studio", "index.html"))) return repo;
  return path.join(mcpDir, "studio-dist");
}

export function safeResolve(base: string, urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const full = path.normalize(path.join(base, clean));
  const rel = path.relative(base, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export async function serveStatic(
  urlPath: string,
  base: string,
): Promise<{ status: number; type: string; body: Buffer }> {
  let p = urlPath.split("?")[0];
  if (p === "/" || p === "") p = "/studio/index.html";
  const full = safeResolve(base, p);
  if (!full) return { status: 404, type: "text/plain", body: Buffer.from("not found") };
  try {
    const body = await readFile(full);
    return { status: 200, type: contentType(full), body };
  } catch {
    return { status: 404, type: "text/plain", body: Buffer.from("not found") };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp_server && node --test static-files.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp_server/static-files.ts mcp_server/static-files.test.ts
git commit -m "feat(engine): sandboxed static file server for the Studio tree"
```

---

## Task 3: Manifest read/write API (`mcp_server/manifest-api.ts`)

**Files:**
- Create: `mcp_server/manifest-api.ts`
- Test: `mcp_server/manifest-api.test.ts`

**Interfaces:**
- Consumes: the shared validator `scripts/check-manifest.mjs` — **already exports** (verified): `validateManifest(manifest, animationNames) -> string[]` (error strings; empty = valid) and `collectAnimationNames(repoRoot) -> Set<string>` (firmware + `mcp_server/expressions/*.json` + `claude-hooks/bored_animations/*.json` + canned). Importing the module is **side-effect-free** — its `main()` is guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`. **No refactor needed.**
- Produces:
  - `async readManifest(dir: string): Promise<unknown>` — `JSON.parse` of `<dir>/manifest.json`.
  - `async writeManifestValidated(dir: string, manifest: unknown, repoRoot: string): Promise<{ ok: true } | { ok: false; errors: string[] }>` — validates via `validateManifest(manifest, collectAnimationNames(repoRoot))`; on clean, writes 2-space pretty JSON + trailing newline to `<dir>/manifest.json`; on errors, writes nothing and returns them.
- **Bundle-side limitation (scoped to Plan 6):** the validator lives in `scripts/` which is NOT packed into the `.mcpb` (only `mcp_server/` is). So in dev (repo-first) writes validate fully; in the packed engine, `writeManifestValidated` will fail to import the validator and returns `{ok:false, errors:["validator unavailable"]}` (a clean error, never a bad write). The **READ** path works everywhere. Staging the validator into the bundle is folded into **Plan 6**, when the assignment UI actually needs packed-engine writes. Plan 4 proves the write path in dev.

- [ ] **Step 1: Write the failing test**

```ts
// mcp_server/manifest-api.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readManifest, writeManifestValidated } from "./manifest-api.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const REAL_MANIFEST = path.join(REPO_ROOT, "shared", "manifest.json");

async function tmpDirWithManifest() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eng-mf-"));
  await cp(REAL_MANIFEST, path.join(dir, "manifest.json"));
  return dir;
}

test("readManifest parses the file", async () => {
  const dir = await tmpDirWithManifest();
  const m = await readManifest(dir) as any;
  assert.ok(m.intents && m.renderers);
});

test("writeManifestValidated rejects an invalid manifest and writes nothing", async () => {
  const dir = await tmpDirWithManifest();
  const before = await readFile(path.join(dir, "manifest.json"), "utf8");
  const res = await writeManifestValidated(dir, { version: 1, intents: {}, harnesses: {}, renderers: {} }, REPO_ROOT);
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.length > 0);
  const after = await readFile(path.join(dir, "manifest.json"), "utf8");
  assert.equal(after, before);                   // unchanged on invalid
});

test("writeManifestValidated accepts the real manifest round-trip", async () => {
  const dir = await tmpDirWithManifest();
  const m = await readManifest(dir);
  const res = await writeManifestValidated(dir, m, REPO_ROOT);
  assert.equal(res.ok, true);
  const reparsed = await readManifest(dir);
  assert.deepEqual(reparsed, m);                 // lossless
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp_server && node --test manifest-api.test.ts`
Expected: FAIL — `Cannot find module './manifest-api.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mcp_server/manifest-api.ts — the engine's manifest read/write surface. Writes are
// VALIDATED through the same shared validator + animation-name collector the CI gate uses
// (scripts/check-manifest.mjs), so the Studio can never persist a manifest that would fail
// `npm run check:manifest`. Importing the .mjs is side-effect-free (its main() is argv-guarded).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function readManifest(dir: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
}

export async function writeManifestValidated(
  dir: string,
  manifest: unknown,
  repoRoot: string,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const cli = path.join(repoRoot, "scripts", "check-manifest.mjs");
  if (!existsSync(cli)) return { ok: false, errors: ["validator unavailable (packed engine — see Plan 6)"] };
  const { validateManifest, collectAnimationNames } = await import(pathToFileURL(cli).href);
  const errors: string[] = validateManifest(manifest, collectAnimationNames(repoRoot));
  if (errors.length) return { ok: false, errors };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp_server && node --test manifest-api.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp_server/manifest-api.ts mcp_server/manifest-api.test.ts
git commit -m "feat(engine): validated manifest read/write API"
```

---

## Task 4: Plan → DisplayEvent (`mcp_server/display-event.ts`)

**Files:**
- Create: `mcp_server/display-event.ts`
- Test: `mcp_server/display-event.test.ts`

**Interfaces:**
- Consumes: `RenderPlan` from `mcp_server/engine.ts` (`{kind:"animation",type,params,brightness?} | {kind:"frames",name,brightness?} | {kind:"noop"}`); `DisplayEvent` from `mcp_server/sse.ts`; the already-imported `expressionToWire` + `CANNED` + `loadSavedExpression` are available in `index.ts` (Task 5 supplies the wire there).
- Produces: `planToDisplayEvent(plan: RenderPlan, wire?: unknown): DisplayEvent` — PURE. For `frames`, attach the passed-in `wire` (the `expressionToWire(expr)` payload the board POST already computes) + `name` + `brightness`; for `animation`, `{kind, type, params, brightness}`; for `noop`, `{kind:"noop"}`.

- [ ] **Step 1: Write the failing test**

```ts
// mcp_server/display-event.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planToDisplayEvent } from "./display-event.ts";

test("frames plan carries name, wire, brightness", () => {
  const wire = { frames: ["A"], frame_ms: 150, loop: 0 };
  const ev = planToDisplayEvent({ kind: "frames", name: "done", brightness: 5 }, wire);
  assert.deepEqual(ev, { kind: "frames", name: "done", wire, brightness: 5 });
});

test("animation plan carries type + params + brightness", () => {
  const ev = planToDisplayEvent({ kind: "animation", type: "fire", params: { intensity: 7 }, brightness: 40 });
  assert.deepEqual(ev, { kind: "animation", type: "fire", params: { intensity: 7 }, brightness: 40 });
});

test("noop plan maps to a noop event", () => {
  assert.deepEqual(planToDisplayEvent({ kind: "noop" }), { kind: "noop" });
});

test("frames without brightness omits the key", () => {
  const ev = planToDisplayEvent({ kind: "frames", name: "smiley" }, { frames: [], frame_ms: 150, loop: 0 });
  assert.ok(!("brightness" in ev));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp_server && node --test display-event.test.ts`
Expected: FAIL — `Cannot find module './display-event.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mcp_server/display-event.ts — PURE map from a RenderPlan to the wire DisplayEvent the
// virtual board consumes. The `wire` arg is the expressionToWire() payload index.ts has
// already computed for the board POST (frames path); we just forward it so the virtual
// board renders the exact same frames the hardware does.
import type { RenderPlan } from "./engine.js";
import type { DisplayEvent } from "./sse.js";

export function planToDisplayEvent(plan: RenderPlan, wire?: unknown): DisplayEvent {
  if (plan.kind === "noop") return { kind: "noop" };
  if (plan.kind === "animation") {
    const ev: DisplayEvent = { kind: "animation", type: plan.type, params: plan.params };
    if (plan.brightness != null) ev.brightness = plan.brightness;
    return ev;
  }
  const ev: DisplayEvent = { kind: "frames", name: plan.name, wire };
  if (plan.brightness != null) ev.brightness = plan.brightness;
  return ev;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp_server && node --test display-event.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp_server/display-event.ts mcp_server/display-event.test.ts
git commit -m "feat(engine): pure RenderPlan -> DisplayEvent mapping"
```

---

## Task 5: The HTTP engine server (`mcp_server/engine-server.ts`)

**Files:**
- Create: `mcp_server/engine-server.ts`
- Test: `mcp_server/engine-server.test.ts`

**Interfaces:**
- Consumes: `SseHub` (Task 1), `resolveStaticBase`/`serveStatic` (Task 2), `readManifest`/`writeManifestValidated` (Task 3).
- Produces:
  - `async startEngineServer(opts: { mcpDir: string; port?: number; manifestDir?: string; repoRoot?: string }): Promise<{ url: string; port: number; hub: SseHub; close: () => Promise<void> }>`. The `manifestDir`/`repoRoot` overrides exist so tests can point the manifest API at a temp copy (default: derived from `mcpDir`).
  - Routes: `GET /events` → SSE stream (adds the `res` to the hub, writes the SSE headers + a `: ok\n\n` comment, removes on `close`); `GET /api/manifest` → JSON; `PUT /api/manifest` → read JSON body, `writeManifestValidated`, `200 {ok:true}` or `400 {ok:false,errors}`; everything else → `serveStatic`. `/` redirects (302) to `/studio/index.html`.
  - Binds `127.0.0.1`. Port: `opts.port ?? Number(process.env.ENGINE_PORT) || 8787`; on `EADDRINUSE`, retry once with port `0` (ephemeral).

- [ ] **Step 1: Write the failing test**

```ts
// mcp_server/engine-server.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startEngineServer } from "./engine-server.ts";

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url)); // mcp_server/ ; repo root is ..

test("serves studio index, GET manifest, and rejects a bad PUT", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  const idx = await fetch(`${eng.url}/studio/index.html`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /<!DOCTYPE html>|<html/i);

  const mf = await fetch(`${eng.url}/api/manifest`);
  assert.equal(mf.status, 200);
  const json = await mf.json() as any;
  assert.ok(json.intents && json.renderers);

  const bad = await fetch(`${eng.url}/api/manifest`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: 1, intents: {}, harnesses: {}, renderers: {} }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as any).ok, false);
});

test("GET /events streams a DisplayEvent broadcast over SSE", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  const res = await fetch(`${eng.url}/events`, { headers: { accept: "text/event-stream" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

  const reader = res.body!.getReader();
  // wait until the server has registered our client, then broadcast
  await new Promise((r) => setTimeout(r, 50));
  eng.hub.broadcast({ kind: "frames", name: "done", wire: { frames: ["A"], frame_ms: 150, loop: 0 } });

  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /data: /);
  assert.match(text, /"name":"done"/);
  await reader.cancel();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp_server && node --test engine-server.test.ts`
Expected: FAIL — `Cannot find module './engine-server.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// mcp_server/engine-server.ts — the engine's localhost HTTP face. Coexists with the MCP
// stdio transport (separate channel). Serves the Studio tree, a validated manifest API,
// and an SSE stream of DisplayEvents to virtual boards. Binds 127.0.0.1 ONLY.
import http from "node:http";
import { SseHub } from "./sse.js";
import { resolveStaticBase, serveStatic } from "./static-files.js";
import { readManifest, writeManifestValidated } from "./manifest-api.js";
import { engineDir } from "./engine.js";   // repo-first ../shared, else mcpDir/shared-runtime
import path from "node:path";

const HOST = "127.0.0.1";

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startEngineServer(opts: { mcpDir: string; port?: number; manifestDir?: string; repoRoot?: string }) {
  const { mcpDir } = opts;
  const hub = new SseHub();
  const base = resolveStaticBase(mcpDir);
  const mfDir = opts.manifestDir ?? engineDir(mcpDir);   // shared/ in dev, shared-runtime/ when packed
  const repoRoot = opts.repoRoot ?? path.join(mcpDir, "..");   // for the validator (validateManifest + collectAnimationNames)

  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url || "/";
      const method = req.method || "GET";

      if (url === "/" ) { res.writeHead(302, { location: "/studio/index.html" }); res.end(); return; }

      if (url.startsWith("/events")) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": ok\n\n");
        hub.addClient(res);
        req.on("close", () => hub.removeClient(res));
        return;
      }

      if (url.startsWith("/api/manifest")) {
        if (method === "GET") {
          const m = await readManifest(mfDir);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(m));
          return;
        }
        if (method === "PUT") {
          let parsed: unknown;
          try { parsed = JSON.parse(await readBody(req)); }
          catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, errors: ["invalid JSON"] })); return; }
          const result = await writeManifestValidated(mfDir, parsed, repoRoot);
          res.writeHead(result.ok ? 200 : 400, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }
        res.writeHead(405); res.end(); return;
      }

      const out = await serveStatic(url, base);
      res.writeHead(out.status, { "content-type": out.type, "cache-control": "no-cache" });
      res.end(out.body);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("engine error");
    }
  });

  const wanted = opts.port ?? (Number(process.env.ENGINE_PORT) || 8787);
  const port = await listen(server, wanted);
  const url = `http://${HOST}:${port}`;
  return {
    url, port, hub,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Try the wanted port; on EADDRINUSE fall back to an OS-assigned ephemeral port.
function listen(server: http.Server, wanted: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onErr = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && wanted !== 0) {
        server.removeListener("error", onErr);
        server.listen(0, HOST, () => resolve((server.address() as any).port));
      } else reject(err);
    };
    server.once("error", onErr);
    server.listen(wanted, HOST, () => resolve((server.address() as any).port));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp_server && node --test engine-server.test.ts`
Expected: PASS (2 tests). The SSE test reads one chunk after a broadcast.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/engine-server.ts mcp_server/engine-server.test.ts
git commit -m "feat(engine): localhost HTTP server (static + manifest API + SSE)"
```

---

## Task 6: Wire the engine into the MCP server (`mcp_server/index.ts`)

**Files:**
- Modify: `mcp_server/index.ts` (imports near line 26–33; `runPlan` at 112–123; tool list at 234; tool handler at 551; `main()` at 765)
- Test: extend `mcp_server/engine-integration.test.ts` (created in Task 8) — for this task, a focused unit test of the broadcast hook is added inline here.

**Interfaces:**
- Consumes: `startEngineServer` (Task 5), `planToDisplayEvent` (Task 4), `SseHub` (Task 1).
- Produces: a module-level `let engineHub: SseHub | null = null;` set in `main()`; `runPlan` broadcasts after computing the board action; a `matrix_studio` tool returning the engine URL.

- [ ] **Step 1: Write the failing test**

```ts
// mcp_server/runplan-broadcast.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planToDisplayEvent } from "./display-event.ts";
import { SseHub } from "./sse.ts";

// This documents the contract Task 6 wires into runPlan: every non-noop plan, after the
// board POST, produces a DisplayEvent that is broadcast. We assert the mapping + that a
// connected client receives it (the integration in Task 8 exercises the real runPlan).
test("a frames plan broadcasts a frames DisplayEvent to clients", () => {
  const hub = new SseHub();
  const seen: string[] = [];
  hub.addClient({ write: (c: string) => seen.push(c) });
  const wire = { frames: ["A"], frame_ms: 150, loop: 0 };
  hub.broadcast(planToDisplayEvent({ kind: "frames", name: "done", brightness: 5 }, wire));
  assert.match(seen[0], /"kind":"frames"/);
  assert.match(seen[0], /"name":"done"/);
});
```

Run: `cd mcp_server && node --test runplan-broadcast.test.ts` → Expected PASS immediately (it uses only Tasks 1+4). This test pins the contract; the wiring below makes `runPlan` honor it.

- [ ] **Step 2: Add imports** (near line 27, after the `engine.js` import)

```ts
import { startEngineServer } from "./engine-server.js";
import { planToDisplayEvent } from "./display-event.js";
import type { SseHub } from "./sse.js";
```

- [ ] **Step 3: Add the module-level hub** (near line 109, beside `renderCtx`)

```ts
// The engine's SSE hub, set once the HTTP server starts in main(). null until then (and
// in any non-engine context); broadcasts are best-effort and never block a board render.
let engineHub: SseHub | null = null;
```

- [ ] **Step 4: Broadcast inside `runPlan`** — replace the body at `index.ts:112-123` with:

```ts
async function runPlan(plan: RenderPlan): Promise<string> {
  if (plan.kind === "noop") return "no binding";
  if (plan.brightness != null) await post("/api/brightness", { level: plan.brightness });
  if (plan.kind === "animation") {
    const r = await post("/api/display/animation", { type: plan.type, ...plan.params, transient: true });
    engineHub?.broadcast(planToDisplayEvent(plan));
    return r.ok ? `${plan.type} (transient anim)` : `anim error ${r.status}`;
  }
  const expr = CANNED[plan.name] ?? (await loadSavedExpression(plan.name));
  if (!expr) return `no glyph for "${plan.name}"`;
  const wire = expressionToWire(expr);
  const r = await post("/api/display/frames", wire);
  engineHub?.broadcast(planToDisplayEvent(plan, wire));
  return r.ok ? plan.name : `frames error ${r.status}`;
}
```

(Only change vs current: compute `wire` once, and the two `engineHub?.broadcast(...)` lines. The board POST behavior is byte-identical.)

- [ ] **Step 5: Add the `matrix_studio` tool to the ListTools array** (inside the array returned at `index.ts:234`)

```ts
{
  name: "matrix_studio",
  description:
    "Get the local URL of the Expression Studio served by this engine (open it in a browser to see the live virtual board mirror the display, and to view/edit the animation library). Returns the URL or a note if the engine HTTP server is not running.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
},
```

- [ ] **Step 6: Handle `matrix_studio` in the CallTool switch** (at `index.ts:551`, add a case)

```ts
if (name === "matrix_studio") {
  const text = engineUrl
    ? `Expression Studio: ${engineUrl}/studio/index.html\nVirtual board (live mirror): ${engineUrl}/studio/board.html`
    : "Engine HTTP server is not running (no Studio URL).";
  return { content: [{ type: "text", text }] };
}
```

Add the module-level `let engineUrl: string | null = null;` beside `engineHub` (Step 3).

- [ ] **Step 7: Start the engine in `main()`** — replace `index.ts:765-769`:

```ts
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    const eng = await startEngineServer({ mcpDir: MCP_DIR });
    engineHub = eng.hub;
    engineUrl = eng.url;
    await writeFile(path.join(MCP_DIR, ".engine-url"), eng.url, "utf8").catch(() => {});
    console.error("Engine Studio on", `${eng.url}/studio/index.html`);
  } catch (e) {
    console.error("Engine HTTP server failed to start (MCP tools still work):", (e as Error).message);
  }
  console.error("ESP32 Matrix MCP server running. Board:", BOARD_URL);
}
```

- [ ] **Step 8: Build + run the focused test + typecheck**

Run: `cd mcp_server && node --test runplan-broadcast.test.ts` → PASS.
Run: `cd mcp_server && npx tsc --project tsconfig.json` → Expected: no errors (confirms the new imports + `engineHub`/`engineUrl` usages typecheck).

- [ ] **Step 9: Commit**

```bash
git add mcp_server/index.ts mcp_server/runplan-broadcast.test.ts
git commit -m "feat(engine): start the HTTP engine in main(), broadcast renders, add matrix_studio tool"
```

---

## Task 7: The virtual board page (`studio/board.js` + `studio/board.html`)

**Files:**
- Create: `studio/board.js`, `studio/board.html`
- Test: `studio/board.test.js`

**Interfaces:**
- Consumes: `DisplayEvent` shape from the SSE stream; `Panel` from `../shared/render.js`; `makeWebSimRenderer` from `../shared/renderers/web-sim.js`; `FIRMWARE_SIMS` from `../shared/firmware-sims.js`; expression JSON via `fetch` (the engine serves `/mcp_server/expressions/<name>.json`? — NO: the virtual board renders frames from the `wire` already in the event for the frames path, and from `FIRMWARE_SIMS` for the animation path. It never needs to fetch expression files.).
- Produces: `applyEvent(event, { panel, webSim })` — PURE dispatch: `frames` → `panel.setFrames(framesFromWire(event.wire), event.wire.frame_ms)`; `animation` → `webSim.render(event.type)` (plays the JS firmware sim if one exists, else no-op); `noop` → no-op. Plus `framesFromWire(wire)` converting the `["RRGGBB"×64", …]` rows back to `Panel` `Frame` arrays (`{x,y,r,g,b}` for lit pixels).

> **Why no fetch:** the `frames` event already carries the exact wire payload the board got (`expressionToWire` output: `{frames:[hex…], frame_ms, loop}`). The virtual board decodes that directly — identical pixels to the hardware, no asset loading, works for canned + saved alike.

- [ ] **Step 1: Write the failing test**

```js
// studio/board.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { framesFromWire, applyEvent } from "./board.js";

// one all-off frame except pixel (0,0) red: 64 hex strings
function wireOneRed() {
  const cells = Array.from({ length: 64 }, (_, i) => (i === 0 ? "ff0000" : "000000"));
  return { frames: [cells.join("")], frame_ms: 150, loop: 0 };
}

test("framesFromWire decodes lit pixels row-major, drops off pixels", () => {
  const frames = framesFromWire(wireOneRed());
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], [{ x: 0, y: 0, r: 255, g: 0, b: 0 }]);
});

test("applyEvent frames -> panel.setFrames with decoded frames + frame_ms", () => {
  const calls = [];
  const panel = { setFrames: (f, ms) => calls.push(["frames", f, ms]) };
  applyEvent({ kind: "frames", wire: wireOneRed() }, { panel, webSim: { render() {} } });
  assert.equal(calls[0][0], "frames");
  assert.equal(calls[0][2], 150);
  assert.deepEqual(calls[0][1][0], [{ x: 0, y: 0, r: 255, g: 0, b: 0 }]);
});

test("applyEvent animation -> webSim.render(type)", () => {
  const seen = [];
  applyEvent({ kind: "animation", type: "fire" }, { panel: {}, webSim: { render: (n) => seen.push(n) } });
  assert.deepEqual(seen, ["fire"]);
});

test("applyEvent noop does nothing", () => {
  assert.doesNotThrow(() => applyEvent({ kind: "noop" }, { panel: {}, webSim: { render() {} } }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test studio/board.test.js`
Expected: FAIL — `Cannot find module './board.js'`.

- [ ] **Step 3: Write `studio/board.js`**

```js
// studio/board.js — the virtual board's PURE event dispatch (unit-tested) + the browser
// EventSource glue (skipped under node --test). A frames event carries the exact wire the
// hardware got; we decode it to Panel frames. An animation event plays the JS firmware sim
// via the shared web-sim renderer (no-op if that firmware has no JS port).

// Decode expressionToWire() output -> Panel Frame[] (array of {x,y,r,g,b} for lit pixels).
export function framesFromWire(wire) {
  if (!wire || !Array.isArray(wire.frames)) return [];
  return wire.frames.map((row) => {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const hex = row.slice(i * 6, i * 6 + 6);
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      if (r || g || b) out.push({ x: i % 8, y: (i / 8) | 0, r, g, b });
    }
    return out;
  });
}

export function applyEvent(event, { panel, webSim }) {
  if (!event || event.kind === "noop") return;
  if (event.kind === "frames") { panel.setFrames(framesFromWire(event.wire), event.wire?.frame_ms || 150); return; }
  if (event.kind === "animation") { webSim.render(event.type); return; }
}

// --- browser glue (not exercised under node --test; guarded so the import is test-safe) ---
export function connectBoard({ panel, webSim, source }) {
  source.onmessage = (m) => {
    try { applyEvent(JSON.parse(m.data), { panel, webSim }); } catch { /* ignore malformed */ }
  };
  return source;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test studio/board.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `studio/board.html`** (the DOM shell — manual smoke, not unit-tested)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Virtual Board — Expression Studio</title>
  <style>
    body { margin: 0; background: #060608; display: grid; place-items: center; height: 100vh; }
    canvas { width: min(80vmin, 560px); height: min(80vmin, 560px); border-radius: 12px;
      box-shadow: 0 0 60px var(--glow, rgba(255,80,8,.35)); image-rendering: pixelated; }
  </style>
</head>
<body>
  <canvas id="board" width="512" height="512"></canvas>
  <script type="module">
    import { Panel } from "../shared/render.js";
    import { makeWebSimRenderer } from "../shared/renderers/web-sim.js";
    import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
    import { resolveExpression } from "../shared/expressions.js";
    import { connectBoard } from "./board.js";

    const cv = document.getElementById("board");
    const panel = new Panel(cv, { device: cv });
    const webSim = makeWebSimRenderer({ panel, loadExpression: () => null, firmwareSims: FIRMWARE_SIMS });

    // drive the panel's animation clock
    let last = performance.now();
    (function loop(now) { panel.tick(now - last, now); last = now; requestAnimationFrame(loop); })(last);

    connectBoard({ panel, webSim, source: new EventSource("/events") });
  </script>
</body>
</html>
```

- [ ] **Step 6: Manual browser smoke** (record the result; do not block the commit on hardware)

With the engine running (`cd mcp_server && npx tsx index.ts` in a scratch shell, or after Task 8's build), open `http://127.0.0.1:8787/studio/board.html`. In another terminal, trigger a render (`matrix_express` via the MCP, or `curl` the broadcast path once Task 8's integration is in). Expected: the canvas lights up with the same glyph the board shows. Note any gaps (e.g. firmware anims without a JS sim show nothing — expected, logged as a known limit).

- [ ] **Step 7: Commit**

```bash
git add studio/board.js studio/board.html studio/board.test.js
git commit -m "feat(studio): live virtual board page driven by the engine SSE stream"
```

---

## Task 8: Packaging + end-to-end integration (capstone)

**Files:**
- Modify: `scripts/copy-shared-runtime.mjs`, `scripts/copy-shared-runtime.test.js` (or `.test.ts`), `.gitignore`, `package.json` (root `build:mcpb`/order), `mcp_server/manifest.json`
- Create: `mcp_server/engine-integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a packed `.mcpb` whose engine serves the Studio offline; an integration test booting the real engine on an ephemeral port.

- [ ] **Step 1: Stage the Studio tree for the bundle** — extend `scripts/copy-shared-runtime.mjs`

After the existing shared-runtime copy, add a copy of the Studio tree into `mcp_server/studio-dist/`:

```js
// ... after the existing FILES copy into mcp_server/shared-runtime/ ...
import { cp, mkdir } from "node:fs/promises";   // (ensure these are imported at top)

const REPO = path.join(MCP_DIR, "..");          // adjust to the script's existing repo-root var
const distRoot = path.join(MCP_DIR, "studio-dist");
await mkdir(distRoot, { recursive: true });
// the virtual board imports ../shared/*, so stage BOTH studio/ and shared/ under studio-dist/
await cp(path.join(REPO, "studio"), path.join(distRoot, "studio"), { recursive: true });
await cp(path.join(REPO, "shared"), path.join(distRoot, "shared"), { recursive: true });
console.error("[copy-shared-runtime] staged studio-dist/{studio,shared}");
```

> Adapt variable names to the file's existing style (it already computes `MCP_DIR` and the source `shared/` path). The key outcome: `mcp_server/studio-dist/studio/board.html` and `mcp_server/studio-dist/shared/render.js` exist after the script runs.

- [ ] **Step 2: Update the copy-shared-runtime test** to assert the staged Studio files

Add assertions (matching the test's existing structure) that after running the copy, these exist:
`mcp_server/studio-dist/studio/index.html`, `mcp_server/studio-dist/studio/board.html`, `mcp_server/studio-dist/shared/render.js`.

Run: `node --test scripts/copy-shared-runtime.test.js` → Expected: FAIL first (files not staged), then PASS after Step 1 is in.

- [ ] **Step 3: gitignore the generated trees**

Append to `.gitignore`:

```
mcp_server/studio-dist/
mcp_server/.engine-url
```

Confirm: `git status --porcelain mcp_server/studio-dist` shows nothing after a build.

- [ ] **Step 4: Ensure gallery data is fresh before packing** — in root `package.json`, prepend `build:gallery` to `build:mcpb`:

Change `build:mcpb` to start with `node scripts/build-gallery-data.mjs && ` (so `studio/gallery-data.json` exists to stage), keeping the rest of the command intact.

- [ ] **Step 5: Write the integration test**

```ts
// mcp_server/engine-integration.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startEngineServer } from "./engine-server.ts";
import { planToDisplayEvent } from "./display-event.ts";

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(MCP_DIR, "..");

test("engine serves board.html + a broadcast reaches a live SSE client", async () => {
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  after(() => eng.close());

  // the virtual board page is served
  const board = await fetch(`${eng.url}/studio/board.html`);
  assert.equal(board.status, 200);
  assert.match(await board.text(), /EventSource\("\/events"\)/);

  // a frames render (as runPlan would emit) reaches a connected client
  const res = await fetch(`${eng.url}/events`, { headers: { accept: "text/event-stream" } });
  const reader = res.body!.getReader();
  await new Promise((r) => setTimeout(r, 50));
  const wire = { frames: ["00".repeat(0) + "ff0000" + "000000".repeat(63)], frame_ms: 120, loop: 0 };
  eng.hub.broadcast(planToDisplayEvent({ kind: "frames", name: "smiley" }, wire));
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /"name":"smiley"/);
  assert.match(text, /"frame_ms":120/);
  await reader.cancel();
});

test("manifest round-trips through the live engine into a TEMP file (side-effect-free)", async () => {
  // copy the real manifest into a temp dir and point the engine there, so the PUT never
  // touches the tracked shared/manifest.json. repoRoot stays the real repo (for the
  // validator's collectAnimationNames, which scans expressions/bored dirs).
  const tmp = await mkdtemp(path.join(os.tmpdir(), "eng-mf-"));
  await cp(path.join(REPO_ROOT, "shared", "manifest.json"), path.join(tmp, "manifest.json"));
  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0, manifestDir: tmp, repoRoot: REPO_ROOT });
  after(() => eng.close());
  const m = await (await fetch(`${eng.url}/api/manifest`)).json();
  const put = await fetch(`${eng.url}/api/manifest`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(m),
  });
  assert.equal(put.status, 200);
  assert.equal((await put.json() as any).ok, true);
});
```

- [ ] **Step 6: Run the full suite + build the bundle**

Run: `npm test`
Expected: all green (existing 122 + the new engine tests), `manifest OK` first.

Run: `npm run build:mcpb`
Expected: completes; `release/esp32-matrix.mcpb` produced.

Verify the Studio is inside the pack:
Run: `cd "$(mktemp -d)" && unzip -l "<repo>/release/esp32-matrix.mcpb" | grep -E "studio-dist/(studio|shared)/(board.html|render.js)"`
Expected: both paths listed.

- [ ] **Step 7: Update the `.mcpb` manifest description** — `mcp_server/manifest.json`, append to `description`: ` Also serves the Expression Studio + a live virtual board at a local URL (use the matrix_studio tool for the link).`

- [ ] **Step 8: Commit**

```bash
git add scripts/copy-shared-runtime.mjs scripts/copy-shared-runtime.test.js .gitignore package.json mcp_server/manifest.json mcp_server/engine-integration.test.ts
git commit -m "build(engine): stage Studio into the .mcpb + engine integration tests"
```

---

## Risks & fallback

- **Linchpin (localhost binding inside Claude Desktop's `.mcpb` sandbox).** Per the user's decision, we build assuming a plain Node `http` server binds `127.0.0.1` (it should). **Validated at the end** by the manual checklist below. **Fallback if it cannot bind:** ship the Studio as static files the user opens from disk, talking to the engine over the same localhost API — but if the sandbox forbids *all* port binding, the live virtual board degrades to the Pages showcase (Plan 5) demo; the MCP tools + board are unaffected (the engine start is wrapped in try/catch in `main()`, so a bind failure never breaks the server).
- **Firmware anims without a JS sim** (only 7 of the firmware set are ported in `firmware-sims.js`): the virtual board no-ops on those `animation` events. Acceptable for v1; note as a known limit (a future task can port the rest or render a label).
- **Brightness on the virtual board:** v1 ignores `event.brightness` on the canvas (the bloom renderer has no dim stage). Known cosmetic gap; the real board still dims.

## Manual validation checklist (run at the end — the linchpin + the live experience)

D-style, on the user's machine (Claude Desktop for the linchpin; a browser for the board):
1. **Engine boots:** after `npm run build:mcpb` + installing the `.mcpb` in Claude Desktop, the MCP `matrix_studio` tool returns a `http://127.0.0.1:<port>/...` URL (and stderr logged "Engine Studio on …").
2. **Studio serves:** opening the URL shows the existing Studio gallery (served by the engine, not a file:// path).
3. **Linchpin confirmed:** the page loads over `http://127.0.0.1:<port>` from inside the Desktop-installed extension. (If it fails → fallback above.)
4. **Live virtual board:** open `/studio/board.html`; fire `matrix_express("party")` / `presence_set` / submit prompts — the canvas mirrors the board glyph-for-glyph (and works with the hardware unplugged).
5. **Manifest API:** `GET /api/manifest` returns JSON; a PUT of a deliberately-invalid manifest returns `400 {ok:false,errors}` and does NOT change the file.
6. **No regression:** the real board still renders exactly as before (the broadcast is additive); MCP tools unaffected if the engine port is taken (ephemeral fallback) or fails (try/catch).

---

## Self-Review

**Spec coverage (§7 packaging, §10 scope "the engine"):**
- "serves the Studio UI at localhost" → Tasks 2, 5, 6 (static server + boot). ✓
- "reads/writes the ONE manifest.json" → Task 3 (validated API) + Task 5 (routes). ✓
- "dispatches a fired intent to virtual board over [push]" → Tasks 1, 4, 6, 7 (hub + event + runPlan broadcast + page). ✓
- "no other software to install" (`.mcpb`) → Task 8 (stage Studio into the bundle, zero new dep). ✓
- "validate localhost binding first" → deferred to end per the user's explicit decision; risks section + manual checklist hold it. ✓ (deviation is user-authorized)
- "WebSocket" → implemented as SSE per Decision D1 (one-way push, zero-dep); flagged for user review. ✓ (intent met, wording deviated with rationale)
- Two front doors / Pages showcase / assigning the 40 → **out of scope** for Plan 4 (Decision D5; Plans 5 & 6). ✓

**Placeholder scan:** no TBD/"handle errors"/"similar to"; every code step has complete code; every run step has an expected result. ✓ (Task 3 Step 1 and Task 8 Step 5 contain explicit implementer decision points with the exact alternative spelled out — not placeholders.)

**Type consistency:** `DisplayEvent` (Task 1) is consumed identically in Tasks 4, 7, 8; `RenderPlan` matches `engine.ts`; `startEngineServer` return shape `{url,port,hub,close}` is used consistently in Tasks 5, 6, 8; `applyEvent(event,{panel,webSim})` signature matches between `board.js` and its test. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-trigger-manifest-plan4-engine.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. (Same model that worked for Plans 3a/3b: SONNET implementers for these edit/logic tasks, SONNET reviewers, OPUS final whole-plan review to catch cross-task seams.)

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
