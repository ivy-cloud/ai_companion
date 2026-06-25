"""Unit tests for voice + text task detection and hints."""

import unittest

import voice_text_tasks


class VoiceTextTasksTests(unittest.TestCase):
    def test_detects_joke(self) -> None:
        self.assertEqual(voice_text_tasks.detect_task_type("tell me a joke"), "joke")

    def test_detects_poem(self) -> None:
        self.assertEqual(voice_text_tasks.detect_task_type("write me a haiku"), "poem")

    def test_detects_translate(self) -> None:
        self.assertEqual(
            voice_text_tasks.detect_task_type("how do you say hello in Spanish"),
            "translate",
        )

    def test_detects_quiz(self) -> None:
        self.assertEqual(
            voice_text_tasks.detect_task_type("quiz me on world capitals"),
            "quiz_me",
        )

    def test_detects_write_message(self) -> None:
        self.assertEqual(
            voice_text_tasks.detect_task_type("help me text my boss back"),
            "write_message",
        )

    def test_casual_chat_returns_none(self) -> None:
        self.assertIsNone(voice_text_tasks.detect_task_type("how are you tonight?"))

    def test_task_hint_for_joke(self) -> None:
        hint = voice_text_tasks.task_turn_hint("got a joke about cats?")
        self.assertIn("Joke", hint)

    def test_task_hint_for_personalized_song(self) -> None:
        hint = voice_text_tasks.task_turn_hint("sing about my dog please")
        self.assertIn("original", hint.lower())
        self.assertIn("dog", hint.lower())

    def test_generic_song_no_hint(self) -> None:
        hint = voice_text_tasks.task_turn_hint("sing me something chill")
        self.assertEqual(hint, "")


if __name__ == "__main__":
    unittest.main()
