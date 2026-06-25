import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PY_TEST = join(ROOT, "claude-hooks", "test_manifest_resolver.py");

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

test("JS/Python resolver parity (skips if no python)", (t) => {
  const py = findPython();
  if (!py) { t.skip("python not found"); return; }
  const r = spawnSync(py, [PY_TEST], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("parity failed:\n" + (r.stdout || "") + (r.stderr || ""));
});
