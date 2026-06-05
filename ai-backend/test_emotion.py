"""Emotion hint detection and Azure express-as style selection."""

import unittest

from emotion import (
    detect_emotion_hint,
    express_style_for_hint,
    normalize_express_style,
    resolve_express_style,
    silence_comfort_turn_hint,
    voice_supports_express,
)
class EmotionDetectionTests(unittest.TestCase):
    def test_warm_default(self):
        self.assertEqual(detect_emotion_hint("Hey, what's up?"), "warm")

    def test_sympathetic_distress(self):
        self.assertEqual(
            detect_emotion_hint("I'm really sad and overwhelmed today"),
            "sympathetic",
        )

    def test_excited(self):
        self.assertEqual(
            detect_emotion_hint("That's amazing — I got the job!"),
            "excited",
        )

    def test_gentle(self):
        self.assertEqual(
            detect_emotion_hint("I'm exhausted, need to calm down"),
            "gentle",
        )

    def test_recent_context(self):
        history = [{"role": "user", "text": "I lost my dog yesterday"}]
        self.assertEqual(
            detect_emotion_hint("Yeah.", recent_history=history),
            "sympathetic",
        )

    def test_silence_comfort_brief(self):
        hint = silence_comfort_turn_hint("yeah", "warm")
        self.assertIn("brief", hint.lower())

    def test_silence_comfort_low(self):
        hint = silence_comfort_turn_hint(
            "I've been feeling really sad and overwhelmed lately",
            "sympathetic",
        )
        self.assertIn("short", hint.lower())


class ExpressStyleTests(unittest.TestCase):
    def test_maps_hints(self):
        self.assertEqual(express_style_for_hint("excited"), "cheerful")
        self.assertEqual(express_style_for_hint("sympathetic"), "friendly")
        self.assertEqual(express_style_for_hint("gentle"), "hopeful")

    def test_normalize_rejects_unknown(self):
        self.assertIsNone(normalize_express_style("empathetic"))
        self.assertEqual(normalize_express_style("Cheerful"), "cheerful")

    def test_resolve_emotion_enables_express_on_sara(self):
        use, style = resolve_express_style(
            voice="en-US-SaraNeural",
            emotion_hint="excited",
        )
        self.assertTrue(use)
        self.assertEqual(style, "cheerful")

    def test_resolve_neutral_skips_express(self):
        use, _ = resolve_express_style(
            voice="en-US-SaraNeural",
            emotion_hint="neutral",
        )
        self.assertFalse(use)

    def test_override_wins(self):
        use, style = resolve_express_style(
            voice="en-US-GuyNeural",
            express_override="hopeful",
            emotion_hint="excited",
        )
        self.assertTrue(use)
        self.assertEqual(style, "hopeful")

    def test_voice_support(self):
        self.assertTrue(voice_supports_express("en-US-SaraNeural"))
        self.assertFalse(voice_supports_express("en-GB-SoniaNeural"))


if __name__ == "__main__":
    unittest.main()
