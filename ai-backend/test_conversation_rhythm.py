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
        long_msg = " ".join(["word"] * 50)
        meta = rhythm.rhythm_stream_meta(long_msg, factual=False)
        self.assertTrue(meta.get("companion_interrupt"))

    def test_medium_monologue_sets_companion_interrupt_meta(self):
        medium_msg = " ".join(["word"] * 30)
        meta = rhythm.rhythm_stream_meta(medium_msg, factual=False)
        self.assertTrue(meta.get("companion_interrupt"))
        short_msg = " ".join(["word"] * 20)
        short_meta = rhythm.rhythm_stream_meta(short_msg, factual=False)
        self.assertFalse(short_meta.get("companion_interrupt"))

    def test_monologue_interrupt_turn_hint(self):
        long_msg = " ".join(["yeah"] * 50)
        hint = rhythm.monologue_interrupt_turn_hint(long_msg)
        self.assertIn("cooperative", hint.lower())
        self.assertEqual(rhythm.monologue_interrupt_turn_hint("short message"), "")

    def test_monologue_interrupt_jumped_in_hint(self):
        msg = " ".join(["word"] * 15)
        hint = rhythm.monologue_interrupt_turn_hint(msg, jumped_in=True)
        self.assertIn("jumped in", hint.lower())

    def test_simple_acknowledgment_detected(self):
        for msg in ("OK.", "okay", "yeah", "got it", "cool"):
            self.assertTrue(rhythm.is_simple_acknowledgment(msg), msg=msg)
        self.assertFalse(rhythm.is_simple_acknowledgment("OK but why?"))
        hint = rhythm.acknowledgment_turn_hint("OK.")
        self.assertIn("don't therapize", hint.lower())
        self.assertIn("distress", hint.lower())


if __name__ == "__main__":
    unittest.main()
