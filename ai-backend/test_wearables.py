"""Wearables audio source header normalization and companion session API."""

import json
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

import main


class WearablesAudioSourceTests(unittest.TestCase):
    def test_normalize_phone_default(self) -> None:
        self.assertEqual(main._normalize_audio_source(None), "phone")
        self.assertEqual(main._normalize_audio_source(""), "phone")
        self.assertEqual(main._normalize_audio_source("phone"), "phone")

    def test_normalize_meta_aliases(self) -> None:
        for raw in ("meta-glasses", "meta-stub", "meta-glasses-stub", "Meta-Glasses"):
            self.assertEqual(main._normalize_audio_source(raw), "meta-glasses")

    def test_audio_extra_only_non_phone(self) -> None:
        self.assertIsNone(main._audio_source_extra(None))
        self.assertIsNone(main._audio_source_extra("phone"))
        self.assertEqual(
            main._audio_source_extra("meta-stub"),
            {"audio_source": "meta-glasses"},
        )


class WearablesApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self._env = mock.patch.dict(
            os.environ,
            {"DEV_MOCK_LLM": "1", "DEV_MOCK_TTS": "1", "DEV_MOCK_STT": "1"},
            clear=False,
        )
        self._env.start()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self._env.stop()

    def test_session_open_force(self) -> None:
        response = self.client.get("/companion/session-open?force=1")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data.get("offered"))
        self.assertIsInstance(data.get("line"), str)
        self.assertGreater(len(data["line"]), 5)

    def test_session_goodbye(self) -> None:
        response = self.client.get("/companion/session-goodbye")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("line", data)
        self.assertIn("time_band", data)

    def test_chat_logs_meta_audio_source(self) -> None:
        with mock.patch.object(main.session_log, "log_turn") as log_turn:
            response = self.client.post(
                "/chat",
                json={"message": "hey"},
                headers={"X-Audio-Source": "meta-glasses"},
            )
            self.assertEqual(response.status_code, 200)
            # Drain stream
            list(response.iter_lines())
            self.assertTrue(log_turn.called)
            kwargs = log_turn.call_args.kwargs
            extra = kwargs.get("extra") or {}
            self.assertEqual(extra.get("audio_source"), "meta-glasses")

    def test_chat_omits_phone_audio_source(self) -> None:
        with mock.patch.object(main.session_log, "log_turn") as log_turn:
            response = self.client.post(
                "/chat",
                json={"message": "hey"},
                headers={"X-Audio-Source": "phone"},
            )
            list(response.iter_lines())
            kwargs = log_turn.call_args.kwargs
            extra = kwargs.get("extra")
            if extra:
                self.assertNotIn("audio_source", extra)


if __name__ == "__main__":
    unittest.main()
