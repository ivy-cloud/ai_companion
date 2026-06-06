"""Her-style companion attunement — continuity, curiosity, silence, goodbye."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import companion_moments
import personality
import profile
import profile_growth
from context import resolve_clock
from emotion import detect_emotion_hint, silence_comfort_turn_hint


class HerCompanionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._profile_path = Path(self._tmpdir.name) / "profile.json"
        self._patch_path = patch.object(profile, "_PROFILE_PATH", self._profile_path)
        self._patch_path.start()
        profile.clear_facts()

    def tearDown(self) -> None:
        self._patch_path.stop()
        self._tmpdir.cleanup()

    def test_build_turn_hints_includes_silence_comfort(self) -> None:
        hint = personality.build_turn_hints(
            "yeah",
            emotion_hint=detect_emotion_hint("yeah"),
        )
        self.assertIn("Silence comfort", hint)

    def test_build_turn_hints_skips_her_on_factual(self) -> None:
        hint = personality.build_turn_hints(
            "What is the capital of France?",
            factual=True,
        )
        self.assertNotIn("Continuity", hint)
        self.assertNotIn("curious", hint.lower())

    def test_continuity_not_on_memory_recall(self) -> None:
        profile_growth.try_reflection_moment_learn(
            "Today I found out my mom passed away last week."
        )
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.emotional_continuity_turn_hint(
                "what do you remember about me?",
                casual=True,
            )
        self.assertEqual(hint, "")

    def test_curiosity_skips_questions(self) -> None:
        hint = companion_moments.curiosity_turn_hint(
            "why do you think I feel this way about work?",
            casual=True,
        )
        self.assertEqual(hint, "")

    def test_goodbye_respects_time_band(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        clock = resolve_clock("UTC")
        with patch("companion_moments.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 6, 4, 21, 0, tzinfo=ZoneInfo("UTC"))
            evening = companion_moments.session_goodbye_line(clock)
            mock_dt.now.return_value = datetime(2026, 6, 4, 9, 0, tzinfo=ZoneInfo("UTC"))
            morning = companion_moments.session_goodbye_line(clock)
        self.assertIn("Rest", evening)
        self.assertTrue(len(morning) > 10)

    def test_goodbye_uses_name_once(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        profile.learn_from_user_message("My name is Riley.")
        clock = resolve_clock("UTC")
        with patch("companion_moments.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 6, 4, 14, 0, tzinfo=ZoneInfo("UTC"))
            line = companion_moments.session_goodbye_line(clock)
        self.assertIn("Riley", line)
        self.assertIn("Take care", line)

    def test_silence_comfort_brief_and_low(self) -> None:
        combined = silence_comfort_turn_hint("ok", "sympathetic")
        self.assertIn("quiet", combined.lower())

    def test_growth_skill_hint_in_turn_hint(self) -> None:
        for _ in range(3):
            profile_growth.record_usage_signals("sing me a lullaby please")
        with patch.object(profile_growth, "companion_growth_turn_hint") as mock_growth:
            mock_growth.return_value = " Saved note: they like tea."
            hint = personality.build_turn_hints("just chilling tonight")
        self.assertIn("Saved note", hint)


if __name__ == "__main__":
    unittest.main()
