// mcp_server/engine-server.ts — the engine's localhost HTTP face. Coexists with the MCP
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
        // Relay the board's current PresenceMessage so the engine-served presence card can show
        // live presence without talking to the board directly. Mirrors /api/framebuffer; the board
        // stays the presence source (presence_set posts there). No board -> 503, card fails closed.
        if (!boardUrl) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false })); return; }
        try {
          const pr = await fetch(`${boardUrl}/api/presence`, { signal: AbortSignal.timeout(1500) });
          if (!pr.ok) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false })); return; }
          const body = await pr.text();
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
          res.end(body);
        } catch {
          res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ reachable: false }));
        }
        return;
      }

      if (url.startsWith("/api/render")) {
        // Receive an already-resolved DisplayEvent (from the Claude Code hook, which renders to the
        // board directly) and fan it out to the SSE virtual boards — so board.html shows hook-driven
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
