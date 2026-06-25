"""Unit tests for singing intent + safe lyric fallback."""

import unittest

import singing


class SingingTests(unittest.TestCase):
    def test_detects_song_requests(self) -> None:
        self.assertTrue(singing.is_song_request("Can you sing me a lullaby?"))
        self.assertTrue(singing.is_song_request("Drop a quick rap verse"))
        self.assertFalse(singing.is_song_request("What time is it?"))

    def test_builds_original_song_lines(self) -> None:
        reply = singing.build_song_reply("Sing me something chill with a chorus")
        self.assertIsNotNone(reply)
        lines = [line for line in (reply or "").splitlines() if line.strip()]
        # lead + 4+ lyric lines
        self.assertGreaterEqual(len(lines), 5)
        self.assertIn("original", (reply or "").lower())

    def test_copyright_request_gets_safe_fallback(self) -> None:
        reply = singing.build_song_reply('Sing "Shape of You" by Ed Sheeran')
        self.assertIsNotNone(reply)
        lower = (reply or "").lower()
        self.assertIn("can't do exact lyrics", lower)
        self.assertIn("original", lower)
        self.assertNotIn("i'm in love with the shape of you", lower)

    def test_non_song_request_returns_none(self) -> None:
        self.assertIsNone(singing.build_song_reply("Tell me a joke"))

    def test_extracts_custom_topic(self) -> None:
        self.assertEqual(singing.extract_song_topic("sing about my dog"), "dog")
        self.assertEqual(
            singing.extract_song_topic("birthday song for Alex"),
            "Alex",
        )

    def test_should_use_llm_for_themed_song(self) -> None:
        self.assertTrue(singing.should_use_llm_song("sing a song about the lake"))
        self.assertTrue(singing.should_use_llm_song("birthday song for Jamie"))
        self.assertFalse(singing.should_use_llm_song("sing me something chill"))
        self.assertFalse(singing.should_use_llm_song('Sing "Shape of You" by Ed Sheeran'))

    def test_singing_llm_hint_includes_topic(self) -> None:
        hint = singing.singing_llm_turn_hint("sing about my dog")
        self.assertIn("dog", hint.lower())
        self.assertIn("original", hint.lower())

    def test_generic_song_still_canned(self) -> None:
        self.assertFalse(singing.should_use_llm_song("Can you sing me a lullaby?"))
        reply = singing.build_song_reply("Can you sing me a lullaby?")
        self.assertIsNotNone(reply)


if __name__ == "__main__":
    unittest.main()
