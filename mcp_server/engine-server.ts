// mcp_server/engine-server.ts, the engine's localhost HTTP face. Coexists with the MCP
// stdio transport (separate channel). Serves the Studio tree, a validated manifest API,
// and an SSE stream of DisplayEvents to virtual boards. Binds 127.0.0.1 ONLY.
import http from "node:http";
import { SseHub } from "./sse.js";
import { resolveStaticBase, serveStatic } from "./static-files.js";
import { readManifest, writeManifestValidated } from "./manifest-api.js";
import { writeExpressionValidated, setApprovalValidated } from "./expression-api.js";
import { engineDir } from "./engine.js";   // repo-first ../shared, else mcpDir/shared-runtime
import path from "node:path";

const HOST = "127.0.0.1";

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startEngineServer(opts: { mcpDir: string; port?: number; manifestDir?: string; repoRoot?: string; boardUrl?: string }) {
  const { mcpDir } = opts;
  const hub = new SseHub();
  const base = resolveStaticBase(mcpDir);
  const mfDir = opts.manifestDir ?? engineDir(mcpDir);   // shared/ in dev, shared-runtime/ when packed
  const repoRoot = opts.repoRoot ?? path.join(mcpDir, "..");   // for the validator (validateManifest + collectAnimationNames)
  const boardUrl = opts.boardUrl;
  // In-memory presence fallback store: the hooks mirror their lifecycle presence here (POST), so a
  // user with NO board still sees presence on the engine-served card. The board stays source-of-truth
  // when reachable; this is only consulted as a fallback. Volatile (RAM), like the board's own store.
  let storedPresence: Record<string, unknown> | null = null;

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

      if (url.startsWith("/api/expression/")) {
        if (method !== "PUT") { res.writeHead(405); res.end(); return; }
        const name = decodeURIComponent(url.slice("/api/expression/".length).split("?")[0]);
        let expr: unknown;
        try { expr = JSON.parse(await readBody(req)); }   // readBody: the same helper the manifest PUT uses
        catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, errors: ["invalid JSON body"] })); return; }
        const result = await writeExpressionValidated({
          name, expr,
          expressionsDir: path.join(mcpDir, "expressions"),
          validatorPath: path.join(repoRoot, "scripts", "check-expression.mjs"),
          generatorPath: path.join(repoRoot, "scripts", "build-gallery-data.mjs"),
          cannedPath: path.join(mcpDir, "dist", "expressions.js"),
          manifestPath: path.join(mfDir, "manifest.json"),
          boredDir: path.join(repoRoot, "claude-hooks", "bored_animations"),
          approvedPath: path.join(base, "studio", "approved.json"),
          galleryDataPath: path.join(base, "studio", "gallery-data.json"),
        });
        const status = result.ok ? 200 : (result as any).status;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.ok ? { ok: true } : { ok: false, errors: (result as any).errors }));
        return;
      }

      if (url.startsWith("/api/approval/")) {
        if (method !== "POST") { res.writeHead(405); res.end(); return; }
        const name = decodeURIComponent(url.slice("/api/approval/".length).split("?")[0]);
        let body: any;
        try { body = JSON.parse(await readBody(req)); }
        catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, errors: ["invalid JSON body"] })); return; }
        const result = await setApprovalValidated({
          name, approved: body?.approved,
          expressionsDir: path.join(mcpDir, "expressions"),
          approvalHelperPath: path.join(repoRoot, "scripts", "approval.mjs"),
          generatorPath: path.join(repoRoot, "scripts", "build-gallery-data.mjs"),
          cannedPath: path.join(mcpDir, "dist", "expressions.js"),
          manifestPath: path.join(mfDir, "manifest.json"),
          boredDir: path.join(repoRoot, "claude-hooks", "bored_animations"),
          approvedPath: path.join(base, "studio", "approved.json"),
          galleryDataPath: path.join(base, "studio", "gallery-data.json"),
        });
        const status = result.ok ? 200 : (result as any).status;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.ok ? { ok: true, approved: (result as any).approved } : { ok: false, errors: (result as any).errors }));
        return;
      }

      if (url.startsWith("/api/framebuffer")) {
        if (!boardUrl) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false })); return; }
        try {
          const fb = await fetch(`${boardUrl}/api/display/framebuffer`, { signal: AbortSignal.timeout(1500) });
          if (!fb.ok) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false })); return; }
          const body = await fb.text();
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
          res.end(body);
        } catch {
          res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false }));
        }
        return;
      }

      if (url.startsWith("/api/presence")) {
        if (method === "POST") {
          // Localhost relay (like POST /api/render): the hooks mirror their lifecycle presence here
          // so a no-board user's card still updates. Save it as the engine's last-known presence;
          // stamp ts (epoch seconds, matching the board) if the body doesn't carry one.
          let msg: any;
          try { msg = JSON.parse(await readBody(req)); }
          catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false })); return; }
          // Mirror the board's POST contract: must be an object carrying a non-empty string intent.
          // (Also avoids a strict-mode TypeError stamping ts onto a primitive, which would 500.)
          if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.intent !== "string" || msg.intent.length === 0) {
            res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false })); return;
          }
          if (msg.ts == null) msg.ts = Math.floor(Date.now() / 1000);
          storedPresence = msg;
          res.writeHead(204); res.end();
          return;
        }
        if (method !== "GET") { res.writeHead(405); res.end(); return; }   // only GET/POST (mirrors /api/manifest)
        // GET: board is source-of-truth when reachable; else fall back to the stored presence; else
        // 503 (honest "no source" so the card's no-presence messaging still works). Mirrors
        // /api/framebuffer but with the store fallback added.
        if (boardUrl) {
          try {
            // 3000ms (not 1500): the board stalls ~every 12s (GC/render) and a poll caught in a stall
            // exceeds 1500ms → a spurious 503 that blanks the live card. 3000ms rides the stall.
            const pr = await fetch(`${boardUrl}/api/presence`, { signal: AbortSignal.timeout(3000) });
            if (pr.ok) {
              const body = await pr.text();
              res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
              res.end(body);
              return;
            }
            // board reachable but errored → fall through to the store
          } catch {
            // board unreachable → fall through to the store
          }
        }
        if (storedPresence) {
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
          res.end(JSON.stringify(storedPresence));
          return;
        }
        res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false }));
        return;
      }

      if (url.startsWith("/api/render")) {
        // Receive an already-resolved DisplayEvent (from the Claude Code hook, which renders to the
        // board directly) and fan it out to the SSE virtual boards, so board.html shows hook-driven
        // renders even with NO board. Localhost-only (the server binds 127.0.0.1); best-effort relay.
        try {
          const ev = JSON.parse(await readBody(req));
          hub.broadcast(ev);
          res.writeHead(204); res.end();
        } catch {
          res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false }));
        }
        return;
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
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections(); // forcibly end keep-alive / SSE connections (Node 18.2+)
      server.close(() => resolve());
    }),
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
