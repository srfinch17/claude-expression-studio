import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolve, effectiveBindings, intentForMoment } from "./resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
const ROOTS = ["info", "working", "done", "attention", "fail", "idle"];

// These assert the manifest's STABLE CONTRACT — the layers the Studio editor never touches:
// the moment->intent lifecycle wiring, root coverage, renderer inheritance, and "no lifecycle
// moment ever resolves to a blank board." They deliberately do NOT pin which animation an intent
// binds to: bindings are user-owned taste data (edited live in the editor and re-saved), so
// pinning them would break CI on every legitimate edit. The RESOLVER's fallback/pick logic is
// covered with controlled fixtures in resolver.test.js (+ the shared resolver-fixtures.json parity
// set); structural validity by scripts/check-manifest.mjs; asset existence by
// mcp_server/manifest-assets.test.ts.

test("manifest: core lifecycle moments map to their intents (the wiring spec)", () => {
  const expect = {
    "hook:UserPromptSubmit": "working",
    "hook:Stop": "done",
    "hook:SubagentStop": "results-merged",
    "hook:PreCompact": "compacting",
    "hook:PreToolUse:AskUserQuestion": "awaiting-input",
    "hook:SessionStart": "session-start",
    "hook:SessionEnd": "session-end",
    "hook:Notification:permission_prompt": "attention",
  };
  for (const [moment, intent] of Object.entries(expect))
    assert.equal(intentForMoment(MANIFEST, "claude-code", moment), intent, moment);
});

test("manifest: web-sim inherits esp32-8x8 bindings verbatim", () => {
  const a = effectiveBindings(MANIFEST, "esp32-8x8");
  const b = effectiveBindings(MANIFEST, "web-sim");
  for (const root of ROOTS) assert.deepEqual(b[root], a[root]);
});

test("manifest: every renderer covers the 6 roots, and each root resolves to a value", () => {
  for (const rid of Object.keys(MANIFEST.renderers)) {
    const b = effectiveBindings(MANIFEST, rid);
    for (const root of ROOTS) {
      assert.ok(root in b, `${rid} binds root ${root}`);
      const got = resolve(MANIFEST, { renderer: rid, intent: root });
      assert.ok(got && got.value != null, `${rid} ${root} resolves to a value`);
    }
  }
});

test("manifest: every lifecycle moment resolves to a renderable value on esp32 (no blank board)", () => {
  for (const m of MANIFEST.harnesses["claude-code"].moments) {
    if (m.on === "discretionary") continue;
    const got = resolve(MANIFEST, { harness: "claude-code", renderer: "esp32-8x8", moment: m.on });
    assert.ok(got && got.value != null, `${m.on} (${m.intent}) resolves to a value`);
  }
});
