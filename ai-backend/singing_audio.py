"""External singing/music API — Replicate MiniMax Music 2.6 with TTS fallback."""

from __future__ import annotations

import logging
import os
import re
import time
import uuid
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

REPLICATE_MODEL = "minimax/music-2.6"
REPLICATE_PREDICTIONS_URL = f"https://api.replicate.com/v1/models/{REPLICATE_MODEL}/predictions"

_INTRO_LINE = re.compile(
    r"^(?:"
    r"okay[,.]? |"
    r"here'?s |"
    r"i can'?t do exact lyrics from that song,? but "
    r")"
    r".{0,120}:?\s*$",
    re.I,
)

_STYLE_PROMPTS: dict[str, str] = {
    "lullaby": "C major, 70 BPM, soft lullaby, gentle piano, female vocal, sleepy",
    "rap": "E minor, 95 BPM, hip hop beat, confident rhythmic vocal",
    "acoustic": "G major, 85 BPM, acoustic guitar ballad, female vocal, warm",
    "pop": "C major, 100 BPM, upbeat pop, female vocal, catchy",
    "rnb": "D minor, 88 BPM, smooth R&B, soulful female vocal",
    "romantic": "A major, 80 BPM, romantic acoustic, tender female vocal",
    "hype": "F major, 120 BPM, energetic pop, bright female vocal",
    "soft": "E major, 75 BPM, soft indie, gentle female vocal",
}

_audio_cache: dict[str, tuple[bytes, str]] = {}


def _truthy(name: str, default: str = "") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def is_enabled() -> bool:
    """True when singing API is configured and not explicitly disabled."""
    if not _truthy("SINGING_ENABLED", "true"):
        return False
    return bool(api_key())


def api_key() -> str:
    return (
        os.environ.get("SINGING_API_KEY", "").strip()
        or os.environ.get("REPLICATE_API_TOKEN", "").strip()
    )


def provider() -> str:
    return os.environ.get("SINGING_API_PROVIDER", "replicate").strip().lower() or "replicate"


def status() -> dict:
    key = api_key()
    return {
        "enabled": is_enabled(),
        "provider": provider(),
        "model": REPLICATE_MODEL if provider() == "replicate" else None,
        "configured": bool(key),
        "hint": (
            "Set SINGING_API_KEY (Replicate token) in ai-backend/.env — "
            "https://replicate.com/account/api-tokens"
            if not key
            else None
        ),
    }


def extract_lyrics_from_reply(reply: str) -> str:
    """Strip canned/LLM intro lines; keep lyric body only."""
    lines = [line.strip() for line in reply.splitlines() if line.strip()]
    if not lines:
        return ""
    if len(lines) > 1 and _INTRO_LINE.match(lines[0]):
        lines = lines[1:]
    return "\n".join(lines).strip()


def format_lyrics_for_api(lyrics: str, include_chorus: bool = False) -> str:
    body = lyrics.strip()
    if not body:
        return ""
    if re.search(r"\[(?:Verse|Chorus|Bridge|Intro|Outro)\]", body, re.I):
        return body
    raw_lines = [line.strip() for line in body.splitlines() if line.strip()]
    if not raw_lines:
        return ""
    if include_chorus and len(raw_lines) >= 4:
        mid = max(2, len(raw_lines) // 2)
        verse = "\n".join(raw_lines[:mid])
        chorus = "\n".join(raw_lines[mid:])
        return f"[Verse]\n{verse}\n[Chorus]\n{chorus}"
    return "[Verse]\n" + "\n".join(raw_lines)


def style_prompt(style: str, mood: str) -> str:
    base = _STYLE_PROMPTS.get(style) or _STYLE_PROMPTS["acoustic"]
    if mood in {"gentle", "tender", "sleepy", "warm"}:
        return f"{base}, intimate and soft"
    if mood in {"bright", "confident"}:
        return f"{base}, uplifting"
    return base


def store_audio(data: bytes, content_type: str = "audio/mpeg") -> str:
    audio_id = uuid.uuid4().hex
    _audio_cache[audio_id] = (data, content_type)
    return audio_id


def get_cached_audio(audio_id: str) -> Optional[tuple[bytes, str]]:
    return _audio_cache.get(audio_id)


def clear_cache() -> None:
    _audio_cache.clear()


def _download_audio(url: str, timeout: float = 60.0) -> bytes:
    with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
        response = client.get(url)
        response.raise_for_status()
        return response.content


def _poll_replicate_prediction(
    client: httpx.Client,
    prediction_url: str,
    *,
    deadline: float,
) -> Optional[str]:
    while time.monotonic() < deadline:
        response = client.get(prediction_url)
        response.raise_for_status()
        payload = response.json()
        status_value = payload.get("status")
        if status_value == "succeeded":
            output = payload.get("output")
            if isinstance(output, str):
                return output
            if isinstance(output, list) and output:
                return str(output[0])
            return None
        if status_value in {"failed", "canceled"}:
            error = payload.get("error") or status_value
            logger.warning("Replicate singing prediction failed: %s", error)
            return None
        time.sleep(2.0)
    logger.warning("Replicate singing prediction timed out")
    return None


def generate_song_audio(
    lyrics: str,
    *,
    style: str = "acoustic",
    mood: str = "warm",
    include_chorus: bool = False,
    timeout_sec: float = 120.0,
) -> Optional[bytes]:
    """
    Call Replicate MiniMax Music 2.6 with lyrics + style prompt.
    Returns MP3 bytes or None on failure / missing key.
    """
    if not is_enabled():
        return None
    if provider() != "replicate":
        logger.warning("Unsupported SINGING_API_PROVIDER: %s", provider())
        return None

    formatted = format_lyrics_for_api(lyrics, include_chorus=include_chorus)
    if len(formatted) < 8:
        return None

    token = api_key()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": f"wait={int(min(timeout_sec, 120))}",
    }
    body = {
        "input": {
            "prompt": style_prompt(style, mood),
            "lyrics": formatted[:3500],
        }
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(timeout_sec + 15, connect=10.0)) as client:
            response = client.post(REPLICATE_PREDICTIONS_URL, headers=headers, json=body)
            response.raise_for_status()
            payload = response.json()
            audio_url: Optional[str] = None
            status_value = payload.get("status")
            if status_value == "succeeded":
                output = payload.get("output")
                if isinstance(output, str):
                    audio_url = output
                elif isinstance(output, list) and output:
                    audio_url = str(output[0])
            elif status_value in {"starting", "processing"}:
                urls = payload.get("urls") or {}
                get_url = urls.get("get")
                if get_url:
                    audio_url = _poll_replicate_prediction(
                        client,
                        get_url,
                        deadline=time.monotonic() + timeout_sec,
                    )
            if not audio_url:
                return None
            return _download_audio(audio_url, timeout=60.0)
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Replicate singing HTTP %s: %s",
            exc.response.status_code,
            exc.response.text[:240],
        )
        return None
    except httpx.RequestError as exc:
        logger.warning("Replicate singing request failed: %s", exc)
        return None


def generate_and_cache(
    lyrics: str,
    *,
    style: str = "acoustic",
    mood: str = "warm",
    include_chorus: bool = False,
) -> Optional[str]:
    """Generate song audio and return cache id for GET /singing/audio/{id}."""
    audio = generate_song_audio(
        lyrics,
        style=style,
        mood=mood,
        include_chorus=include_chorus,
    )
    if not audio:
        return None
    return store_audio(audio)
