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
        self._orig_exists = os.path.exists
        os.path.exists = lambda p: False   # ignore a stray .matrix_off kill switch during these tests
        ms.render_moment = lambda m: None
        ms.post_presence = lambda intent, **kw: self._calls.append(intent)
        ms.write_activity_token = lambda: "tok"
        ms.arm_board_idle = lambda: None
        ms.spawn_idle_watcher = lambda t: None
        self._argv = sys.argv

    def tearDown(self):
        for k, v in self._orig.items():
            setattr(ms, k, v)
        os.path.exists = self._orig_exists
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
        def _raise(*a, **k):
            raise OSError("boom")
        urllib.request.urlopen = _raise
        try:
            ms.post_presence("working")  # must NOT raise
        finally:
            urllib.request.urlopen = orig


if __name__ == "__main__":
    unittest.main()
