import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { rewriteLandingPaths, buildPages } from "./build-pages.mjs";

test("rewriteLandingPaths strips ../ on sibling links", () => {
  const out = rewriteLandingPaths(
    `<a href="../studio/index.html">x</a><script>import "../shared/render.js";</script>`,
  );
  assert.ok(!out.includes("../studio"), "still has ../studio");
  assert.ok(!out.includes("../shared"), "still has ../shared");
  assert.ok(out.includes('href="./studio/index.html"'));
  assert.ok(out.includes('"./shared/render.js"'));
  // regression guard: rewritten module specifiers must NOT be bare (browser ESM rejects them)
  assert.ok(!/from "studio\//.test(out) && !/from "shared\//.test(out), "bare module specifier");
});

test("buildPages mirrors the dev tree into outDir", () => {
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), "pages-")), "dist");
  try {
    const ret = buildPages({ outDir: out });
    assert.equal(ret, out);
    for (const f of [
      "index.html",
      "studio/gallery.js",
      "studio/gallery-data.json",
      "studio/board.html",
      "shared/render.js",
      ".nojekyll",
    ]) {
      assert.ok(existsSync(path.join(out, f)), `missing ${f}`);
    }
    // landing at root: sibling paths rewritten
    const root = readFileSync(path.join(out, "index.html"), "utf8");
    assert.ok(!root.includes("../studio"), "root index still has ../studio");
    assert.ok(!root.includes("../shared"), "root index still has ../shared");
    // landing imports must be ./shared (explicit relative), never bare — browser ESM rule
    assert.ok(root.includes('"./shared/render.js"'), "landing module import must be ./shared, not bare");
    // studio file keeps its own sibling import untouched
    assert.ok(
      readFileSync(path.join(out, "studio/gallery.js"), "utf8").includes("../shared/"),
      "studio import was wrongly rewritten",
    );
    // dev unit tests are excluded from the public bundle
    for (const t of ["studio/gallery.test.js", "shared/presence-card.test.js"]) {
      assert.ok(!existsSync(path.join(out, t)), `test file leaked into bundle: ${t}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
