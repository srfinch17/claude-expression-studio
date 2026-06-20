# Board Settings + Idle Screensaver — Design Spec

**Date:** 2026-06-19
**Status:** Approved for planning
**Author:** the user + Claude (brainstorm)

## Summary

Two stacked features:

1. **Settings Foundation** — a persistent, mergeable, board-owned settings store
   (NVS) with an HTTP surface (`/api/settings`), a web page (`data/settings.html`),
   and a thin MCP layer so settings can be changed by talking to Claude *or* via the
   web UI. The board is the single source of truth; every editor is just a client.
2. **Idle Screensaver Engine** — a board-side state machine that, once Claude goes
   idle, runs **Goof → Zz → rotating screensaver** autonomously and indefinitely,
   surviving the host laptop sleeping or disconnecting. Governed entirely by the
   settings from Part 1.

The Idle Engine is the first *consumer* of the Settings Foundation; the foundation
is built to grow.

## Motivation / Problem

Today, when Claude finishes a turn the `Stop` hook spawns a detached host process
(`claude-hooks/matrix_idle.py`) that plays "bored" animations for a while, then
settles on a sleepy **Zz** face (`REST`) and exits — and the board **sits on that Zz
forever**. The user wants the board to instead drift into a screensaver rotation
(fire / matrix rain / clock / fireworks / …) after the Zz, and to keep cycling all
night, **without depending on the host machine staying awake**.

Separately, the user wants a real, persistent **settings** system: configurable
behavior that survives a firmware flash, editable both conversationally (Claude/MCP)
and via a web page — because this project is intended to eventually ship to
**end users / customers** who flash the firmware and drive the board through *their*
Claude plus the web UI.

## Goals

- Persistent settings that **survive a normal Sketch→Upload and LittleFS upload**,
  with a non-destructive **merge-on-boot** (new firmware adds keys with defaults,
  keeps existing user values).
- A single board-owned settings store edited by **both** the web page and Claude/MCP,
  which therefore can never drift out of sync.
- Idle flow **Goof → Zz → rotating screensaver**, board-autonomous from the moment
  the host goes quiet (robust against laptop sleep/reboot/disconnect).
- The user can change settings and timers **by talking to Claude**.
- Plan for a **painless customer install** — graceful defaults on a fresh flash, no
  per-user hand-editing on the MCP side, board discovery addressed.

## Non-Goals

- Moving the goof/Zz frame animations into firmware (they stay host-driven; the board
  takes over only for the screensaver tail). Full host-independence for the *goof*
  phase is explicitly out of scope for v1.
- A comprehensive settings schema beyond the v1 seed set below.
- Cloud sync / multi-board settings / accounts.

---

## Part 1 — Settings Foundation

### Storage: NVS (`Preferences`)

Reuse the existing `prefs` (`Preferences`, namespace `"matrix"`, opened in `setup()`
at `esp32_matrix_webserver.ino:565`). NVS lives in its own flash partition that a
normal app upload does **not** erase; only a full chip-erase wipes it. This is the
mechanism that delivers "settings survive a flash" essentially for free.

> Existing auto-resume keys in the same namespace: `bri`, `kind`, `animbody`. New
> settings keys live alongside them. Keep keys short (NVS key length limit is 15 chars).

### Settings model + merge-on-boot

A new translation unit **`settings.ino`** owns:

- A `Settings` struct (typed fields, see v1 seed below) held in RAM as the live config.
- `const` **defaults** for every field.
- `loadSettings()` — called in `setup()` after `prefs.begin`. For each key:
  `prefs.isKey(key) ? read it : write the default`. (Use `isKey` to avoid the
  harmless NOT_FOUND log noise, matching the existing auto-resume pattern.) Result:
  a fresh flash gets all defaults; an upgraded flash keeps existing values and only
  fills in newly-added keys.
- `saveSettings(...)` — persist changed fields.
- `settingsToJson()` / `applySettingsJson(partialBody)` — serialize current settings;
  apply a partial update (only provided keys change), validate, clamp, persist, and
  apply live (e.g. a brightness change takes effect immediately).
- A **`settings_version`** int key. On boot, if the stored version is older than the
  firmware's `SETTINGS_VERSION`, run any needed migration; normal bumps are pure
  merges (no reset). A reset only happens on a deliberate breaking change.

### HTTP API

| Method | Path | Behavior |
|---|---|---|
| `GET`  | `/api/settings` | Returns all current settings as JSON (`settingsToJson`). |
| `POST` | `/api/settings` | Partial update: only keys present in the body change; validates/clamps, persists, applies live. Returns the new full settings. |

Handlers `handleSettingsGet` / `handleSettingsPost` go in `api_handlers.ino`,
registered next to the others in `esp32_matrix_webserver.ino` (~line 738). `POST`
must tolerate partial bodies so both the web page (full form) and Claude
("just change the idle timeout") use the same endpoint.

