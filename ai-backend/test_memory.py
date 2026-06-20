"""Unit tests for short-term chat memory and follow-up continuity."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import memory
import web_search
from main import build_chat_context


class MemoryContinuityTests(unittest.TestCase):
    def setUp(self) -> None:
        memory.clear()
        self._tmpdir = tempfile.TemporaryDirectory()
        self._history_path = Path(self._tmpdir.name) / "history.json"
        self._patch_path = patch.object(memory, "_HISTORY_PATH", self._history_path)
        self._patch_path.start()

    def tearDown(self) -> None:
        self._patch_path.stop()
        memory.clear()
        self._tmpdir.cleanup()

    def test_last_exchange(self) -> None:
        memory.append_exchange("World Cup is wild.", "Totally.")
        memory.append_exchange("Who's playing tonight?", "Brazil and France.")
        user, asst = memory.last_exchange()
        self.assertEqual(user, "Who's playing tonight?")
        self.assertEqual(asst, "Brazil and France.")

    def test_ambiguous_follow_up_after_topic(self) -> None:
        memory.append_exchange(
            "The World Cup has been amazing this year.",
            "Yeah, so many upsets.",
        )
        self.assertTrue(memory.is_ambiguous_follow_up("last game today"))
        self.assertTrue(memory.is_ambiguous_follow_up("who won"))
        self.assertTrue(memory.is_ambiguous_follow_up("what about that"))
        self.assertTrue(memory.is_ambiguous_follow_up("What are you talking about?"))
        self.assertTrue(memory.is_ambiguous_follow_up("What do you mean?"))

    def test_ambiguous_follow_up_false_without_history(self) -> None:
        self.assertFalse(memory.is_ambiguous_follow_up("last game today"))

    def test_ambiguous_follow_up_false_for_standalone_question(self) -> None:
        memory.append_exchange("Hey", "Hi")
        self.assertFalse(
            memory.is_ambiguous_follow_up("What is the capital of France?")
        )

    def test_current_topic_summary_prefers_substantive_turn(self) -> None:
        memory.append_exchange("yeah", "cool")
        memory.append_exchange(
            "I've been following the World Cup all week.",
            "Nice.",
        )
        topic = memory.current_topic_summary()
        self.assertIsNotNone(topic)
        self.assertIn("World Cup", topic or "")

    def test_should_keep_history_for_ambiguous_factual_follow_up(self) -> None:
        memory.append_exchange(
            "The World Cup final is this weekend.",
            "Big game.",
        )
        keep = memory.should_keep_history_for_turn(
            "last game today",
            math_turn=False,
            profile_turn=False,
            factual=True,
        )
        self.assertTrue(keep)

    def test_should_not_keep_history_for_profile_turn(self) -> None:
        memory.append_exchange("I'm 47.", "Got it.")
        keep = memory.should_keep_history_for_turn(
            "How old am I?",
            math_turn=False,
            profile_turn=True,
            factual=False,
        )
        self.assertFalse(keep)

    def test_build_chat_context_keeps_history_for_world_cup_follow_up(self) -> None:
        memory.append_exchange(
            "The World Cup has been incredible.",
            "So many close games.",
        )
        web_block = "## Live web lookup\n1. Brazil 2-1 France"
        hits = [{"title": "Score", "snippet": "Brazil 2-1", "url": ""}]
        ctx = build_chat_context("last game today", web_block=web_block, hits=hits)
        self.assertGreater(len(ctx.history), 0)
        self.assertIn("World Cup", ctx.latest_user["content"])
        self.assertIn("Continuity", ctx.latest_user["content"])

    def test_search_queries_include_conversation_context(self) -> None:
        queries = web_search.build_search_queries(
            "last game today",
            conversation_context="World Cup semifinal",
        )
        self.assertTrue(any("World Cup" in q for q in queries))


if __name__ == "__main__":
    unittest.main()
