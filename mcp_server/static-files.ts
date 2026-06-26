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
