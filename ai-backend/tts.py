"""Azure Neural Text-to-Speech (REST)."""

import html
import os
import re
import unicodedata
from pathlib import Path
from typing import Optional

import httpx
from fastapi import HTTPException

_BACKEND_DIR = Path(__file__).resolve().parent
_ENV_FILE = _BACKEND_DIR / ".env"

MAX_TTS_CHARS = 500

# Placeholder left from .env.example — not a real key
_PLACEHOLDER_KEYS = frozenset(
    {
        "",
        "your_speech_subscription_key",
        "paste_your_key_here",
        "changeme",
    }
)

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "]+",
    flags=re.UNICODE,
)

from emotion import normalize_express_style, resolve_express_style, voice_supports_express
from spoken_text import normalize_for_speech
from voice_config import VoiceDelivery, resolve_voice_delivery, voice_options_for_client


def _ssml_escape_text(text: str) -> str:
    """Plain escaped text — numbers are already words; avoids spelled fragments."""
    return html.escape(text, quote=False)


def _speech_key_raw() -> str:
    """Azure / Speech SDK env names (read at call time so .env reload works)."""
    return (
        os.environ.get("AZURE_SPEECH_KEY", "")
        or os.environ.get("SPEECH_KEY", "")
        or os.environ.get("AZURE_SPEECH_SUBSCRIPTION_KEY", "")
    ).strip()


def _speech_key() -> str:
    key = _speech_key_raw()
    if key.lower() in _PLACEHOLDER_KEYS:
        return ""
    return key


def _speech_region() -> str:
    r = (
        os.environ.get("AZURE_SPEECH_REGION", "")
        or os.environ.get("SPEECH_REGION", "")
    ).strip()
    return r if r else "eastus"


def _speech_voice(gender_override: Optional[str] = None) -> str:
    return resolve_voice_delivery(gender_override).voice


def _delivery(gender_override: Optional[str] = None) -> VoiceDelivery:
    return resolve_voice_delivery(gender_override)


def _use_speaking_style(delivery: VoiceDelivery) -> bool:
    return delivery.use_speaking_style


def _speaking_style_name(delivery: VoiceDelivery) -> str:
    raw = delivery.speaking_style.strip().lower() or "friendly"
    if not re.match(r"^[a-z][a-z0-9-]{0,31}$", raw):
        return "friendly"
    return raw


def _tts_output_format() -> str:
    fmt = os.environ.get(
        "AZURE_SPEECH_OUTPUT_FORMAT",
        "audio-24khz-160kbitrate-mono-mp3",
    ).strip()
    if not fmt or not re.match(r"^[a-z0-9.-]+$", fmt, re.I):
        return "audio-24khz-160kbitrate-mono-mp3"
    return fmt


def _locale_from_voice(voice: str) -> str:
    """e.g. en-US-JennyNeural -> en-US; fr-FR-DeniseNeural -> fr-FR."""
    parts = voice.split("-")
    if len(parts) >= 2 and len(parts[0]) == 2 and len(parts[1]) == 2:
        return f"{parts[0]}-{parts[1]}"
    return "en-US"


def _tts_url() -> str:
    """Regional default or optional custom host (see .env.example)."""
    custom = os.environ.get("AZURE_SPEECH_ENDPOINT", "").strip().rstrip("/")
    if not custom:
        region = _speech_region()
        return f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    if custom.endswith("/cognitiveservices/v1"):
        return custom
    return f"{custom}/cognitiveservices/v1"


def _escape_and_break_sentences(cleaned: str) -> str:
    """Natural pauses between sentences inside one TTS request."""
    parts = re.split(r"(?<=[.!?])\s+", cleaned.strip())
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) <= 1:
        return _ssml_escape_text(cleaned)
    inner = '<break time="240ms"/>'.join(_ssml_escape_text(p) for p in parts)
    return inner


_NEUTRAL_PITCH = frozenset(
    {"", "0st", "+0st", "medium", "default", "neutral", "x-medium"},
)


