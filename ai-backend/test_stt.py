"""STT helpers — content-type normalization and no-match handling."""

import struct
import unittest

import stt


def _minimal_wav(sample_rate: int = 16000) -> bytes:
    """Tiny valid RIFF/WAVE header (no audio samples)."""
    fmt = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"fmt ",
        16,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        sample_rate * 2,
        2,
        16,
        b"data",
        0,
    )
    return b"RIFF" + struct.pack("<I", len(fmt) - 8) + fmt[8:]


class SttContentTypeTests(unittest.TestCase):
    def test_parse_wav_sample_rate_from_header(self) -> None:
        wav = _minimal_wav(22050)
        self.assertEqual(stt._parse_wav_sample_rate(wav), 22050)

    def test_parse_wav_sample_rate_invalid(self) -> None:
        self.assertIsNone(stt._parse_wav_sample_rate(b"not-a-wav"))
        self.assertIsNone(stt._parse_wav_sample_rate(b"RIFF\x00\x00\x00\x00WAVE"))

    def test_guess_content_type_normalizes_client_audio_wav(self) -> None:
        wav = _minimal_wav(16000)
        ct = stt._guess_content_type("recording.wav", "audio/wav", wav)
        self.assertEqual(ct, "audio/wav; codecs=audio/pcm; samplerate=16000")

    def test_guess_content_type_uses_header_sample_rate(self) -> None:
        wav = _minimal_wav(48000)
        ct = stt._guess_content_type("clip.wav", "audio/wav", wav)
        self.assertEqual(ct, "audio/wav; codecs=audio/pcm; samplerate=48000")

    def test_guess_content_type_by_extension_without_fallback(self) -> None:
        wav = _minimal_wav(16000)
        ct = stt._guess_content_type("recording.wav", None, wav)
        self.assertIn("samplerate=16000", ct)

    def test_guess_content_type_non_wav_fallback(self) -> None:
        ct = stt._guess_content_type("clip.m4a", "audio/mp4", b"\x00")
        self.assertEqual(ct, "audio/mp4")


class SttRecognitionResultTests(unittest.TestCase):
    def test_success_returns_text(self) -> None:
        text = stt._recognition_result_to_text(
            {"RecognitionStatus": "Success", "DisplayText": "Hello"},
            partial=False,
        )
        self.assertEqual(text, "Hello")

    def test_no_match_raises_for_final(self) -> None:
        with self.assertRaises(Exception) as ctx:
            stt._recognition_result_to_text(
                {"RecognitionStatus": "NoMatch"},
                partial=False,
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("no speech detected", str(ctx.exception.detail).lower())

    def test_no_match_returns_empty_for_partial(self) -> None:
        text = stt._recognition_result_to_text(
            {"RecognitionStatus": "NoMatch"},
            partial=True,
        )
        self.assertEqual(text, "")

    def test_initial_silence_returns_empty_for_partial(self) -> None:
        text = stt._recognition_result_to_text(
            {"RecognitionStatus": "InitialSilenceTimeout"},
            partial=True,
        )
        self.assertEqual(text, "")

    def test_success_empty_raises_for_final(self) -> None:
        with self.assertRaises(Exception) as ctx:
            stt._recognition_result_to_text(
                {"RecognitionStatus": "Success", "DisplayText": "  "},
                partial=False,
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_success_empty_returns_empty_for_partial(self) -> None:
        text = stt._recognition_result_to_text(
            {"RecognitionStatus": "Success", "DisplayText": ""},
            partial=True,
        )
        self.assertEqual(text, "")

    def test_detailed_format_nbest_fallback(self) -> None:
        text = stt._text_from_recognition(
            {
                "RecognitionStatus": "Success",
                "NBest": [{"Display": "from nbest"}],
            }
        )
        self.assertEqual(text, "from nbest")


if __name__ == "__main__":
    unittest.main()
