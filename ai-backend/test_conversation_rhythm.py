"""Conversation rhythm routing — no network."""

import unittest

import conversation_rhythm as rhythm


class ConversationRhythmTests(unittest.TestCase):
    def test_weather_question_is_not_casual(self):
        self.assertFalse(
            rhythm.is_casual_voice_turn(
                "what's the weather tonight",
                factual=True,
            )
        )

    def test_casual_story_triggers_backchannel_hint(self):
        hint = rhythm.backchannel_turn_hint(
            "I had the weirdest dream last night about flying",
            casual=True,
        )
        self.assertIn("backchannel", hint.lower())

    def test_factual_skips_fast_ack(self):
        self.assertIsNone(
            rhythm.maybe_fast_ack(
                "what is the weather tonight in Seattle",
                casual=False,
            )
        )

    def test_speech_chunks_short_reply_is_one_clip(self):
        text = "Yeah, that's wild. I didn't expect that."
        chunks = rhythm.speech_chunks_for_reply(text)
        self.assertEqual(len(chunks), 1)
        self.assertIn("wild", chunks[0])

    def test_rhythm_meta_interruptible(self):
        meta = rhythm.rhythm_stream_meta("tell me about your weekend", factual=False)
        self.assertTrue(meta.get("interruptible"))
        self.assertTrue(meta.get("casual"))
        self.assertTrue(meta.get("stream_tts"))

    def test_factual_still_streams_tts(self):
        meta = rhythm.rhythm_stream_meta(
            "what is the weather tonight",
            factual=True,
        )
        self.assertFalse(meta.get("casual"))
        self.assertTrue(meta.get("stream_tts"))

    def test_long_monologue_sets_companion_interrupt_meta(self):
        long_msg = " ".join(["word"] * 80)
        meta = rhythm.rhythm_stream_meta(long_msg, factual=False)
        self.assertTrue(meta.get("companion_interrupt"))

    def test_monologue_interrupt_turn_hint(self):
        long_msg = " ".join(["yeah"] * 75)
        hint = rhythm.monologue_interrupt_turn_hint(long_msg)
        self.assertIn("jumped in", hint.lower())
        self.assertEqual(rhythm.monologue_interrupt_turn_hint("short message"), "")


if __name__ == "__main__":
    unittest.main()
