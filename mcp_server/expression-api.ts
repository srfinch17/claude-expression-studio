// mcp_server/expression-api.ts, the engine's frame-expression write surface. Mirrors
// manifest-api.ts: writes are VALIDATED through the same shared validator the editor uses
// (scripts/check-expression.mjs), the source JSON is written to mcp_server/expressions/, the
// edited name is removed from studio/approved.json (edit -> orange), and studio/gallery-data.json
// is regenerated in-process via buildGalleryData so the studio reflects the edit immediately.
// Edit-only: an unknown name is rejected (no creating new expressions here).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface ExprWriteOpts {
  name: string;
  expr: unknown;
  expressionsDir: string;
  validatorPath: string;
  generatorPath: string;
  cannedPath: string;
  manifestPath: string;
  boredDir: string;
  approvedPath: string;
  galleryDataPath: string;
}

type Result = { ok: true } | { ok: false; status: number; errors: string[] };

export async function writeExpressionValidated(opts: ExprWriteOpts): Promise<Result> {
  const file = path.join(opts.expressionsDir, `${opts.name}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, errors: [`unknown expression: ${opts.name}`] };

  const { validateExpression } = await import(pathToFileURL(opts.validatorPath).href);
  const errors: string[] = validateExpression(opts.name, opts.expr);
  if (errors.length) return { ok: false, status: 400, errors };

  // 1. write the source JSON (pretty, 2-space), NO trailing newline, matching the canonical
  //    MCP save_as writer (index.ts) and the existing expressions/*.json, so an edit doesn't flip EOF.
  await writeFile(file, JSON.stringify(opts.expr, null, 2), "utf8");

  // 2. un-approve (edit -> pending re-review / orange)
  try {
    const approved = JSON.parse(await readFile(opts.approvedPath, "utf8"));
    approved.approved = (approved.approved || []).filter((n: string) => n !== opts.name);
    await writeFile(opts.approvedPath, JSON.stringify(approved, null, 2) + "\n", "utf8");
  } catch { /* if approved.json is missing, nothing to un-approve */ }

  // 3. regenerate studio/gallery-data.json in-process (matches the CLI output exactly)
  await regenerateGalleryData(opts);

  return { ok: true };
}

// Shared gallery-data regen used by both write surfaces. Reads the compiled canned module + the
// manifest + bored dir + approved.json via the dynamic-imported generator, and writes the studio
// artifact with the SAME bytes the CLI `npm run build:gallery` produces (no trailing newline).
async function regenerateGalleryData(opts: {
  generatorPath: string; cannedPath: string; expressionsDir: string;
  manifestPath: string; boredDir: string; approvedPath: string; galleryDataPath: string;
}): Promise<void> {
  const gen = await import(pathToFileURL(opts.generatorPath).href);
  const canned = await gen.loadCanned(opts.cannedPath);
  const data = gen.buildGalleryData({
    canned, savedDir: opts.expressionsDir, manifestPath: opts.manifestPath,
    boredDir: opts.boredDir, approvedPath: opts.approvedPath,
  });
  await writeFile(opts.galleryDataPath, JSON.stringify(data, null, 2), "utf8");
}

export interface ApprovalOpts {
  name: string;
  approved: boolean;
  expressionsDir: string;
  approvalHelperPath: string;
  generatorPath: string;
  cannedPath: string;
  manifestPath: string;
  boredDir: string;
  approvedPath: string;
  galleryDataPath: string;
}

// Mark a saved expression approved (green) or not (orange). Edit-only: an unknown name is 404.
// Idempotent via the pure setApproval helper. Persists approved.json + regenerates gallery-data.
export async function setApprovalValidated(
  opts: ApprovalOpts,
): Promise<{ ok: true; approved: boolean } | { ok: false; status: number; errors: string[] }> {
  const file = path.join(opts.expressionsDir, `${opts.name}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, errors: [`unknown expression: ${opts.name}`] };
  if (typeof opts.approved !== "boolean") return { ok: false, status: 400, errors: ["'approved' must be a boolean"] };

  const { setApproval } = await import(pathToFileURL(opts.approvalHelperPath).href);
  let approvedObj: any;
  try { approvedObj = JSON.parse(await readFile(opts.approvedPath, "utf8")); }
  catch { approvedObj = { approved: [] }; }
  const next = setApproval(approvedObj, opts.name, opts.approved);
  await writeFile(opts.approvedPath, JSON.stringify(next, null, 2) + "\n", "utf8");

  await regenerateGalleryData(opts);
  return { ok: true, approved: opts.approved };
}
