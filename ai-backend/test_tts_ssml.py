"""SSML helpers for Azure TTS."""

import unittest

from emotion import singing_prosody_params
from tts import _escape_for_singing, _wrap_prosody


class TtsSsmlTests(unittest.TestCase):
    def test_omits_neutral_pitch(self):
        xml = _wrap_prosody("0.96", "0st", "Hello.")
        self.assertIn('rate="0.96"', xml)
        self.assertNotIn("pitch=", xml)

    def test_keeps_explicit_pitch(self):
        xml = _wrap_prosody("0.96", "+0.5st", "Hello.")
        self.assertIn('pitch="+0.5st"', xml)

    def test_includes_volume_boost(self):
        xml = _wrap_prosody("1.0", "0st", "Hello.", volume="+25%")
        self.assertIn('volume="+25%"', xml)

    def test_singing_splits_lines_with_breaks(self):
        inner = _escape_for_singing("Line one\nLine two", break_ms=400)
        self.assertIn('pitch="+1.0st"', inner)
        self.assertIn('pitch="+1.4st"', inner)
        self.assertIn('<break time="400ms"/>', inner)

    def test_lullaby_prosody_slower(self):
        params = singing_prosody_params("sing me a lullaby for bedtime")
        self.assertEqual(params["rate"], "0.76")
        self.assertGreaterEqual(int(params["break_ms"]), 400)


if __name__ == "__main__":
    unittest.main()
