"""Voice preset resolution."""

import os
import unittest
from unittest.mock import patch

from voice_config import normalize_gender, resolve_voice_delivery


class VoiceConfigTests(unittest.TestCase):
    def test_normalize_gender(self):
        self.assertEqual(normalize_gender("male"), "male")
        self.assertEqual(normalize_gender("Female"), "female")
        self.assertEqual(normalize_gender(""), "female")

    def test_female_soft_preset(self):
        d = resolve_voice_delivery("female")
        self.assertEqual(d.voice, "en-US-SaraNeural")
        self.assertEqual(d.gender, "female")
        self.assertFalse(d.use_speaking_style)
        self.assertEqual(d.pitch_main, "medium")

    def test_male_soft_preset(self):
        d = resolve_voice_delivery("male")
        self.assertEqual(d.voice, "en-US-GuyNeural")

    @patch.dict(
        os.environ,
        {
            "AZURE_SPEECH_VOICE": "en-US-JennyNeural",
            "COMPANION_VOICE_USE_PRESET": "true",
            "COMPANION_VOICE_GENDER": "female",
        },
        clear=False,
    )
    def test_env_preset_overrides_jenny(self):
        d = resolve_voice_delivery()
        self.assertEqual(d.voice, "en-US-SaraNeural")


if __name__ == "__main__":
    unittest.main()
