import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The packed .mcpb contains only mcp_server/, so the MCP engine's resolver + manifest +
// firmware-name list must be copied in. Dev runs read ../shared directly (see engineDir),
// so this generated dir is gitignored. Keep the file list in sync with mcp_server/engine.ts.
const FILES = ["manifest.json", "resolver.js", "firmware-names.js"];

export function copySharedRuntime() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = join(root, "shared");
  const dst = join(root, "mcp_server", "shared-runtime");
  mkdirSync(dst, { recursive: true });
  for (const f of FILES) copyFileSync(join(src, f), join(dst, f));
  return dst;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dst = copySharedRuntime();
  console.log(`copied ${FILES.length} shared engine files -> ${dst}`);
}
