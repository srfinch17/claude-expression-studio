// The .matrix_pinned "hold this animation" flag.
//
// Written by the matrix_pin / matrix_unpin MCP tools, READ by the Python hooks
// (claude-hooks/matrix_signal.py._pinned + matrix_idle.py). While the flag is set,
// the Stop/done hook and the idle scheduler keep their hands off the board, so a
// user-pushed loop:0 animation survives the end of a turn instead of being clobbered
// by the `done` checkmark and then the bored rotation.
//
// It is the mirror image of the .matrix_off kill switch: off means "go dark," pin
// means "don't touch what's already up." The hook checks .matrix_off FIRST, so off
// always wins over a pin. The flag lives beside the deployed hooks at ~/.claude/hooks/,
// the canonical location scripts/setup.mjs deploys them to, so the TS writer and the
// Python reader agree on the path without any shared config.
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";

export function pinFlagPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".claude", "hooks", ".matrix_pinned");
}

/** Flag file body. "" pins indefinitely; a positive `seconds` yields an epoch-SECONDS
 *  deadline the hooks compare against Python's time.time() (see matrix_signal._pinned),
 *  after which the pin self-clears. Zero/negative/undefined => hold forever. */
export function pinBody(seconds?: number, now: number = Date.now()): string {
  if (!seconds || seconds <= 0) return "";
  return String(Math.round(now / 1000 + seconds));
}

/** Set the pin. Creates the hooks dir if needed so this never fails on a fresh install.
 *  Returns the flag path written. */
export async function writePin(seconds?: number, homeDir?: string): Promise<string> {
  const p = pinFlagPath(homeDir);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, pinBody(seconds), "utf8");
  return p;
}

/** Clear the pin. Returns true if a flag existed, false if there was nothing to clear. */
export async function clearPin(homeDir?: string): Promise<boolean> {
  try {
    await unlink(pinFlagPath(homeDir));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
