"""Session openings and time-of-day bands."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import companion_moments
import profile
from context import resolve_clock


class CompanionMomentsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._profile_path = Path(self._tmpdir.name) / "profile.json"
        self._patch_path = patch.object(profile, "_PROFILE_PATH", self._profile_path)
        self._patch_path.start()
        profile.clear_facts()

    def tearDown(self) -> None:
        self._patch_path.stop()
        self._tmpdir.cleanup()

    def test_time_band_from_hour(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        clock = resolve_clock("UTC")
        with patch("companion_moments.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 6, 4, 8, 0, tzinfo=ZoneInfo("UTC"))
            self.assertEqual(companion_moments.time_of_day_band(clock), "morning")
            mock_dt.now.return_value = datetime(2026, 6, 4, 20, 0, tzinfo=ZoneInfo("UTC"))
            self.assertEqual(companion_moments.time_of_day_band(clock), "evening")

    def test_session_opening_with_name(self) -> None:
        profile.learn_from_user_message("My name is Alex.")
        profile.learn_from_user_message("I really like jazz.")
        line = companion_moments.session_opening_line(resolve_clock("UTC"), force=True)
        self.assertIsNotNone(line)
        assert line is not None
        self.assertIn("Alex", line)

    def test_session_opening_prefers_shared_moment(self) -> None:
        import profile_growth

        profile.learn_from_user_message("My name is Sam.")
        profile.learn_from_user_message("I really like hiking on weekends.")
        profile_growth.try_reflection_moment_learn(
            "Today I found out my mom passed away last week."
        )
        line = companion_moments.session_opening_line(resolve_clock("UTC"), force=True)
        self.assertIsNotNone(line)
        assert line is not None
        self.assertIn("Sam", line)
        self.assertTrue(
            "shared" in line.lower() or "passed" in line.lower() or "mom" in line.lower()
        )

    def test_reflection_moment_learn(self) -> None:
        import profile_growth

        ok = profile_growth.try_reflection_moment_learn(
            "Today I found out my mom passed away last week."
        )
        self.assertTrue(ok)
        items = profile.get_memory_items()
        self.assertTrue(
            any(i["id"].startswith("emotional_context:user_shared_moment") for i in items)
        )


if __name__ == "__main__":
    unittest.main()
