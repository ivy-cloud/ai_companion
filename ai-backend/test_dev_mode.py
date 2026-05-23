"""Dev mock flags — no network."""

import os
import unittest
from unittest import mock

import dev_mode
import llm_provider


class DevModeTests(unittest.TestCase):
    def test_mock_stream(self) -> None:
        chunks = list(
            dev_mode.mock_stream_chat_text(
                [{"role": "user", "content": "Hi there"}],
                factual=False,
            )
        )
        self.assertTrue(chunks)
        self.assertIn("Hi there", "".join(chunks))

    @mock.patch.dict(os.environ, {"DEV_MOCK_LLM": "1"}, clear=False)
    def test_llm_provider_uses_mock(self) -> None:
        self.assertTrue(dev_mode.mock_llm_enabled())
        ready, hint, _ = llm_provider.check_model_ready()
        self.assertTrue(ready)
        self.assertIn("DEV_MOCK", hint or "")
        text = "".join(
            llm_provider.stream_chat_text(
                [{"role": "user", "content": "test"}],
            )
        )
        self.assertIn("test mode", text.lower())


if __name__ == "__main__":
    unittest.main()
