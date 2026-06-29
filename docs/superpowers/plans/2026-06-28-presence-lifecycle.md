# Presence Lifecycle — Implementation Plan

> Execute with TDD. Steps use checkbox (`- [ ]`). Spec: `docs/superpowers/specs/2026-06-28-presence-lifecycle-design.md`.

**Goal:** the Claude Code lifecycle hooks also maintain the board's `/api/presence`, so the
presence card tracks Claude's state (working/done/idle/question/alert) instead of going stale.

**Architecture:** host-side Python only (`claude-hooks/`), stdlib only, best-effort/fail-silent.
The board's `POST /api/presence` is a pure store (no LED render), so this never touches the
display or needs a reflash.

## Global Constraints
- Python stdlib only; never block or raise from a hook (fail-silent, short timeout).
- Don't use the maintainer's real name / machine paths anywhere.
- The presence POST must NOT change the LED display — it only updates the semantic store.

---

### Task 1: matrix_signal.py — presence helper, moment map, wiring + tests

**Files:**
- Modify: `claude-hooks/matrix_signal.py`
- Create: `claude-hooks/test_presence_lifecycle.py`

**Step 1 — add the pure body builder + poster.** Place near `post_brightness` (after it):

```python
def presence_body(intent, **fields):
    """Pure: build a PresenceMessage body. Drops None/empty fields. The board stamps ts."""
    body = {"intent": intent}
    for k, v in fields.items():
        if v is not None and v != "":
            body[k] = v
    return body


def post_presence(intent, **fields):
    """Best-effort POST /api/presence — keep the board's SEMANTIC status store in sync with
    Claude's lifecycle so the presence card mirrors it. The board's POST is a pure store (no
    LED render, no screensaver disarm), so this never affects the display. Fail-silent."""
    try:
        data = json.dumps(presence_body(intent, **fields)).encode("utf-8")
        req = urllib.request.Request(BOARD_URL + "/api/presence", data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception:
        pass  # board offline / unreachable — never block a turn
```

**Step 2 — add the moment→intent map.** Place near the top constants (after `FIRMWARE_NAMES`
or before `main`):

```python
# Which presence intent each lifecycle moment stamps into /api/presence (the card mirrors it).
# All five intents exist in PRESENCE_VOCAB (shared/presence-vocab.js) so the card can render them.
MOMENT_PRESENCE = {
    "hook:UserPromptSubmit": "working",
    "hook:PostToolUse:AskUserQuestion": "working",   # resumed after answering
    "hook:PostToolUse:ExitPlanMode": "working",
    "hook:PreToolUse:AskUserQuestion": "question",   # blocked on the user
    "hook:PreToolUse:ExitPlanMode": "question",
    "hook:Notification:permission_prompt": "alert",
    "hook:Stop": "done",
}
```

**Step 3 — wire into `main()`.** After `render_moment(moment)` and before the `is_done` block:

```python
    render_moment(moment)
    intent = MOMENT_PRESENCE.get(moment)
    if intent:
        post_presence(intent)          # semantic channel; render (display) already happened above
    if is_done and token is not None:
        arm_board_idle()
        spawn_idle_watcher(token)
```

**Step 4 — tests** (`claude-hooks/test_presence_lifecycle.py`, run `python -m unittest`):

```python
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matrix_signal as ms

# Intents the presence card (shared/presence-vocab.js) can render. Keep in sync with that file.
VOCAB = {"working", "thinking", "done", "ok", "celebrate", "alert", "error", "question", "info", "idle"}


class PresenceBodyTests(unittest.TestCase):
    def test_intent_only(self):
        self.assertEqual(ms.presence_body("working"), {"intent": "working"})

    def test_extra_fields_kept_empty_dropped(self):
        b = ms.presence_body("done", headline="Shipped", detail="", urgency=None)
        self.assertEqual(b, {"intent": "done", "headline": "Shipped"})

    def test_no_ts(self):  # the board stamps ts
        self.assertNotIn("ts", ms.presence_body("idle"))


class MomentMapTests(unittest.TestCase):
    def test_every_mapped_intent_is_renderable(self):
        for moment, intent in ms.MOMENT_PRESENCE.items():
            self.assertIn(intent, VOCAB, f"{moment} -> {intent} not in PRESENCE_VOCAB")

    def test_core_moments_present(self):
        self.assertEqual(ms.MOMENT_PRESENCE["hook:UserPromptSubmit"], "working")
        self.assertEqual(ms.MOMENT_PRESENCE["hook:Stop"], "done")


class MainDispatchTests(unittest.TestCase):
    def setUp(self):
        self._calls = []
        self._orig = {k: getattr(ms, k) for k in
                      ("render_moment", "post_presence", "write_activity_token",
                       "arm_board_idle", "spawn_idle_watcher")}
        ms.render_moment = lambda m: None
        ms.post_presence = lambda intent, **kw: self._calls.append(intent)
        ms.write_activity_token = lambda: "tok"
        ms.arm_board_idle = lambda: None
        ms.spawn_idle_watcher = lambda t: None
        self._argv = sys.argv

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(ms, k, v)
        sys.argv = self._argv

    def run_moment(self, moment):
        self._calls.clear()
        sys.argv = ["matrix_signal.py", moment]
        ms.main()
        return list(self._calls)

    def test_prompt_posts_working(self):
        self.assertEqual(self.run_moment("hook:UserPromptSubmit"), ["working"])

    def test_stop_posts_done(self):
        self.assertEqual(self.run_moment("hook:Stop"), ["done"])

    def test_unmapped_moment_posts_nothing(self):
        self.assertEqual(self.run_moment("hook:SessionStart"), [])


class FailSilentTests(unittest.TestCase):
    def test_post_presence_swallows_errors(self):
        import urllib.request
        orig = urllib.request.urlopen
        urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(OSError("boom"))
        try:
            ms.post_presence("working")  # must NOT raise
        finally:
            urllib.request.urlopen = orig


if __name__ == "__main__":
    unittest.main()
```

- [ ] Write the test file → run `python -m unittest test_presence_lifecycle` → fails (no `post_presence`/`MOMENT_PRESENCE`)
- [ ] Add the three code changes
- [ ] Run → passes; also run `test_manifest_resolver` + `test_setup_config` (no regression)
- [ ] Commit

---

### Task 2: matrix_idle.py — stamp `idle` when the watcher is idle

**Files:** Modify `claude-hooks/matrix_idle.py`

In `main()`, stamp idle presence whenever the watcher renders idle content (it imports
`matrix_signal as ms`). Two spots:

```python
        if time.monotonic() - start >= CAP_SECS:
            ms.post_presence("idle")
            play(REST)                    # idle too long — settle on a calm face and stop
            return 0
        ms.post_presence("idle")
        play(random.choice(load_pool()))  # reload each time so dropped-in JSONs appear live
```

(No unit test — `main()` is an infinite sleep-loop; covered by the live verification below.
The change is two `ms.post_presence("idle")` calls next to the existing `play(...)`.)

- [ ] Add the two `ms.post_presence("idle")` calls
- [ ] `python -c "import matrix_idle"` imports clean
- [ ] Commit

---

## After both tasks (controller-driven, not a subagent)
- Redeploy `matrix_signal.py` + `matrix_idle.py` to `~/.claude/hooks/`.
- Live-verify on the connected board: fire each moment (`python matrix_signal.py hook:UserPromptSubmit`,
  `hook:Stop`, etc.), confirm `GET /api/presence` reflects the intent and the LED display is
  unaffected by the presence POST; confirm the presence card updates. Restore the board.
- Final independent review of the whole diff.
