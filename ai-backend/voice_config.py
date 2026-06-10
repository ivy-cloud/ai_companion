"""Azure neural voice presets — soft, human-sounding female or male."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Optional

VoiceGender = Literal["female", "male"]


@dataclass(frozen=True)
class VoiceDelivery:
    voice: str
    rate_main: str
    pitch_main: str
    speaking_style: str
    use_speaking_style: bool
    gender: VoiceGender
    label: str


# Multilingual neural voices — natural on phone; express-as often sounds robotic.
_PRESETS: dict[VoiceGender, VoiceDelivery] = {
    "female": VoiceDelivery(
        # Sara: soft US female; pitch omitted in SSML (Azure rejects pitch="0st")
        voice="en-US-SaraNeural",
        rate_main="1.10",
        pitch_main="medium",
        speaking_style="friendly",
        use_speaking_style=False,
        gender="female",
        label="Female · soft & natural",
    ),
    "male": VoiceDelivery(
        voice="en-US-GuyNeural",
        rate_main="1.08",
        pitch_main="medium",
        speaking_style="friendly",
        use_speaking_style=False,
        gender="male",
        label="Male · soft & natural",
    ),
}


def normalize_gender(raw: Optional[str]) -> VoiceGender:
    g = (raw or "").strip().lower()
    if g in ("m", "male", "man", "boy", "him"):
        return "male"
    return "female"


def _use_preset_from_env() -> bool:
    v = os.environ.get("COMPANION_VOICE_USE_PRESET", "").strip().lower()
    return v in ("1", "true", "yes")


def resolve_voice_delivery(
    gender_override: Optional[str] = None,
) -> VoiceDelivery:
    """
    Pick TTS voice + prosody.

    Priority:
    1. gender_override from app (Female / Male picker) → preset
    2. COMPANION_VOICE_USE_PRESET=true → preset from COMPANION_VOICE_GENDER
    3. No AZURE_SPEECH_VOICE → preset
    4. Else explicit AZURE_SPEECH_VOICE with env rate/pitch/style
    """
    if gender_override:
        return _PRESETS[normalize_gender(gender_override)]

    if _use_preset_from_env():
        return _PRESETS[normalize_gender(os.environ.get("COMPANION_VOICE_GENDER"))]

    explicit = os.environ.get("AZURE_SPEECH_VOICE", "").strip()
    if not explicit:
        return _PRESETS[normalize_gender(os.environ.get("COMPANION_VOICE_GENDER"))]

    gender = normalize_gender(os.environ.get("COMPANION_VOICE_GENDER"))
    rate = os.environ.get("AZURE_SPEECH_RATE_MAIN", "1.08").strip() or "1.08"
    pitch = os.environ.get("AZURE_SPEECH_PITCH_MAIN", "-0.5st").strip() or "-0.5st"
    style = os.environ.get("AZURE_SPEAKING_STYLE", "friendly").strip().lower() or "friendly"
    use_style = os.environ.get("AZURE_USE_SPEAKING_STYLE", "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    return VoiceDelivery(
        voice=explicit,
        rate_main=rate,
        pitch_main=pitch,
        speaking_style=style,
        use_speaking_style=use_style,
        gender=gender,
        label=f"Custom · {explicit}",
    )


def voice_options_for_client() -> list[dict[str, str]]:
    return [
        {"id": "female", "label": _PRESETS["female"].label, "voice": _PRESETS["female"].voice},
        {"id": "male", "label": _PRESETS["male"].label, "voice": _PRESETS["male"].voice},
    ]
