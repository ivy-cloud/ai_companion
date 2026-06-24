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

    def test_session_goodbye_line(self) -> None:
        line = companion_moments.session_goodbye_line(resolve_clock("UTC"))
        self.assertTrue(len(line) > 10)
        self.assertLessEqual(len(line), 160)

    def test_emotional_continuity_hint_when_shared(self) -> None:
        import profile_growth

        profile_growth.try_reflection_moment_learn(
            "Today I found out my mom passed away last week."
        )
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.emotional_continuity_turn_hint(
                "work was okay today", casual=True
            )
        self.assertIn("Continuity", hint)
        self.assertIn("shared", hint.lower())

    def test_curiosity_hint_substantive_casual(self) -> None:
        found = False
        for msg in (
            "I went to the park and sat by the lake for a while",
            "work has been pretty intense this whole month honestly",
        ):
            hint = companion_moments.curiosity_turn_hint(msg, casual=True)
            if hint:
                found = True
                self.assertIn("curious", hint.lower())
        self.assertTrue(found)

    def test_think_through_hint_on_incomplete_vent(self) -> None:
        msg = "Jessica, I feel like it's too late for."
        hint = companion_moments.vent_turn_hint(msg, casual=True)
        self.assertIn("Vent", hint)
        self.assertIn("never too late", hint.lower())

    def test_think_through_hint_on_substantive_vent(self) -> None:
        msg = (
            "I've been so stressed about this job interview tomorrow "
            "and I don't know if I'm ready at all"
        )
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.think_through_turn_hint(msg, casual=True)
        self.assertIn("Think-with", hint)
        self.assertIn("what/how", hint.lower())

    def test_think_through_skips_brief(self) -> None:
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.think_through_turn_hint(
                "so stressed", casual=True
            )
        self.assertEqual(hint, "")

    def test_advice_seeking_detected(self) -> None:
        self.assertTrue(companion_moments.is_advice_seeking("What should I do now?"))
        self.assertFalse(companion_moments.is_advice_seeking("I feel like it's too late."))

    def test_session_opening_curious_tail(self) -> None:
        profile.learn_from_user_message("My name is Alex.")
        line = companion_moments.session_opening_line(resolve_clock("UTC"), force=True)
        self.assertIsNotNone(line)
        assert line is not None
        self.assertNotIn("It's ", line)
        self.assertNotIn("how's your day going", line.lower())
        self.assertTrue(
            "on your mind" in line.lower()
            or "going on" in line.lower()
            or "here" in line.lower()
            or "remember" in line.lower()
        )

    def test_session_opening_resume_no_name_intro(self) -> None:
        import memory as conv_memory

        with patch.object(conv_memory, "exchange_count", return_value=3), patch.object(
            conv_memory,
            "last_exchange",
            return_value=("we were talking about my job interview tomorrow", "good luck"),
        ):
            line = companion_moments.session_opening_line(
                resolve_clock("UTC"), resume=True
            )
        if line:
            self.assertNotIn("It's ", line)
            self.assertTrue(
                "pick up" in line.lower()
                or "keep going" in line.lower()
                or "something new" in line.lower()
            )

    def test_session_opening_resume_can_be_silent(self) -> None:
        import memory as conv_memory

        with patch.object(conv_memory, "exchange_count", return_value=2), patch.object(
            conv_memory, "last_exchange", return_value=("hello there", "hi")
        ), patch.object(
            companion_moments, "_resume_opening_roll", return_value=None
        ):
            line = companion_moments.session_opening_line(
                resolve_clock("UTC"), resume=True
            )
        self.assertIsNone(line)

    def test_journal_reflection_hint(self) -> None:
        import profile_growth

        profile_growth.try_reflection_moment_learn(
            "Last night I couldn't sleep because of the breakup."
        )
        found = False
        for msg in ("yeah", "thinking about it again", "hard day today"):
            hint = companion_moments.journal_reflection_hint(msg, casual=True)
            if hint:
                found = True
                self.assertIn("shared", hint.lower())
        self.assertTrue(found)

    def test_active_listening_hint_substantive(self) -> None:
        msg = (
            "I went to the park and sat by the lake for a while thinking about work"
        )
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.active_listening_turn_hint(msg, casual=True)
        self.assertIn("Active listening", hint)
        self.assertIn("echo", hint.lower())

    def test_friend_reaction_skips_vent(self) -> None:
        msg = (
            "I've been so stressed about this job interview tomorrow "
            "and I don't know if I'm ready at all"
        )
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.friend_reaction_turn_hint(msg, casual=True)
        self.assertEqual(hint, "")

    def test_friend_reaction_on_casual_share(self) -> None:
        msg = "I tried that new ramen place downtown and it was incredible honestly"
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.friend_reaction_turn_hint(msg, casual=True)
        self.assertIn("Friend reaction", hint)

    def test_greeting_turn_detection(self) -> None:
        self.assertTrue(companion_moments.is_greeting_turn("Hello."))
        self.assertTrue(companion_moments.is_greeting_turn("Hello, Jessica King."))
        self.assertTrue(companion_moments.is_greeting_turn("Hey"))
        self.assertFalse(companion_moments.is_greeting_turn("I feel like it's too late"))

    def test_greeting_turn_hint(self) -> None:
        hint = companion_moments.greeting_turn_hint("Hello, Jessica.", casual=True)
        self.assertIn("Greeting", hint)
        self.assertIn("dossier", hint.lower())

    def test_boredom_routes_as_vent(self) -> None:
        self.assertTrue(companion_moments.is_vent_message("I'm boring. January."))
        hint = companion_moments.vent_turn_hint("I feel so bored tonight", casual=True)
        self.assertIn("Vent", hint)

    def test_think_through_always_on_incomplete_vent(self) -> None:
        msg = "Jessica, I feel like it's too late for."
        with patch.object(companion_moments, "_stable_roll", return_value=False):
            hint = companion_moments.think_through_turn_hint(msg, casual=True)
        self.assertIn("Think-with", hint)

    def test_think_through_setback_news(self) -> None:
        msg = "I failed the interview today and I feel awful"
        with patch.object(companion_moments, "_stable_roll", return_value=False):
            hint = companion_moments.think_through_turn_hint(msg, casual=True)
        self.assertIn("Setback news", hint)
        self.assertIn("what/how", hint.lower())

    def test_active_listening_eight_word_minimum(self) -> None:
        msg = "Work was brutal today honestly three meetings back to back"
        with patch.object(companion_moments, "_stable_roll", return_value=True):
            hint = companion_moments.active_listening_turn_hint(msg, casual=True)
        self.assertIn("Active listening", hint)
        short = "Work was brutal today honestly"
        self.assertEqual(
            companion_moments.active_listening_turn_hint(short, casual=True),
            "",
        )


if __name__ == "__main__":
    unittest.main()