def _wrap_prosody(rate: str, pitch: str, escaped_text: str) -> str:
    """Azure rejects pitch='0st' (FailedPrecondition) — omit pitch when neutral."""
    p = pitch.strip().lower()
    if p in _NEUTRAL_PITCH:
        return f'<prosody rate="{rate}">{escaped_text}</prosody>'
    return f'<prosody rate="{rate}" pitch="{pitch}">{escaped_text}</prosody>'


def _build_ssml(
    voice: str,
    rate: str,
    pitch: str,
    escaped_text: str,
    *,
    use_express: bool,
    express_style: str,
) -> str:
    locale = _locale_from_voice(voice)
    v_attr = html.escape(voice, quote=True)
    loc_attr = html.escape(locale, quote=True)
    style_attr = html.escape(express_style, quote=True)
    prosody = _wrap_prosody(rate, pitch, escaped_text)

    if use_express:
        inner = f'<mstts:express-as style="{style_attr}">{prosody}</mstts:express-as>'
        return (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            'xmlns:mstts="http://www.w3.org/2001/mstts" '
            f'xml:lang="{loc_attr}">'
            f'<voice xml:lang="{loc_attr}" name="{v_attr}">'
            f"{inner}"
            "</voice></speak>"
        )

    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xml:lang="{loc_attr}">'
        f'<voice xml:lang="{loc_attr}" name="{v_attr}">'
        f"{prosody}"
        "</voice></speak>"
    )


def _raise_for_azure_error(response: httpx.Response) -> None:
    body = (response.text or response.reason_phrase or "")[:800]
    code = response.status_code
    detail = f"Azure HTTP {code}: {body}"

    if code == 401:
        detail += (
            " — Fix: use Key 1 (or 2) from the same **Speech** resource in Azure Portal → "
            "**Keys and endpoint**. Set `AZURE_SPEECH_REGION` to the **Location** value on "
            "that page (lowercase, e.g. `westus`), matching where that resource was created. "
            "Regenerate the key if it was rotated or copied incorrectly."
        )
        raise HTTPException(status_code=401, detail=detail)
    if code == 403:
        raise HTTPException(status_code=403, detail=detail)
    if code == 400:
        if "FailedPrecondition" in body or "precondition" in body.lower():
            detail += (
                " — Often invalid SSML (e.g. pitch 0st) or voice not in your region. "
                "Try COMPANION_VOICE_USE_PRESET=true or en-US-JennyNeural / SaraNeural."
            )
        raise HTTPException(status_code=400, detail=detail)
    if code == 415:
        raise HTTPException(status_code=415, detail=detail)
    if code == 429:
        raise HTTPException(status_code=429, detail=detail)
    if code >= 500:
        raise HTTPException(status_code=502, detail=detail)
    raise HTTPException(status_code=502, detail=detail)


def tts_configured() -> bool:
    return bool(_speech_key() and _speech_region())


def tts_status(gender_override: Optional[str] = None) -> dict:
    import dev_mode

    if dev_mode.mock_tts_enabled():
        return dev_mode.mock_tts_health()
    key_ok = bool(_speech_key())
    region = _speech_region()
    ready = key_ok and bool(region)
    delivery = _delivery(gender_override)

    status: dict = {
        "ready": ready,
        "voice": delivery.voice,
        "voice_label": delivery.label,
        "voice_gender": delivery.gender,
        "region": region,
        "env_file": str(_ENV_FILE),
        "env_file_exists": _ENV_FILE.is_file(),
        "subscription_key_set": key_ok,
        "custom_tts_endpoint": bool(os.environ.get("AZURE_SPEECH_ENDPOINT", "").strip()),
        "speaking_style": _speaking_style_name(delivery) if ready and _use_speaking_style(delivery) else None,
        "speaking_style_enabled": _use_speaking_style(delivery) if ready else None,
        "express_tts_supported": voice_supports_express(delivery.voice) if ready else None,
        "express_styles": sorted(
            {
                "cheerful",
                "excited",
                "friendly",
                "hopeful",
                "sad",
            }
        )
        if ready and voice_supports_express(delivery.voice)
        else None,
        "voice_options": voice_options_for_client() if ready else [],
    }

    if not ready:
        if not _ENV_FILE.is_file():
            status["hint"] = (
                f"No .env at {_ENV_FILE} — copy ai-backend/.env.example to .env "
                "and set AZURE_SPEECH_KEY (or SPEECH_KEY)."
            )
        elif not key_ok:
            status["hint"] = (
                "Speech key missing or still the placeholder. In ai-backend/.env set "
                "AZURE_SPEECH_KEY=<key from Azure Portal → Speech resource → Keys>. "
                "Also try: export AZURE_SPEECH_KEY=... if an empty shell var blocks .env."
            )

    return status


