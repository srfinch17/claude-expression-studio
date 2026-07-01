"""Tests for the .matrix_pinned "hold this animation" flag, the hooks-hands-off
counterpart to .matrix_off. A pin must muzzle BOTH hook writers (matrix_signal's
lifecycle renders AND matrix_idle's bored rotation) until it is cleared/expires,
so a user-pushed loop:0 animation survives the end of a turn.

Mirrors the monkeypatch style of test_presence_lifecycle.py's MainDispatchTests.
"""
import os, sys, time, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matrix_signal as ms


class PinnedHelperTests(unittest.TestCase):
    """ms._pinned() reads the flag file: absent=no, empty=forever, epoch-body=until,
    expired=self-clean, garbage=hold (fail safe)."""

    def setUp(self):
        self._orig_flag = ms.FLAG_PIN
        self._tmp = tempfile.mkdtemp()
        ms.FLAG_PIN = os.path.join(self._tmp, ".matrix_pinned")

    def tearDown(self):
        ms.FLAG_PIN = self._orig_flag

    def _write(self, body):
        with open(ms.FLAG_PIN, "w", encoding="utf-8") as f:
            f.write(body)

    def test_absent_is_not_pinned(self):
        self.assertFalse(ms._pinned())

    def test_empty_flag_holds_forever(self):
        self._write("")
        self.assertTrue(ms._pinned())

    def test_future_deadline_holds(self):
        self._write(str(time.time() + 3600))
        self.assertTrue(ms._pinned())

    def test_expired_deadline_is_ignored_and_self_cleans(self):
        self._write(str(time.time() - 1))
        self.assertFalse(ms._pinned())
        self.assertFalse(os.path.exists(ms.FLAG_PIN))  # stale pin never wedges the board

    def test_garbage_body_holds(self):
        self._write("not-a-number")
        self.assertTrue(ms._pinned())


class PinGuardMainTests(unittest.TestCase):
    """main() must no-op (no render, no presence, no token, no watcher spawn) while
    pinned, for EVERY moment, and off must still win when both flags are set."""

    def setUp(self):
        self._calls = []
        self._orig = {k: getattr(ms, k) for k in
                      ("render_moment", "post_presence", "write_activity_token",
                       "arm_board_idle", "spawn_idle_watcher")}
        ms.render_moment = lambda m: self._calls.append(("render", m))
        ms.post_presence = lambda intent, **kw: self._calls.append(("presence", intent))
        ms.write_activity_token = lambda: "tok"
        ms.arm_board_idle = lambda: self._calls.append(("arm", None))
        ms.spawn_idle_watcher = lambda t: self._calls.append(("spawn", t))
        self._orig_pin, self._orig_off = ms.FLAG_PIN, ms.FLAG_OFF
        self._tmp = tempfile.mkdtemp()
        ms.FLAG_PIN = os.path.join(self._tmp, ".matrix_pinned")
        ms.FLAG_OFF = os.path.join(self._tmp, ".matrix_off")
        self._argv = sys.argv

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(ms, k, v)
        ms.FLAG_PIN, ms.FLAG_OFF = self._orig_pin, self._orig_off
        sys.argv = self._argv

    def _touch(self, path):
        open(path, "w").close()

    def run_moment(self, moment):
        self._calls.clear()
        sys.argv = ["matrix_signal.py", moment]
        ms.main()
        return list(self._calls)

    def test_pinned_stop_does_nothing(self):
        self._touch(ms.FLAG_PIN)
        self.assertEqual(self.run_moment("hook:Stop"), [])

    def test_pinned_prompt_does_nothing(self):
        self._touch(ms.FLAG_PIN)
        self.assertEqual(self.run_moment("hook:UserPromptSubmit"), [])

    def test_unpinned_stop_renders_and_spawns(self):
        calls = self.run_moment("hook:Stop")
        self.assertIn(("render", "hook:Stop"), calls)
        self.assertIn(("presence", "done"), calls)
        self.assertIn(("spawn", "tok"), calls)

    def test_off_wins_when_both_set(self):
        self._touch(ms.FLAG_PIN)
        self._touch(ms.FLAG_OFF)
        self.assertEqual(self.run_moment("hook:Stop"), [])


class IdlePinGuardTests(unittest.TestCase):
    """The bored watcher (matrix_idle) already checks .matrix_off each loop; it must
    also honor a pin so a watcher already running when the user pins goes quiet."""

    def setUp(self):
        import matrix_idle as mi
        self.mi = mi
        self._played = []
        self._orig = {
            "play": mi.play,
            "uniform": mi.random.uniform,
            "current_token": mi.current_token,
            "ms_pinned": ms._pinned,
            "ms_post_presence": ms.post_presence,
        }
        mi.play = lambda e: self._played.append(e)
        mi.random.uniform = lambda a, b: 0            # no real waiting between goofs
        mi.current_token = lambda: "tok"              # token unchanged -> would normally goof
        ms.post_presence = lambda *a, **k: None       # no network in tests
        self._orig_exists = os.path.exists
        os.path.exists = lambda p: False              # no .matrix_off
        self._argv = sys.argv

    def tearDown(self):
        self.mi.play = self._orig["play"]
        self.mi.random.uniform = self._orig["uniform"]
        self.mi.current_token = self._orig["current_token"]
        ms._pinned = self._orig["ms_pinned"]
        ms.post_presence = self._orig["ms_post_presence"]
        os.path.exists = self._orig_exists
        sys.argv = self._argv

    def test_pinned_watcher_exits_without_goofing(self):
        ms._pinned = lambda: True
        sys.argv = ["matrix_idle.py", "tok"]
        self.assertEqual(self.mi.main(), 0)
        self.assertEqual(self._played, [])

    def test_unpinned_watcher_goofs(self):
        ms._pinned = lambda: False
        seq = {"n": 0}
        def _token():
            seq["n"] += 1
            return "tok" if seq["n"] == 1 else "changed"  # goof once, then user returns
        self.mi.current_token = _token
        sys.argv = ["matrix_idle.py", "tok"]
        self.mi.main()
        self.assertEqual(len(self._played), 1)


if __name__ == "__main__":
    unittest.main()
