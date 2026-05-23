"""Session log file — no network."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import session_log


class SessionLogTests(unittest.TestCase):
    def test_log_and_read_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "session_log.jsonl"
            with mock.patch.object(session_log, "_LOG_PATH", path):
                session_log.log_turn(
                    "I'm 48",
                    "Got it — you're 48.",
                    route="canned:user_age_learn",
                    learn_updated=["age"],
                    profile_facts={"age": "48"},
                )
                entries = session_log.read_entries(10)
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["route"], "canned:user_age_learn")
            self.assertIn("48", entries[0]["user"])
            text = session_log.format_entries_text(entries)
            self.assertIn("YOU:", text)
            self.assertIn("canned:user_age_learn", text)


if __name__ == "__main__":
    unittest.main()
