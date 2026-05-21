"""Azure Speech-to-Text (REST) — same subscription as Neural TTS."""

import json
from typing import Optional

import httpx
from fastapi import HTTPException

from tts import (
    _locale_from_voice,
    _raise_for_azure_error,
    _speech_key,
    _speech_region,
    _speech_voice,
    tts_configured,
)

MAX_AUDIO_BYTES = 6 * 1024 * 1024  # 6 MB

_CONTENT_TYPES = {
    "wav": "audio/wav; codecs=audio/pcm; samplerate=16000",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "caf": "audio/x-caf",
    "3gp": "audio/3gpp",
    "mp3": "audio/mpeg",
}


def stt_configured() -> bool:
    return tts_configured()


def stt_status() -> dict:
    ready = stt_configured()
    return {
        "ready": ready,
        "locale": _locale_from_voice(_speech_voice()) if ready else None,
        "region": _speech_region() if ready else None,
    }


def _stt_url(locale: str) -> str:
    region = _speech_region()
    return (
        f"https://{region}.stt.speech.microsoft.com/speech/recognition/"
        f"conversation/cognitiveservices/v1?language={locale}"
    )


def _guess_content_type(filename: str, fallback: Optional[str]) -> str:
    if fallback and "audio" in fallback.lower():
        return fallback
    ext = ""
    if "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
    return _CONTENT_TYPES.get(ext, "audio/wav; codecs=audio/pcm; samplerate=16000")


def transcribe_audio(
    audio_bytes: bytes,
    *,
    filename: str = "recording.wav",
    content_type: Optional[str] = None,
) -> str:
    if not stt_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Azure Speech is not configured. Set AZURE_SPEECH_KEY and "
                "AZURE_SPEECH_REGION in ai-backend/.env (same as TTS)."
            ),
        )

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="audio file too large")

    locale = _locale_from_voice(_speech_voice())
    url = _stt_url(locale)
    headers = {
        "Ocp-Apim-Subscription-Key": _speech_key(),
        "Content-Type": _guess_content_type(filename, content_type),
        "Accept": "application/json",
    }

    try:
        response = httpx.post(
            url,
            content=audio_bytes,
            headers=headers,
            timeout=45.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Azure STT request failed: {exc}") from exc

    if response.status_code != 200:
        _raise_for_azure_error(response)

    try:
        data = response.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Azure STT returned invalid JSON") from exc

    status = str(data.get("RecognitionStatus", "")).strip()
    if status == "Success":
        text = str(data.get("DisplayText", "")).strip()
        if text:
            return text
        raise HTTPException(status_code=400, detail="no speech detected")

    if status in ("NoMatch", "InitialSilenceTimeout"):
        raise HTTPException(status_code=400, detail="no speech detected — try again")

    detail = str(data.get("DisplayText") or status or "recognition failed")
    raise HTTPException(status_code=400, detail=detail)
