"""Unit tests for companion growth (skills, remember/correct)."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import profile
import profile_growth


class ProfileGrowthTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._profile_path = Path(self._tmpdir.name) / "profile.json"
        self._patch_path = patch.object(profile, "_PROFILE_PATH", self._profile_path)
        self._patch_path.start()
        profile.clear_facts()

    def tearDown(self) -> None:
        self._patch_path.stop()
        self._tmpdir.cleanup()

    def test_remember_that_stores_preference(self) -> None:
        profile_growth.try_explicit_remember_learn(
            "Remember that I hate loud music at night."
        )
        items = profile.get_memory_items()
        self.assertTrue(any("hate loud music" in i["value"].lower() for i in items))

    def test_music_style_structured_id(self) -> None:
        profile_growth.try_structured_preference_learn("My music style is chill jazz.")
        items = profile.get_memory_items()
        self.assertTrue(any(i["id"] == "preference:music_style" for i in items))

    def test_usage_unlocks_skill_hint(self) -> None:
        for _ in range(2):
            profile_growth.record_usage_signals("Sing me a lullaby please")
        hints = profile_growth.get_skill_hints()
        self.assertIn("bedtime song", hints)

    def test_growth_learn_via_main_path(self) -> None:
        result = profile.learn_from_user_message("Remember that I love tea.")
        self.assertTrue(result.updated)
        self.assertTrue(
            any("tea" in i["value"].lower() for i in profile.get_memory_items())
        )

    def test_reflection_via_growth_extras(self) -> None:
        tags = profile_growth.apply_growth_learn_extras(
            "Just found out we broke up and I'm heartbroken."
        )
        self.assertIn("user_shared_moment", tags)


if __name__ == "__main__":
    unittest.main()
