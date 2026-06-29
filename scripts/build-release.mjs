// Build a single flashable factory image for end users.
//
//   node scripts/build-release.mjs
//
// Reads the maintainer's Arduino "Export Compiled Binary" output + the ESP32
// core toolchain, builds a LittleFS image from data/, merges everything into
// release/esp32matrix-<version>-merged.bin, and writes the ESP Web Tools
// manifest. Offsets come from huge_app.csv, never hardcoded.
//
// ⛔ For a DISTRIBUTABLE build, export with secrets.h ABSENT — otherwise your
// WiFi credentials get compiled into the app AND the setup portal is removed
// (the image leaks your SSID/password and can't onboard anyone else). This
// script refuses if secrets.h is present; override with --allow-secrets for a
// personal build of your own board.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { glob } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_ROOT, "esp32_matrix_webserver", "data");
const INSTALL_DIR = path.join(REPO_ROOT, "install");
const BUILD_DIR = path.join(REPO_ROOT, "esp32_matrix_webserver", "build");
const SECRETS_H = path.join(REPO_ROOT, "esp32_matrix_webserver", "secrets.h");
const RELEASE_DIR = path.join(REPO_ROOT, "release");
const PKG_ESP32 = path.join(os.homedir(), "AppData", "Local", "Arduino15", "packages", "esp32");

/** Pick the path whose version-stamped directory sorts highest numerically. */
export function pickHighestVersionPath(paths) {
  const key = (p) => (p.match(/(\d+(?:\.\d+)+)/g)?.pop() ?? "0")
    .split(".").map(Number);
  return [...paths].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if ((kb[i] ?? 0) !== (ka[i] ?? 0)) return (kb[i] ?? 0) - (ka[i] ?? 0);
    }
    return 0;
  })[0];
}

async function globOne(root, pattern) {
  const hits = [];
  for await (const f of glob(pattern, { cwd: root })) hits.push(path.join(root, f));
  if (!hits.length) throw new Error(`Not found under ${root}: ${pattern}`);
  return pickHighestVersionPath(hits);
}

function readSpiffs(csv) {
  // huge_app.csv: "spiffs, data, spiffs, 0x310000,0xE0000,"
  const line = csv.split("\n").find((l) => /^\s*spiffs\s*,/.test(l));
  if (!line) throw new Error("no spiffs row in partition CSV");
  const cols = line.split(",").map((s) => s.trim());
  return { offset: cols[3], size: cols[4] };
}

async function main() {
  const version = (await readFile(path.join(REPO_ROOT, "VERSION"), "utf8")).trim();

  // ⛔ Distribution safety. If secrets.h is present, the Arduino export almost
  // certainly baked WiFi credentials into the app AND compiled out the captive
  // setup portal — that image leaks your SSID/password and can never onboard
  // another user's board. Refuse unless --allow-secrets (a personal build).
  const allowSecrets = process.argv.includes("--allow-secrets");
  if (existsSync(SECRETS_H) && !allowSecrets) {
    console.error(`
⛔ build-release halted — esp32_matrix_webserver/secrets.h is present.

   Your exported firmware almost certainly has your WiFi credentials BAKED IN
   (and skips the setup portal). That image is NOT safe to distribute: it leaks
   your SSID + password and can never onboard another user's board.

   To build a DISTRIBUTABLE image:
     1. Remove or rename esp32_matrix_webserver/secrets.h
     2. Re-run Arduino "Export Compiled Binary"  (WIFI_SSID undefined -> portal)
     3. node scripts/build-release.mjs

   To build a PERSONAL image for your own board (creds baked in, yours only):
     node scripts/build-release.mjs --allow-secrets
`);
    process.exit(2);
  }
  if (existsSync(SECRETS_H)) {
    console.warn("⚠ Building with secrets.h present (--allow-secrets): WiFi creds are baked in. Personal build only — do NOT distribute this .bin.\n");
  }

  await mkdir(RELEASE_DIR, { recursive: true });

  // 1. Locate the maintainer's exported app artifacts.
  const app = await globOne(BUILD_DIR, "**/*.ino.bin");
  const bootloader = await globOne(BUILD_DIR, "**/*.ino.bootloader.bin");
  const partitions = await globOne(BUILD_DIR, "**/*.ino.partitions.bin");

  // 2. Locate the core toolchain (env override wins).
  const toolsRoot = process.env.ESP32_TOOLS_DIR || PKG_ESP32;
  const esptool = await globOne(toolsRoot, "tools/esptool_py/**/esptool.exe");
  const mklittlefs = await globOne(toolsRoot, "tools/mklittlefs/**/mklittlefs.exe");
  const bootApp0 = await globOne(toolsRoot, "hardware/esp32/**/tools/partitions/boot_app0.bin");
  const csvPath = await globOne(toolsRoot, "hardware/esp32/**/tools/partitions/huge_app.csv");
  const { offset: fsOffset, size: fsSize } = readSpiffs(await readFile(csvPath, "utf8"));

  // 3. Build the LittleFS image from data/ at the partition's exact size.
  const fsBin = path.join(RELEASE_DIR, "littlefs.bin");
  execFileSync(mklittlefs, ["-c", DATA_DIR, "-p", "256", "-b", "4096", "-s", fsSize, fsBin], { stdio: "inherit" });

  // 4. Merge into one factory image.
  const merged = path.join(RELEASE_DIR, `esp32matrix-${version}-merged.bin`);
  execFileSync(esptool, [
    "--chip", "esp32s3", "merge-bin", "-o", merged,
    "--flash-mode", "dio", "--flash-freq", "80m", "--flash-size", "4MB",
    "0x0", bootloader, "0x8000", partitions, "0xe000", bootApp0,
    "0x10000", app, fsOffset, fsBin,
  ], { stdio: "inherit" });

  // 5. ESP Web Tools manifest.
  await writeFile(path.join(RELEASE_DIR, "manifest.json"), JSON.stringify({
    name: "ESP32-S3 Matrix",
    version,
    new_install_prompt_erase: true,
    builds: [{ chipFamily: "ESP32-S3", parts: [{ path: path.basename(merged), offset: 0 }] }],
  }, null, 2) + "\n", "utf8");

  // 6. The .mcpb is written straight into release/ by `npm run build:mcpb`; just
  //    warn if it hasn't been built yet so the release package isn't silently incomplete.
  const mcpb = path.join(RELEASE_DIR, "esp32-matrix.mcpb");
  if (!existsSync(mcpb)) console.warn("note: release/esp32-matrix.mcpb missing — run `npm run build:mcpb` too");

  // 7. Assemble a self-contained offline-flash package: the bundled esptool, the
  //    flash scripts, and the browser-install page all sit beside the merged .bin so
  //    flash.bat's %~dp0 lookup (esptool.exe + esp32matrix-*-merged.bin) just works.
  await copyFile(esptool, path.join(RELEASE_DIR, "esptool.exe"));
  for (const f of ["flash.bat", "flash.sh", "index.html"]) {
    await copyFile(path.join(INSTALL_DIR, f), path.join(RELEASE_DIR, f));
  }

  console.log(`\nRelease ready in release/:\n  ${path.basename(merged)}  (flash at 0x0)\n  esptool.exe  flash.bat  flash.sh   (offline flasher)\n  index.html  manifest.json          (browser flasher — needs https/Pages)\n  esp32-matrix.mcpb${existsSync(mcpb) ? "" : "  (MISSING — run build:mcpb)"}            (Claude Desktop extension)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("build-release failed:", e.message); process.exit(1); });
}
