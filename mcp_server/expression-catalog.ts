// Pure helpers for the expression name space: reserving the firmware namespace on
// save, and rendering the unified catalog. Kept out of index.ts (matching the
// presence.ts / settings.ts / pin-flag.ts extraction pattern) so the logic is
// testable without the MCP server or a board.
//
// Firmware-native modes (shared/firmware-names.js) and saved frame-expressions share
// one flat name space. The resolver routes any firmware name down the firmware path,
// so a saved expression named the same as a firmware mode is unreachable via the
// manifest. Reserving firmware names on the create path removes that footgun; the
// catalog makes both registries visible so "play fireworks 2" is unambiguous.

export interface NamedExpression {
  name: string;
  description: string;
}

/** A refusal message if `sanitizedName` (already `[a-z0-9-]`) is a reserved firmware
 *  mode, else null. Callers block the SAVE (not the play) when this is non-null. */
export function reservedSaveError(
  sanitizedName: string,
  isFirmware: (n: string) => boolean,
): string | null {
  if (isFirmware(sanitizedName)) {
    return `"${sanitizedName}" is a reserved firmware animation name (play it with matrix_set_animation). Pick a different save_as name.`;
  }
  return null;
}

/** The `matrix_list_expressions` text: firmware-native modes, then canned, then saved. */
export function formatCatalog(opts: {
  firmwareNames: string[];
  canned: NamedExpression[];
  saved: NamedExpression[];
}): string {
  const firmware = `Firmware-native animations (play with matrix_set_animation):\n- ${opts.firmwareNames.join(", ")}`;
  const canned = `Canned expressions:\n${opts.canned.map((e) => `- ${e.name}: ${e.description}`).join("\n")}`;
  const saved = `Saved expressions:\n${
    opts.saved.length
      ? opts.saved.map((e) => `- ${e.name}: ${e.description}`).join("\n")
      : "(none yet, create with matrix_animate save_as)"
  }`;
  return `${firmware}\n\n${canned}\n\n${saved}`;
}
