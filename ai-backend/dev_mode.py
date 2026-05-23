"""
Laptop dev / sim flags — mock cloud services for fast local debugging.

Enable with env vars (see DEV.md):
  DEV_MOCK_LLM=1   — canned streaming chat (no Groq/Ollama)
  DEV_MOCK_TTS=1   — silent audio clip (no Azure TTS)
  DEV_MOCK_STT=1   — fixed transcript (no Azure STT)
  DEV_LOCAL_FRONTEND=1 — start.sh points Expo at 127.0.0.1
"""

from __future__ import annotations

import os
from typing import Iterator, List


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def mock_llm_enabled() -> bool:
    return _truthy("DEV_MOCK_LLM")


def mock_tts_enabled() -> bool:
    return _truthy("DEV_MOCK_TTS")


def mock_stt_enabled() -> bool:
    return _truthy("DEV_MOCK_STT")


def dev_mode_active() -> bool:
    return mock_llm_enabled() or mock_tts_enabled() or mock_stt_enabled()


def mock_status() -> dict:
    return {
        "active": dev_mode_active(),
        "mock_llm": mock_llm_enabled(),
        "mock_tts": mock_tts_enabled(),
        "mock_stt": mock_stt_enabled(),
        "local_frontend": _truthy("DEV_LOCAL_FRONTEND"),
        "mock_stt_text": os.environ.get("DEV_MOCK_STT_TEXT", "Hello from mock microphone."),
    }


def _last_user_text(messages: List[dict]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user":
            return str(msg.get("content", "")).strip()
    return ""


def mock_stream_chat_text(messages: List[dict], *, factual: bool = False) -> Iterator[str]:
    """Tiny NDJSON-friendly stream; no network."""
    user = _last_user_text(messages)
    snippet = (user[:72] + "…") if len(user) > 72 else user
    if factual:
        reply = (
            f"Here's a short test answer about «{snippet}». "
            "(Backend test mode — no real AI or web search.)"
        )
    else:
        reply = (
            f"Got it — you said «{snippet}». "
            "(Backend test mode — turn off DEV_MOCK_LLM for real replies.)"
        )
    step = 10
    for i in range(0, len(reply), step):
        yield reply[i : i + step]


def mock_complete_chat(messages: List[dict], **kwargs) -> str:
    chunks = list(mock_stream_chat_text(messages, factual=kwargs.get("factual", False)))
    return "".join(chunks)


def mock_stt_transcript() -> str:
    return os.environ.get("DEV_MOCK_STT_TEXT", "Hello from mock microphone.").strip()


# Minimal valid WAV: 16-bit mono 16 kHz, ~100 ms silence (works with expo-av even if saved as .mp3).
_DEV_SILENT_WAV = (
    bytes(
        [
            0x52,
            0x49,
            0x46,
            0x46,
            0x24,
            0x08,
            0x00,
            0x00,
            0x57,
            0x41,
            0x56,
            0x45,
            0x66,
            0x6D,
            0x74,
            0x20,
            0x10,
            0x00,
            0x00,
            0x00,
            0x01,
            0x00,
            0x01,
            0x00,
            0x80,
            0x3E,
            0x00,
            0x00,
            0x00,
            0x7D,
            0x00,
            0x00,
            0x02,
            0x00,
            0x10,
            0x00,
            0x64,
            0x61,
            0x74,
            0x61,
            0x00,
            0x08,
            0x00,
            0x00,
        ]
    )
    + b"\x00" * 2048
)


def mock_tts_audio() -> bytes:
    return _DEV_SILENT_WAV


def mock_tts_health() -> dict:
    return {
        "ready": True,
        "voice": "dev-mock",
        "voice_label": "Dev mock (silent)",
        "voice_gender": "female",
        "region": "local",
        "env_file_exists": True,
        "subscription_key_set": True,
        "custom_tts_endpoint": False,
        "speaking_style": None,
        "speaking_style_enabled": False,
        "express_tts_supported": False,
        "express_styles": [],
        "voice_options": [],
        "dev_mock": True,
    }


def mock_stt_health() -> dict:
    return {
        "ready": True,
        "locale": "en-US",
        "region": "local",
        "dev_mock": True,
    }