def _clean_for_speech(text: str) -> str:
    cleaned = unicodedata.normalize("NFKC", text)
    cleaned = _EMOJI_RE.sub("", cleaned)
    return normalize_for_speech(cleaned)


def _normalize_prosody_rate(raw: str, default: str) -> str:
    """
    Azure SSML prosody rate: multiplier (1.0 = default) or relative % (+10%).
    Natural voice: ~0.95–1.02 (use AZURE_SPEECH_RATE_MAIN=0.98 or 1.02 in .env).
    """
    value = (raw or default).strip()
    if re.match(r"^[+-]?\d+(\.\d+)?%$", value):
        return value
    if re.match(r"^\d+(\.\d+)?$", value):
        try:
            mult = float(value)
            if 0.5 <= mult <= 2.0:
                return value
        except ValueError:
            pass
    return default


def _prosody_for_style(style: str, delivery: VoiceDelivery) -> tuple[str, str]:
    """SSML prosody rate + pitch from preset or env."""
    if style == "filler":
        rate = _normalize_prosody_rate(
            os.environ.get("AZURE_SPEECH_RATE_FILLER", ""),
            "1.0",
        )
        pitch = os.environ.get("AZURE_SPEECH_PITCH_FILLER", "+0.1st").strip() or "+0.1st"
    else:
        rate = _normalize_prosody_rate(
            os.environ.get("AZURE_SPEECH_RATE_MAIN", ""),
            delivery.rate_main,
        )
        pitch = delivery.pitch_main.strip() or "-0.5st"
    if not re.match(r"^[+-]?\d+(\.\d+)?st$", pitch):
        pitch = "+0.1st" if style == "filler" else "-0.5st"
    return rate, pitch


def synthesize_speech(
    text: str,
    style: str = "default",
    *,
    voice_gender: Optional[str] = None,
    express_style: Optional[str] = None,
    emotion_hint: Optional[str] = None,
) -> bytes:
    import dev_mode

    if dev_mode.mock_tts_enabled():
        return dev_mode.mock_tts_audio()
    if not tts_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Azure Speech is not configured. Set AZURE_SPEECH_KEY and "
                "AZURE_SPEECH_REGION in ai-backend/.env (see .env.example)."
            ),
        )

    cleaned = _clean_for_speech(text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="text cannot be empty after cleanup")
    if len(cleaned) > MAX_TTS_CHARS:
        cleaned = cleaned[:MAX_TTS_CHARS]

    delivery = _delivery(voice_gender)
    rate, pitch = _prosody_for_style(style, delivery)

    voice = delivery.voice
    hint_norm = (emotion_hint or "").strip().lower() or None
    if hint_norm == "neutral":
        hint_norm = None
    use_express, express_name = resolve_express_style(
        voice=voice,
        express_override=express_style,
        emotion_hint=hint_norm,  # type: ignore[arg-type]
        delivery_use_preset_style=_use_speaking_style(delivery),
        delivery_style=_speaking_style_name(delivery),
    )
    if express_style and not normalize_express_style(express_style):
        use_express = False
    escaped = _escape_and_break_sentences(cleaned)
    ssml = _build_ssml(
        voice, rate, pitch, escaped, use_express=use_express, express_style=express_name
    )

    key = _speech_key()
    url = _tts_url()
    output_format = _tts_output_format()
    try:
        response = httpx.post(
            url,
            content=ssml.encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": output_format,
                "User-Agent": "ai-companion",
            },
            timeout=30.0,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Azure TTS request failed: {exc}") from exc

    if response.status_code != 200:
        _raise_for_azure_error(response)

    return response.content