### Web UI

- New **`data/settings.html`** — a control page reading `GET /api/settings` to populate
  the form and `POST`ing changes. Sections: Idle behavior (enable, per-app rotation
  checkboxes, screensaver-after delay, re-pick interval, idle brightness), Display
  (default brightness, default boot animation), Clock (timezone). Sliders follow the
  project rule (left=low/right=high; speed in fps where relevant).
- **`data/index.html`** gains a **Settings card/link** so the page is reachable from
  the board's main page.

### `/api/status` exposure

Add a `settings_version` field to `handleStatus` so drift/version tooling can see it.

---

## Part 2 — v1 Settings (the seed set)

| Setting | Key (≤15 ch) | Type | Default | Notes |
|---|---|---|---|---|
| Idle enabled | `idle_on` | bool | true | Master switch for the screensaver engine. |
| Per-app rotation toggles | `idle_apps` | string (csv/bitmask) | all eligible | Which animations the screensaver may pick. |
| Screensaver-after delay | `idle_after` | uint (s) | 120 | Board silence before screensaver starts. |
| Re-pick interval | `idle_rot` | uint (s) | 240 | How often the screensaver picks a new app. |
| Idle brightness | `idle_bri` | uint8 | 5 | Brightness during the screensaver (existing ambient 5). |
| Default brightness | `def_bri` | uint8 | 40 | Boot brightness (formalizes today's NVS behavior). |
| Default boot animation | `boot_anim` | string | `""` (auto-resume) | Pin power-up display; empty = keep current auto-resume. |
| Clock timezone | `tz` | string | `""` | POSIX TZ for the clock screensaver/clock app. |

Eligible screensaver apps (the rotation universe, each individually toggleable):
**fire, matrix_rain, clock, fireworks, frostbite, snow, dancefloor** (mirrors the
existing `IDLE_APPS` in `mcp_server/idle.ts`; keep the two lists conceptually aligned).

---

## Part 3 — Idle Screensaver Engine (board-side)

### Dead-man's switch

New state in the main `.ino`:

- `uint32_t lastActivityMs` — updated whenever the board receives a **non-idle**
  display command (a real user/Claude action).
- `bool idleEligible` — armed when Claude signals idle; cleared by any non-idle
  command. A deliberately-set animation (e.g. the user setting snow via the web) is
  *not* idle-eligible, so the screensaver never hijacks it.
- `bool screensaverActive`, `uint32_t nextPickMs`, `String idleLastType`.

Loop tick (alongside the existing animation tick near `esp32_matrix_webserver.ino:858`):

```
if (settings.idle_on && idleEligible && !screensaverActive
    && millis() - lastActivityMs > settings.idle_after * 1000) {
  enterScreensaver();           // sets brightness = idle_bri, picks first app
}
if (screensaverActive && millis() >= nextPickMs) {
  pickAndLaunchIdleApp();       // random enabled app, no immediate repeat
  nextPickMs = millis() + settings.idle_rot * 1000;
}
```

`enterScreensaver()` / `pickAndLaunchIdleApp()` reuse the existing animation launch
path (`applyAnimationBody`) with the enabled-apps filter and `idle_bri`. The picker
mirrors `pickIdleApp` semantics (random, avoid immediate repeat). The screensaver's
own internal launches must **not** update `lastActivityMs` or clear `idleEligible`.

### Arming / disarming (trigger semantics)

- **Arm:** Claude going idle. The existing `Stop` hook (`matrix_signal.py done`) also
  pings a lightweight board signal that sets `idleEligible = true`. (Implementation
  detail in the plan: a small `/api/idle/arm` POST, or fold an `idle` flag into the
  presence path — chosen during planning.)
- **Disarm + reset timer:** any **non-idle** command (a user web action, Claude firing
  `working`/`wait`, an MCP animation) sets `idleEligible = false`, `screensaverActive
  = false`, updates `lastActivityMs`, and runs the command. The `UserPromptSubmit`
  hook's existing `wait` signal naturally disarms (Claude is active again).
- **Keep armed:** the host goof-watcher's frame pushes are marked as idle content so
  they reset `lastActivityMs` *without* disarming — the board stays out of the way
  while the host actively goofs, then takes over when the host falls silent.

### Emergent sequence

Host drives **Goof → Zz** on its existing cadence (`matrix_idle.py`). When the host
finishes (idle cap reached) **or the laptop sleeps**, frame pushes stop, the board's
timer expires, and the board enters the **rotating screensaver** on its own. This
yields the requested **Goof → Zz → Screensaver** flow as an *emergent* result, with
no explicit hand-off command and no goof frames baked into firmware.

### Host change

`claude-hooks/matrix_idle.py`: today its terminal `play(REST)` shows the Zz then
exits, leaving the board stuck. Under this design it can keep showing the Zz (good —
that's the intended Zz phase) and simply exit; the board's idle timer then takes over.
The watcher's goof/Zz pushes should carry the idle marker so they don't disarm.
(Exact REST/cap tuning handled in the plan.) Remember the live-copy sync: hooks have
installed copies at `~/.claude/hooks/` — edit both. [[hook_live_copy_sync]]

---

## Part 4 — MCP Settings Layer

Both the web page and Claude edit the **same** `/api/settings`, so the MCP tools are
thin HTTP shims with all validation living once on the board.

New tools in `mcp_server/index.ts` (wrappers over `BOARD_URL`):

- **`matrix_get_settings`** — `GET /api/settings`; returns current settings + timers so
  Claude can answer "what's my idle timeout?" / "which screensavers are on?".
- **`matrix_set_settings`** — `POST /api/settings` with a partial body; lets Claude
  change any setting/timer conversationally ("make the screensaver kick in after 5
  minutes" → `{ idle_after: 300 }`; "turn off the clock in the rotation" → toggle in
  `idle_apps`). Tool description must map natural phrasing → keys clearly.

These belong to the same family as the existing `matrix_set_brightness` / `matrix_idle`
tools. No new board logic.

---

## Part 5 — Distribution / Customer-Install Requirements

This feature is on the path to a **user-flashes-it, their-Claude-controls-it** product,
so the plan must treat these as first-class, not afterthoughts: [[project_distribution]]

- **Graceful fresh-flash defaults:** a board with empty NVS must boot to sane settings
  (merge-on-boot guarantees this) and "just work" with no setup.
- **Board discovery / `ESP32_URL`:** the MCP currently reads `process.env.ESP32_URL`
  defaulting to `http://esp32matrix.local` (`index.ts:124`). A customer must not have
  to hand-edit an IP. The plan should at minimum document the discovery story and avoid
  hardcoding anything user-specific; a better discovery mechanism can be a follow-up but
  the requirement is recorded here.
- **No per-user setup on the MCP side:** relative paths, no machine-specific absolute
  paths in launchers, settings round-trip entirely through the board.
- **Conversational-first UX:** for customers the MCP tools are the primary way to
  configure the board; the web page is the power-user fallback. Tool descriptions and
  defaults should make "just tell Claude" work on day one.

---

## Touch List

**Firmware (`esp32_matrix_webserver/`):**
- `settings.ino` *(new)* — `Settings` struct, defaults, `loadSettings`/`saveSettings`,
  JSON (de)serialize, `settings_version`/migration, idle-engine helpers.
- `esp32_matrix_webserver.ino` — call `loadSettings()` in `setup()`; idle state globals;
  loop tick for the dead-man's switch + rotation; route registration for `/api/settings`
  (+ idle arm); `settings_version` plumbed into status.
- `api_handlers.ino` — `handleSettingsGet`/`handleSettingsPost` (+ idle-arm handler);
  ensure non-idle commands update `lastActivityMs`/clear `idleEligible`.

**Host hooks (`claude-hooks/` + installed copies in `~/.claude/hooks/`):**
- `matrix_idle.py` — terminal change (Zz then exit, let the board take over); mark
  goof/Zz pushes as idle content.
- `matrix_signal.py` / `Stop` hook — fire the board idle-arm signal.

**Web (`data/`):**
- `settings.html` *(new)* — full settings form against `/api/settings`.
- `index.html` — Settings card/link.

**MCP (`mcp_server/`):**
- `index.ts` — `matrix_get_settings` + `matrix_set_settings` tools.
- (Optional) keep `idle.ts`'s `IDLE_APPS` conceptually aligned with the firmware
  rotation universe; note the two-source duplication.

**Versioning:** a feature bump (`npm run bump:minor`) once shipped; redeploy all three
artifacts (flash / LittleFS / MCP rebuild+reconnect). [[versioning_system]]

## Testing / Verification

- **TS unit tests** for the picker/eligibility logic where it lives in TS (follow the
  existing `idle.test.ts` / `wait.test.ts` pattern).
- **Hardware verification** (the user flashes + reports) for: merge-on-boot keeps
  values across a reflash; fresh-flash defaults; settings page round-trip; MCP
  get/set round-trip; the full Goof → Zz → Screensaver sequence including the
  laptop-sleep case (screensaver still starts); a deliberately-set animation is **not**
  hijacked. [[feedback_dev_workflow]]
- Watch the **frames heap** caution — keep any idle/goof frame payloads light; never
  fire heavy full-panel frame bursts. [[bug_frames_heap_crash]]

## Open Questions (resolve during planning)

- Exact idle-arm mechanism: dedicated `/api/idle/arm` vs. an `idle` flag on the
  presence/Stop path.
- `idle_apps` encoding: CSV of type names vs. a bitmask.
- Whether `matrix_idle` (the existing on-demand "show something cool" MCP tool) and the
  new always-on screensaver should share a lineup definition or stay separate.
