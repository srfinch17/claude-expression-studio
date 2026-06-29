# No-Board Presence — Implementation Plan

Spec: `docs/superpowers/specs/2026-06-28-no-board-presence-design.md`
Branch: `feat/expression-studio` (do NOT merge — this arc merges last)

## Task 1 — Engine presence store (TS, TDD)

1. **RED:** add to `mcp_server/engine-server.test.ts`:
   - `POST /api/presence` stores → `GET` (no board) returns it (200) with stamped `ts`.
   - Board preferred over the store (reachable fake board + prior POST → board wins).
   - Fallback to store when the board is unreachable (prior POST → stored 200, not 503).
   - Honest no-source (unreachable + empty → 503).
   - Non-JSON POST → 400, GET unaffected.
   Run `npm test` → watch the new ones fail against the current proxy-only code.
2. **GREEN:** in `mcp_server/engine-server.ts`:
   - Add `let storedPresence: any = null;` in `startEngineServer` scope.
   - Split the `/api/presence` branch on method:
     - `POST`: parse body (400 on bad JSON), stamp `ts` (epoch s) if absent, `storedPresence = msg`, `204`.
     - `GET`: if `boardUrl`, try board → 2xx returns board body; on miss/throw fall through.
       After the board attempt (or if no boardUrl), if `storedPresence` return it (200);
       else `503 {reachable:false}`.
3. **REFACTOR + per-task review:** keep board-first ordering crisp; ensure no double `res.end`.

## Task 2 — Hook engine mirror (Python, TDD)

1. **RED:** extend `claude-hooks/test_presence_lifecycle.py`:
   - `post_presence` posts to BOTH `{BOARD_URL}/api/presence` and `{engine}/api/presence`
     (capture URLs via a monkeypatched `urlopen`); same intent body on both.
   - Engine-only failure still fail-silent (board ok / engine raises → no raise; and vice versa).
   Run the test → watch it fail (engine never hit today).
2. **GREEN:** in `claude-hooks/matrix_signal.py post_presence()`, after the board POST,
   best-effort POST the same body to `_engine_url() + "/api/presence"` in its own try/except.
3. `matrix_idle.py` needs no change (inherits via `ms.post_presence`).

## Task 3 — Adversarial review (subagent, risky routing)

Dispatch a critical reviewer at the engine `/api/presence` GET/POST routing + the hook mirror:
method dispatch, board-preferred ordering, no-source 503 preserved, fail-silent, double-send,
test discrimination. Address findings.

## Task 4 — Build + live verify

- `npm test` green; `npm run build:mcpb` repacks.
- No-board: throwaway engine on a spare port, `boardUrl=http://127.0.0.1:9`; POST presence →
  GET returns it; engine-served card shows it.
- With-board: against the real engine/board, board still wins (don't disrupt the user's 8787).
- Redeploy the hook to `~/.claude/hooks/`.

## Task 5 — Memory + docs + commit

- Update `presence-protocol-v0` memory + CLAUDE.md presence section (engine now holds presence).
- Commit in logical steps with the co-author trailer.
- Final report: changes, no-board + with-board results, test count, explicit "restart your engine".
