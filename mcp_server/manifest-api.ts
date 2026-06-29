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
