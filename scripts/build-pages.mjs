// scripts/build-pages.mjs — assemble the read-only static showcase bundle for GitHub Pages.
// Mirrors the repo-root dev layout (studio/ + shared/ as siblings) so every relative import the
// studio + landing already use (`../shared/`, `./gallery-data.json`) resolves unchanged. Only the
// landing moves up a level (site/index.html -> bundle root), so only its `../studio/` and
// `../shared/` references are rewritten. Pure node built-ins; no dependencies.
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pure: rewrite the landing's sibling-relative links for life at the bundle root.
// site/index.html lives in site/, so it references ../studio/ and ../shared/. At the
// bundle root those are simply studio/ and shared/.
export function rewriteLandingPaths(html) {
  return html.replaceAll("../studio/", "studio/").replaceAll("../shared/", "shared/");
}

export function buildPages({ repoRoot = REPO_ROOT, outDir = path.join(REPO_ROOT, "pages-dist") } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. studio/ and shared/ copied as siblings (preserve the dev layout so ../shared resolves)
  cpSync(path.join(repoRoot, "studio"), path.join(outDir, "studio"), { recursive: true });
  cpSync(path.join(repoRoot, "shared"), path.join(outDir, "shared"), { recursive: true });

  // 2. landing at the clean bundle root, its sibling paths rewritten
  const landing = readFileSync(path.join(repoRoot, "site", "index.html"), "utf8");
  writeFileSync(path.join(outDir, "index.html"), rewriteLandingPaths(landing), "utf8");

  // 3. disable Jekyll so no file/dir is silently dropped or transformed
  writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");

  return outDir;
}

// CLI entry — guarded so importing this module in a test does not run the build.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = buildPages();
  console.log(`pages bundle written to ${out}`);
}
