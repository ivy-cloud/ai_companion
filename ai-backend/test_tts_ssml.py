"""SSML helpers for Azure TTS."""

import unittest

from tts import _wrap_prosody


class TtsSsmlTests(unittest.TestCase):
    def test_omits_neutral_pitch(self):
        xml = _wrap_prosody("0.96", "0st", "Hello.")
        self.assertIn('rate="0.96"', xml)
        self.assertNotIn("pitch=", xml)

    def test_keeps_explicit_pitch(self):
        xml = _wrap_prosody("0.96", "+0.5st", "Hello.")
        self.assertIn('pitch="+0.5st"', xml)


if __name__ == "__main__":
    unittest.main()
