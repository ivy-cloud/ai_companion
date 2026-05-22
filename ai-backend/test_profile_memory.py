"""Unit tests for user memory store (profile facts + categorized memories)."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import profile


class ProfileMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._profile_path = Path(self._tmpdir.name) / "profile.json"
        self._patch_path = patch.object(profile, "_PROFILE_PATH", self._profile_path)
        self._patch_path.start()
        profile.clear_facts()

    def tearDown(self) -> None:
        self._patch_path.stop()
        self._tmpdir.cleanup()

    def test_learn_name_explicit(self) -> None:
        result = profile.learn_from_user_message("My name is Alex.")
        self.assertIn("name", result.updated)
        self.assertEqual(profile.get_facts()["name"], "Alex")

    def test_no_learn_from_question(self) -> None:
        result = profile.learn_from_user_message("What is my name?")
        self.assertEqual(result.updated, [])
        self.assertEqual(profile.get_facts(), {})

    def test_no_learn_from_inference(self) -> None:
        result = profile.learn_from_user_message("I guess my name is Sam.")
        self.assertEqual(result.updated, [])
        self.assertEqual(profile.get_facts(), {})

    def test_conflict_does_not_overwrite(self) -> None:
        profile.learn_from_user_message("My name is Alex.")
        result = profile.learn_from_user_message("My name is Jordan.")
        self.assertTrue(result.conflicts)
        self.assertEqual(profile.get_facts()["name"], "Alex")
        reply = profile.try_memory_conflict_reply("My name is Jordan.")
        self.assertIsNotNone(reply)
        self.assertIn("Alex", reply or "")

    def test_recall_unknown_name(self) -> None:
        reply = profile.try_memory_recall_reply("What's my name?")
        self.assertIsNotNone(reply)
        self.assertIn("don't think", (reply or "").lower())

    def test_recall_stored_name(self) -> None:
        profile.learn_from_user_message("My name is Alex.")
        reply = profile.try_memory_recall_reply("What's my name?")
        self.assertIn("Alex", reply or "")

    def test_preference_memory(self) -> None:
        result = profile.learn_from_user_message("I really like hiking.")
        self.assertTrue(result.updated)
        items = profile.get_memory_items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["category"], "preference")
        self.assertEqual(items[0]["confidence"], "high")

    def test_favorite_conflict(self) -> None:
        profile.learn_from_user_message("My favorite color is blue.")
        result = profile.learn_from_user_message("My favorite color is red.")
        self.assertTrue(result.conflicts)
        items = profile.get_memory_items()
        self.assertEqual(len(items), 1)
        self.assertIn("blue", items[0]["value"].lower())

    def test_format_notes_includes_categories(self) -> None:
        profile.learn_from_user_message("My name is Alex.")
        profile.learn_from_user_message("I love jazz.")
        notes = profile.format_notes_for_prompt()
        self.assertIn("Profile", notes)
        self.assertIn("Preferences", notes)
        self.assertIn("confidence", notes)

    def test_store_schema_fields(self) -> None:
        profile.learn_from_user_message("My name is Alex.")
        data = json.loads(self._profile_path.read_text())
        entry = data["facts"]["name"]
        self.assertEqual(entry["source"], "user")
        self.assertIn("timestamp", entry)
        self.assertEqual(entry["category"], "user_profile")
        self.assertEqual(entry["confidence"], "high")

    def test_learn_age_its_48(self) -> None:
        result = profile.learn_from_user_message("It's 48.")
        self.assertIn("age", result.updated)
        self.assertEqual(profile.get_facts()["age"], "48")

    def test_learn_age_explicit(self) -> None:
        profile.learn_from_user_message("My age is 48.")
        self.assertEqual(profile.get_facts()["age"], "48")

    def test_recall_age_stored(self) -> None:
        profile.learn_from_user_message("I'm 48.")
        reply = profile.try_memory_recall_reply("How old am I?")
        self.assertIn("48", reply or "")

    def test_recall_age_unknown(self) -> None:
        reply = profile.try_memory_recall_reply("How old am I?")
        self.assertIsNotNone(reply)
        self.assertIn("don't think", (reply or "").lower())

    def test_user_age_learn_reply(self) -> None:
        reply = profile.try_user_age_learn_reply("it's 48")
        self.assertIn("48", reply or "")
        self.assertEqual(profile.get_facts()["age"], "48")

    def test_no_learn_age_from_question(self) -> None:
        result = profile.learn_from_user_message("How old am I?")
        self.assertEqual(result.updated, [])

    def test_user_age_is_memory_recall(self) -> None:
        self.assertTrue(profile.is_memory_recall_question("How old am I?"))
        self.assertTrue(profile.is_user_age_recall_question("What's my age?"))


if __name__ == "__main__":
    unittest.main()
