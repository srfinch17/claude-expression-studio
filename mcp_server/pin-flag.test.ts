import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { pinBody, pinFlagPath, writePin, clearPin } from "./pin-flag.ts";

test("pinBody is empty for no/zero/negative seconds (pin forever)", () => {
  assert.equal(pinBody(), "");
  assert.equal(pinBody(0), "");
  assert.equal(pinBody(-5), "");
});

test("pinBody encodes an epoch-SECONDS deadline for a positive timeout", () => {
  const nowMs = 1_700_000_000_000;
  // hooks compare body against Python time.time() (epoch seconds), so the body must be seconds
  assert.equal(pinBody(120, nowMs), String(1_700_000_000 + 120));
});

test("pinFlagPath sits beside the deployed hooks at ~/.claude/hooks/.matrix_pinned", () => {
  assert.equal(
    pinFlagPath("/home/x"),
    path.join("/home/x", ".claude", "hooks", ".matrix_pinned"),
  );
});

test("writePin creates the flag (empty body) and clearPin removes it", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pin-"));
  await writePin(undefined, home);
  assert.equal(await readFile(pinFlagPath(home), "utf8"), "");
  assert.equal(await clearPin(home), true);
  await assert.rejects(() => stat(pinFlagPath(home)));
});

test("writePin with seconds writes a numeric deadline the hooks can parse", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pin-"));
  await writePin(300, home);
  const body = await readFile(pinFlagPath(home), "utf8");
  assert.ok(Number.isFinite(Number(body)) && body.length > 0, `expected numeric body, got ${body}`);
});

test("clearPin on an absent flag returns false and does not throw", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "pin-"));
  assert.equal(await clearPin(home), false);
});
