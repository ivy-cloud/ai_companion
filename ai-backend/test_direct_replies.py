"""Unit tests for direct-answer routing (math, context slimming)."""

import unittest
from unittest.mock import patch

import profile
from context import (
    build_context_appendix,
    companion_math_reply,
    is_simple_math_question,
    needs_clock_context,
    needs_friend_notes_context,
)
from personality import build_turn_hints
from companion import (
    companion_birth_reply_text,
    companion_dad_reply_text,
    companion_family_reply_text,
    companion_mom_reply_text,
    companion_parents_reply_text,
    companion_siblings_reply_text,
    companion_voice_reply_text,
    finalize_birth_reply,
    finalize_family_reply,
    finalize_voice_reply,
    get_companion_birth_year,
    is_companion_identity_turn,
    try_companion_age_reply,
    try_companion_birth_reply,
    is_companion_directed_message,
    try_companion_family_reply,
    try_companion_voice_reply,
)
from human_speech import polish_for_speech
from spoken_text import spoken_year


class DirectReplyTests(unittest.TestCase):
    def test_simple_math_detection(self):
        self.assertTrue(is_simple_math_question("What is 2+2?"))
        self.assertTrue(is_simple_math_question("2 + 2"))
        self.assertFalse(is_simple_math_question("What time is it?"))

    def test_math_reply(self):
        self.assertEqual(companion_math_reply("What is 2+2?"), "That's four.")

    def test_math_context_omits_clock_and_notes(self):
        appendix = build_context_appendix(include_clock=False, include_notes=False)
        self.assertNotIn("## Right now", appendix)
        self.assertNotIn("Saved friend notes", appendix)
        self.assertIn("Do **not** mention the current time", appendix)

    def test_time_question_keeps_clock(self):
        self.assertTrue(needs_clock_context("What time is it?"))
        appendix = build_context_appendix(include_clock=True, include_notes=False)
        self.assertIn("## Right now", appendix)

    def test_math_turn_hints(self):
        hints = build_turn_hints("What is 2+2?", math_turn=True)
        self.assertIn("Do not mention", hints)
        self.assertNotIn("Right now", hints)

    def test_birth_year_from_age_28_in_2026(self):
        """28 in calendar year 2026 → born 1998, spoken as nineteen ninety-eight."""
        from unittest.mock import patch

        with patch("companion.get_companion_age", return_value=28), patch(
            "context.format_local_now_parts",
            return_value={"year": "2026"},
        ):
            self.assertEqual(get_companion_birth_year(), 1998)
            self.assertEqual(spoken_year(1998), "nineteen ninety eight")
            self.assertEqual(
                try_companion_birth_reply("When were you born?"),
                "I was born in nineteen ninety eight.",
            )
            self.assertEqual(
                finalize_birth_reply("when were you born", "96"),
                companion_birth_reply_text(),
            )
            self.assertNotIn("ninety six", companion_birth_reply_text())

    def test_companion_voice_not_user_voice(self):
        self.assertIsNotNone(try_companion_voice_reply("Can you change your voice?"))
        self.assertIn("female", companion_voice_reply_text().lower())
        self.assertIn("male", companion_voice_reply_text().lower())
        self.assertEqual(
            finalize_voice_reply(
                "can you change your voice",
                "You can change your voice in settings.",
            ),
            companion_voice_reply_text(),
        )
        self.assertIsNone(try_companion_voice_reply("How do I change my voice?"))

    def test_companion_family_blocks_web_and_robot_talk(self):
        mom_q = "who is your mom?"
        dad_q = "who is your dad?"
        self.assertTrue(is_companion_identity_turn(mom_q))
        self.assertTrue(is_companion_identity_turn(dad_q))
        # is_companion_identity_turn is what web_search.should_search checks first.
        self.assertFalse(is_companion_identity_turn("tell me about my mom"))

        mom_reply = try_companion_family_reply(mom_q)
        dad_reply = try_companion_family_reply(dad_q)
        self.assertIsNotNone(mom_reply)
        self.assertIsNotNone(dad_reply)
        self.assertEqual(mom_reply, companion_mom_reply_text())
        self.assertEqual(dad_reply, companion_dad_reply_text())
        robotic_phrases = (
            "lookup",
            "context you're asking",
            "not sure who my mom",
            "assistant",
            "AI",
            "here and now",
            "here-and-now",
            "right-now",
            "on this call",
            "right now person",
        )
        all_family_replies = (
            mom_reply,
            dad_reply,
            companion_parents_reply_text(),
            companion_siblings_reply_text(),
            companion_family_reply_text(),
        )
        for reply in all_family_replies:
            lower = reply.lower()
            for phrase in robotic_phrases:
                self.assertNotIn(phrase.lower(), lower, msg=f"{phrase!r} in {reply!r}")

        self.assertNotEqual(companion_mom_reply_text(), companion_dad_reply_text())

        robotic = (
            "I am not sure who my mom is in the context you're asking. "
            "My lookup didn't give me a specific name related to me."
        )
        fixed = finalize_family_reply(mom_q, robotic)
        self.assertEqual(fixed, companion_mom_reply_text())
        self.assertNotIn("lookup", fixed.lower())

    def test_polish_strips_robotic_family_self_talk(self):
        raw = (
            "I'm kind of a here-and-now person on this call. "
            "My lookup didn't give me a name for my mom."
        )
        polished = polish_for_speech(raw).lower()
        for phrase in (
            "here and now",
            "here-and-now",
            "on this call",
            "lookup didn't",
            "my lookup",
        ):
            self.assertNotIn(phrase, polished, msg=polish_for_speech(raw))

    def test_user_family_not_companion_family(self):
        self.assertIsNone(try_companion_family_reply("tell me about my mom"))
        self.assertFalse(is_companion_identity_turn("do you remember my dad?"))

    def test_user_age_not_companion_age_question(self):
        self.assertFalse(is_companion_identity_turn("How old am I?"))
        self.assertIsNone(try_companion_age_reply("How old am I?"))

    def test_your_birthday_is_companion_not_user_recall(self):
        import profile

        for msg in (
            "your birthday",
            "your birthday?",
            "do you remember your birthday",
        ):
            with self.subTest(msg=msg):
                self.assertTrue(is_companion_directed_message(msg))
                self.assertIsNotNone(try_companion_birth_reply(msg))
                self.assertIsNone(profile.try_memory_recall_reply(msg))
        self.assertIsNone(try_companion_birth_reply("my birthday is June 3"))

    def test_web_search_skips_user_age(self):
        import web_search

        self.assertFalse(web_search.is_factual_question("How old am I?"))
        self.assertFalse(web_search.should_search("What's my age?"))
        self.assertFalse(web_search.is_factual_question("What year was I born?"))

    def test_profile_turn_omits_chat_history(self):
        from main import build_chat_context
        import memory

        memory.append_exchange("I'm 47.", "You're forty seven.")
        memory.append_exchange("How old am I?", "You're forty seven.")
        with patch.object(profile, "get_facts", return_value={"age": "48"}):
            ctx = build_chat_context("How old am I?", web_block=None, hits=[])
        self.assertEqual(ctx.history, [])
        self.assertTrue(needs_friend_notes_context("How old am I?"))

    def test_polish_strips_lookup_age_talk(self):
        raw = (
            "I can't find your age or birth year in the lookup results. "
            "They don't have that information."
        )
        polished = polish_for_speech(raw).lower()
        self.assertNotIn("lookup", polished)
        self.assertNotIn("can't find your age", polished)


if __name__ == "__main__":
    unittest.main()
