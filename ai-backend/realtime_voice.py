"""
Phase 5 — OpenAI Realtime / speech-to-speech (deferred).

Prerequisites before implementation:
  - Streaming partial STT + always-on barge-in monitor (Phase 4.5, shipped)
  - Stable echo_suppressed rate on phone hardware
  - Session turn protocol compatible with memory / profile growth

This module is a placeholder interface only — no runtime wiring yet.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Optional, Protocol


class RealtimeVoiceSession(Protocol):
    """Future: bidirectional audio + events with a speech-to-speech provider."""

    async def connect(self) -> None: ...

    async def send_audio(self, pcm_chunk: bytes) -> None: ...

    async def events(self) -> AsyncIterator[dict[str, Any]]: ...

    async def close(self) -> None: ...


def realtime_configured() -> bool:
    """True when provider credentials and feature flag are set."""
    return False


def realtime_status() -> dict[str, Optional[str]]:
    return {
        "ready": False,
        "provider": None,
        "note": "Phase 5 — see COMPANION_ROADMAP.md",
    }


async def open_realtime_session() -> RealtimeVoiceSession:
    raise NotImplementedError(
        "Realtime speech-to-speech is Phase 5 — use batch STT + stream LLM + TTS today."
    )
