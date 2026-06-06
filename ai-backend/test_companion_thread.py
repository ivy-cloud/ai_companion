"""Companion proactive thread planning — no network."""

import unittest

import companion_thread
import memory


class CompanionThreadTests(unittest.TestCase):
    def setUp(self) -> None:
        companion_thread.clear_thread()
        memory.clear()

    def tearDown(self) -> None:
        companion_thread.clear_thread()
        memory.clear()

    def test_plan_beats_after_reply(self) -> None:
        beats = companion_thread.plan_follow_up_beats(
            "work has been stressful lately",
            "That sounds like a lot to carry. I'm here.",
        )
        self.assertGreaterEqual(len(beats), 1)
        self.assertLessEqual(len(beats), 2)
        self.assertTrue(all(len(b) > 10 for b in beats))

    def test_update_and_consume_beats(self) -> None:
        companion_thread.update_after_reply(
            "tell me about your day",
            "Pretty quiet — I've been thinking about music.",
        )
        state = companion_thread.get_thread_state()
        self.assertIsNotNone(state)
        assert state is not None
        self.assertIn("day", state.topic.lower())
        self.assertTrue(state.next_beat)

        beat = companion_thread.consume_next_beat()
        self.assertIsNotNone(beat)
        stream_beats = companion_thread.proactive_beats_for_stream()
        self.assertLessEqual(len(stream_beats), 2)

    def test_proactive_turn_hint_warm_not_interrogative(self) -> None:
        companion_thread.update_after_reply("yeah", "I hear you.")
        hint = companion_thread.proactive_turn_hint()
        self.assertIn("Proactive voice turn", hint)
        self.assertIn("no interrogation", hint.lower())

    def test_append_assistant_continuation(self) -> None:
        memory.append_exchange("hello", "Hey there.")
        memory.append_assistant_continuation("Still thinking about that.")
        hist = memory.get_history()
        self.assertEqual(len(hist), 2)
        self.assertEqual(hist[-1]["role"], "assistant")
        self.assertIn("Still thinking", hist[-1]["text"])

    def test_is_proactive_user_message(self) -> None:
        self.assertTrue(
            companion_thread.is_proactive_user_message(
                companion_thread.PROACTIVE_USER_MARKER
            )
        )
        self.assertFalse(companion_thread.is_proactive_user_message("hello"))


if __name__ == "__main__":
    unittest.main()
