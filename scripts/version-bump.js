// Bump the canonical VERSION, stamp every artifact, and commit.
//
//   npm run bump:patch | bump:minor | bump:major
//
// Deliberate, manual, you run it when a change is worth a release. It does
// NOT push or flash; you still flash/upload/reconnect to make the bump live on
// each artifact (that's the whole point of the drift check).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { nextVersion } from "./version-lib.js";
import { readVersion, stamp } from "./version-stamp.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STAMPED_FILES = [
  "VERSION",
  "esp32_matrix_webserver/version.h",
  "esp32_matrix_webserver/data/version.json",
  "mcp_server/package.json",
];

async function main() {
  const type = process.argv[2];
  if (!["major", "minor", "patch"].includes(type)) {
    console.error("Usage: node scripts/version-bump.js <major|minor|patch>");
    process.exit(2);
  }

  const current = await readVersion(REPO_ROOT);
  const next = nextVersion(current, type);

  await writeFile(path.join(REPO_ROOT, "VERSION"), next + "\n", "utf8");
  await stamp(next, REPO_ROOT);

  // Stage + commit only the version-controlled stamp targets (data/version.json
  // is gitignored-free; it IS committed so the web bundle's version is tracked).
  execFileSync("git", ["add", ...STAMPED_FILES], { cwd: REPO_ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore: bump v${next}`], { cwd: REPO_ROOT, stdio: "inherit" });

  console.log(`Bumped ${current} → ${next}. Now flash + LittleFS-upload + reconnect to make it live, then \`npm run check\`.`);
}

main();
