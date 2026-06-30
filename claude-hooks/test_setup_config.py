"""Tests for matrix_signal._load_config, the env/config-file/default resolution that
replaced the hardcoded maintainer repo path. Run: python -m unittest (from claude-hooks/)."""
import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matrix_signal as ms


class LoadConfigTests(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        self._hookdir = ms.HOOK_DIR
        for k in ("MATRIX_MCP_DIR", "ESP32_URL"):
            os.environ.pop(k, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)
        ms.HOOK_DIR = self._hookdir

    def test_env_wins_over_everything(self):
        os.environ["MATRIX_MCP_DIR"] = "/env/mcp"
        os.environ["ESP32_URL"] = "http://env-board"
        board, mcp = ms._load_config()
        self.assertEqual(mcp, "/env/mcp")
        self.assertEqual(board, "http://env-board")

    def test_config_file_used_when_env_unset(self):
        with tempfile.TemporaryDirectory() as d:
            ms.HOOK_DIR = d
            with open(os.path.join(d, "matrix_config.json"), "w", encoding="utf-8") as f:
                json.dump({"mcp_dir": "/cfg/mcp", "board_url": "http://cfg-board"}, f)
            board, mcp = ms._load_config()
            self.assertEqual(mcp, "/cfg/mcp")
            self.assertEqual(board, "http://cfg-board")

    def test_defaults_when_nothing_set(self):
        with tempfile.TemporaryDirectory() as d:
            ms.HOOK_DIR = d  # no config file present
            board, mcp = ms._load_config()
            self.assertEqual(board, "http://esp32matrix.local")
            self.assertEqual(mcp, "")

    def test_no_hardcoded_user_path_in_source(self):
        with open(os.path.join(self._hookdir, "matrix_signal.py"), "r", encoding="utf-8") as f:
            text = f.read()
        self.assertNotIn("C:\\Users", text)
        self.assertNotIn("/Users/", text)


if __name__ == "__main__":
    unittest.main()
