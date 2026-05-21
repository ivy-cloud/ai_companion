"""Unit tests for direct-answer routing (math, context slimming)."""

import unittest

from context import (
    build_context_appendix,
    companion_math_reply,
    is_simple_math_question,
    needs_clock_context,
    needs_friend_notes_context,
)
from personality import build_turn_hints


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


if __name__ == "__main__":
    unittest.main()
