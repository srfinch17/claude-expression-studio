# Handoff notes from the firmware repo session, 2026-07-17

(Untracked scratch file, house cross-repo handoff pattern. For the next session working
in THIS repo. Delete this file once every item below is done or consciously rejected.)

## Context you can trust

Firmware branch `feat/idle-random-settings` (v0.13.0, awaiting hardware verify + merge)
added an `idle_random` board setting (default true) and a new 12-app default rotation:
`fire,matrix_rain,clock,fireworks,fireworks2,frostbite,snow,dancefloor,spiral,wave,starfield,rainbow`.
A nemesis-review panel verified the following about THIS repo (cite-checked, not guessed):

- `mcp_server/idle.ts` and the `IDLE_APPS` constant no longer exist here (matrix_idle
  resolves through the trigger manifest, `shared/manifest.json` screensaver pool). The
  firmware's stale "keep aligned with idle.ts" comments have been fixed on that branch.
- `mcp_server/settings.ts` KNOWN_SETTING_KEYS whitelist does NOT include `idle_random`
  (nor the mqtt_* keys, a pre-existing gap), so `matrix_set_settings` silently drops it:
  a user asking Claude to toggle screensaver randomization gets a silent no-op.
- The `matrix_set_settings` tool description in `mcp_server/index.ts` (~line 548) still
  enumerates the OLD 8-app `idle_apps` universe including claudesweep.

## Suggested (not commanded)

1. Add `idle_random` (and consider the mqtt_* keys) to KNOWN_SETTING_KEYS; refresh the
   tool description's app list to the new 12-app default. Small, self-contained.
2. Open question surfaced by the panel: firmware tuned screensaver fire runs intensity
   10 (a legacy `70` clamped to the 1-10 scale) while the manifest screensaver pool uses
   intensity 6. Decide which look is intended and align ONE of them, or declare the
   divergence deliberate somewhere findable.

## Added later the same night (frames-player nemesis panel, firmware branch feat/baked-frames-player)

3. `docs/frames-file-format.md` still says "Status: DRAFT... may change until the player ships."
   The player HAS now shipped (firmware v0.14.0 branch). Flip the status to SHIPPED and record
   the firmware's real limits in the same edit: frame_count is capped at 160 by the player
   (contract says 65535; fire already ships 150 at 40 ms, so a retune below ~37 ms per frame
   would export fine and then 400 forever on the board).
4. `scripts/export-frames.mjs` name regex has the /i flag (accepts uppercase) and no length cap;
   the firmware accepts lowercase `[a-z0-9_-]` max 48 only. Drop the /i, add a length check,
   and add an exporter guard failing any bake over 160 frames (fail the export, not the gift
   recipient).
5. `shared/firmware-names.js` (+ its hook mirror) has no concept of the firmware's new
   `type:"baked"`; a future session wiring baked anims into the trigger manifest would get
   `isFirmwareName("baked") === false` and misroute. Decide how baked names enter the manifest
   world BEFORE wiring any (the ghost-enum failure mode this project already knows).
6. FS-capacity context for any exporter work: the board's LittleFS partition is 896 KB and
   files cost 4 KB blocks, so 87 loose files = 442 KB on flash for 171 KB of data; the current
   image has ~1 free block. The firmware side is considering a packed single-archive format;
   coordinate before adding ANY new export outputs.

## Constraints

- Branch `feat/frames-export` exists here (LOCAL ONLY, commit 70f3bfe, exporter spike).
  Do not entangle these fixes with that branch; the user has not reviewed it yet.
- Nothing gets pushed anywhere without the user's say-so.
