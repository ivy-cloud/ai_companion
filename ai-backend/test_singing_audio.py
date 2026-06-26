"""Unit tests for singing audio API client (mocked — no real API calls)."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

import singing_audio


class SingingAudioConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        singing_audio.clear_cache()
        self._env = os.environ.copy()

    def tearDown(self) -> None:
        os.environ.clear()
        os.environ.update(self._env)
        singing_audio.clear_cache()

    def test_disabled_without_key(self) -> None:
        os.environ.pop("SINGING_API_KEY", None)
        os.environ.pop("REPLICATE_API_TOKEN", None)
        os.environ["SINGING_ENABLED"] = "true"
        self.assertFalse(singing_audio.is_enabled())

    def test_enabled_with_key(self) -> None:
        os.environ["SINGING_API_KEY"] = "r8_test"
        os.environ["SINGING_ENABLED"] = "true"
        self.assertTrue(singing_audio.is_enabled())

    def test_disabled_when_flag_off(self) -> None:
        os.environ["SINGING_API_KEY"] = "r8_test"
        os.environ["SINGING_ENABLED"] = "false"
        self.assertFalse(singing_audio.is_enabled())


class SingingAudioLyricsTests(unittest.TestCase):
    def test_extract_strips_intro(self) -> None:
        reply = (
            "Okay, here's a little original one:\n"
            "Stars above the window,\n"
            "Whisper soft and low,\n"
        )
        lyrics = singing_audio.extract_lyrics_from_reply(reply)
        self.assertIn("Stars above", lyrics)
        self.assertNotIn("Okay", lyrics)

    def test_format_adds_verse_tag(self) -> None:
        formatted = singing_audio.format_lyrics_for_api("Line one\nLine two")
        self.assertTrue(formatted.startswith("[Verse]"))
        self.assertIn("Line one", formatted)


class SingingAudioGenerateTests(unittest.TestCase):
    def setUp(self) -> None:
        singing_audio.clear_cache()
        self._env = os.environ.copy()
        os.environ["SINGING_API_KEY"] = "r8_test"
        os.environ["SINGING_ENABLED"] = "true"

    def tearDown(self) -> None:
        os.environ.clear()
        os.environ.update(self._env)
        singing_audio.clear_cache()

    @patch("singing_audio.httpx.Client")
    def test_generate_success_sync(self, client_cls: MagicMock) -> None:
        mock_client = MagicMock()
        client_cls.return_value.__enter__.return_value = mock_client

        create_resp = MagicMock()
        create_resp.raise_for_status.return_value = None
        create_resp.json.return_value = {
            "status": "succeeded",
            "output": "https://replicate.delivery/test-song.mp3",
        }

        download_resp = MagicMock()
        download_resp.raise_for_status.return_value = None
        download_resp.content = b"ID3fake-mp3"

        mock_client.post.return_value = create_resp
        mock_client.get.return_value = download_resp

        audio = singing_audio.generate_song_audio("Line one\nLine two", style="lullaby")
        self.assertEqual(audio, b"ID3fake-mp3")
        mock_client.post.assert_called_once()
        call_kwargs = mock_client.post.call_args
        self.assertIn("lyrics", call_kwargs.kwargs["json"]["input"])

    @patch("singing_audio.httpx.Client")
    def test_generate_polls_when_processing(self, client_cls: MagicMock) -> None:
        mock_client = MagicMock()
        client_cls.return_value.__enter__.return_value = mock_client

        create_resp = MagicMock()
        create_resp.raise_for_status.return_value = None
        create_resp.json.return_value = {
            "status": "processing",
            "urls": {"get": "https://api.replicate.com/v1/predictions/abc"},
        }

        poll_resp = MagicMock()
        poll_resp.raise_for_status.return_value = None
        poll_resp.json.return_value = {
            "status": "succeeded",
            "output": "https://replicate.delivery/polled.mp3",
        }

        download_resp = MagicMock()
        download_resp.raise_for_status.return_value = None
        download_resp.content = b"polled-audio"

        mock_client.post.return_value = create_resp
        mock_client.get.side_effect = [poll_resp, download_resp]

        with patch("singing_audio.time.sleep"):
            audio = singing_audio.generate_song_audio("Sing line\nAnother line")
        self.assertEqual(audio, b"polled-audio")

    def test_generate_returns_none_when_disabled(self) -> None:
        os.environ["SINGING_ENABLED"] = "false"
        self.assertIsNone(singing_audio.generate_song_audio("hello"))

    @patch("singing_audio.generate_song_audio", return_value=b"cached-mp3")
    def test_generate_and_cache(self, _mock_gen: MagicMock) -> None:
        audio_id = singing_audio.generate_and_cache("Line one\nLine two")
        self.assertIsNotNone(audio_id)
        cached = singing_audio.get_cached_audio(audio_id or "")
        self.assertEqual(cached, (b"cached-mp3", "audio/mpeg"))


if __name__ == "__main__":
    unittest.main()
