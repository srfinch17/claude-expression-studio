import os, sys, json, unittest
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


class _FakeResp:
    def read(self):
        return b""


class EngineMirrorTests(unittest.TestCase):
    """post_presence mirrors to the engine too, so a NO-BOARD user's card still updates."""

    def setUp(self):
        import urllib.request
        self._urllib = urllib.request
        self._orig = urllib.request.urlopen
        self._hits = []  # (full_url, body_dict)
        def _capture(req, *a, **k):
            self._hits.append((req.full_url, json.loads(req.data)))
            return _FakeResp()
        urllib.request.urlopen = _capture
        self._orig_env = os.environ.get("MATRIX_ENGINE_URL")
        os.environ["MATRIX_ENGINE_URL"] = "http://127.0.0.1:9999"

    def tearDown(self):
        self._urllib.urlopen = self._orig
        if self._orig_env is None:
            os.environ.pop("MATRIX_ENGINE_URL", None)
        else:
            os.environ["MATRIX_ENGINE_URL"] = self._orig_env

    def test_posts_to_both_board_and_engine(self):
        ms.post_presence("working")
        urls = [u for (u, _b) in self._hits]
        self.assertIn(ms.BOARD_URL + "/api/presence", urls)
        self.assertIn("http://127.0.0.1:9999/api/presence", urls)

    def test_same_intent_body_on_both(self):
        ms.post_presence("done")
        self.assertEqual(len(self._hits), 2)
        for _u, body in self._hits:
            self.assertEqual(body["intent"], "done")

    def test_engine_mirror_happens_even_when_board_is_down(self):
        # The no-board case: the board POST raises, the engine mirror must still fire.
        def _board_down(req, *a, **k):
            if "9999" not in req.full_url:   # the board target
                raise OSError("board offline")
            self._hits.append((req.full_url, json.loads(req.data)))
            return _FakeResp()
        self._urllib.urlopen = _board_down
        ms.post_presence("working")  # must NOT raise
        urls = [u for (u, _b) in self._hits]
        self.assertIn("http://127.0.0.1:9999/api/presence", urls)

    def test_engine_failure_is_silent(self):
        def _engine_down(req, *a, **k):
            if "9999" in req.full_url:
                raise OSError("engine offline")
            return _FakeResp()
        self._urllib.urlopen = _engine_down
        ms.post_presence("working")  # must NOT raise


if __name__ == "__main__":
    unittest.main()
