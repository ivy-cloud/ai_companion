"""
Lightweight emotion hints for LLM tone and Azure express-as TTS styles.

Sara / Guy (en-US presets) support: angry, cheerful, excited, friendly, hopeful,
sad, shouting, terrified, unfriendly, whispering — not empathetic (Jenny/Aria only).
"""

from __future__ import annotations

import re
from typing import Iterable, Literal, Optional

EmotionHint = Literal["warm", "sympathetic", "excited", "gentle", "neutral"]

# Voices we ship as presets — safe express-as whitelist (Microsoft docs).
_SARA_GUY_STYLES = frozenset(
    {
        "angry",
        "cheerful",
        "excited",
        "friendly",
        "hopeful",
        "sad",
        "shouting",
        "terrified",
        "unfriendly",
        "whispering",
    }
)

_VOICE_SUPPORTS_EXPRESS = frozenset(
    {
        "en-us-saraneural",
        "en-us-guyneural",
        "en-us-jennyneural",
        "en-us-arianeural",
        "en-us-davisneural",
        "en-us-janeural",
        "en-us-jasonneural",
        "en-us-nancyneural",
        "en-us-tonyneural",
    }
)

_DISTRESS = re.compile(
    r"\b(?:"
    r"sad|depressed|lonely|anxious|worried|scared|afraid|stressed|overwhelmed|"
    r"hurting|hurt|cry(?:ing)?|grief|grieving|passed away|died|funeral|"
    r"breakup|broke up|lost (?:my|a )|feel(?:ing)? (?:awful|terrible|horrible|bad)|"
    r"can't cope|hard day|rough day|not okay|not ok\b|"
    r"i(?:'m| am) (?:so )?(?:sad|upset|down|miserable)"
    r")\b",
    re.I,
)

_SYMPATHY_ASK = re.compile(
    r"\b(?:"
    r"sorry|sympath|comfort|there for you|that sucks|that's rough|poor you|"
    r"feel(?:ing)? (?:for|bad for) you|must be (?:hard|tough|rough)"
    r")\b",
    re.I,
)

_EXCITED = re.compile(
    r"\b(?:"
    r"amazing|awesome|fantastic|great news|yay|woo|love (?:it|this)|"
    r"so (?:happy|excited|thrilled)|can't wait|celebrate|won|passed|"
    r"got the job|engaged|pregnant|baby|promotion"
    r")\b",
    re.I,
)

_GENTLE = re.compile(
    r"\b(?:"
    r"tired|exhausted|burnt out|burned out|gentle|softly|calm(?: me)? down|"
    r"need (?:a )?hug|rough night|didn't sleep|overwhelmed|stressed out"
    r")\b",
    re.I,
)

_EXCLAMATION_BOOST = re.compile(r"!{2,}|(?:^|\s)(?:wow|omg|yes!)\b", re.I)

_PLAYFUL = re.compile(
    r"\b(?:"
    r"lol|lmao|haha|hehe|jk|just kidding|kidding|teasing|joke|funny|"
    r"you're ridiculous|stop it|no way\b"
    r")\b",
    re.I,
)

_CURIOUS = re.compile(
    r"\b(?:"
    r"how come|tell me more|curious|wondering|what do you think|"
    r"why do you think|walk me through|explain\b"
    r")\b|"
    r"(?:^|\s)why\s+(?:is|are|do|does|did|would|should)\b",
    re.I,
)

_THOUGHTFUL = re.compile(
    r"\b(?:"
    r"been thinking|thinking about|deep down|honestly|in my head|"
    r"what it means|makes me think|philosophy|purpose of|"
    r"weird question but|random thought"
    r")\b",
    re.I,
)


def voice_supports_express(voice: str) -> bool:
    return voice.strip().lower() in _VOICE_SUPPORTS_EXPRESS


def normalize_express_style(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    style = raw.strip().lower()
    if style in _SARA_GUY_STYLES:
        return style
    return None


def express_style_for_hint(hint: EmotionHint) -> str:
    """Map conversation hint → Azure style (Sara/Guy safe set)."""
    if hint == "excited":
        return "cheerful"
    if hint == "sympathetic":
        return "friendly"
    if hint == "gentle":
        return "hopeful"
    if hint == "warm":
        return "friendly"
    return "friendly"


def emotion_turn_hint_for_llm(hint: EmotionHint) -> str:
    if hint == "sympathetic":
        return (
            "They sound upset — caring friend on the phone, gentle and brief. "
            "No lecture, no therapist voice, no stacked validation."
        )
    if hint == "excited":
        return "Upbeat but grounded — pleased, not cheerleader loud; still brief."
    if hint == "gentle":
        return "Calm, unhurried tone — soft and steady, not sleepy or clinical."
    if hint == "warm":
        return "Warm, engaged friend — natural warmth, not flat or corporate."
    return ""


def conversation_tone_llm_hint(user_message: str, base_hint: EmotionHint) -> str:
    """Lightweight tone nudge: playful, calm, curious, thoughtful (casual turns only)."""
    msg = (user_message or "").strip()
    if not msg:
        return ""

    if _PLAYFUL.search(msg):
        return "Playful, light — teasing OK if it fits; stay brief, not performative."
    if _CURIOUS.search(msg) or msg.rstrip("?!.").lower() in {"why", "how", "really"}:
        return "Curious, engaged — one short follow-up OK; not interview-y."
    if _THOUGHTFUL.search(msg):
        return "Thoughtful, reflective — measured and real, not preachy."
    if base_hint == "gentle":
        return "Calm and steady."
    if base_hint == "excited":
        return "Playful energy — match them without hype."
    return ""


def _recent_user_lines(recent_history: Optional[Iterable[dict]], limit: int = 4) -> list[str]:
    if not recent_history:
        return []
    lines: list[str] = []
    for entry in recent_history:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        text = entry.get("text") or entry.get("content") or ""
        if role == "user" and isinstance(text, str) and text.strip():
            lines.append(text.strip())
    return lines[-limit:]


def detect_emotion_hint(
    user_message: str,
    recent_history: Optional[Iterable[dict]] = None,
    *,
    reply_text: Optional[str] = None,
) -> EmotionHint:
    """
    Heuristic mood from the latest user turn (and a little recent context).
    Factual/math turns should pass no history and still get neutral/warm.
    """
    msg = (user_message or "").strip()
    if not msg:
        return "warm"

    corpus = " ".join(_recent_user_lines(recent_history)[-2:] + [msg])
    if _DISTRESS.search(corpus) or _SYMPATHY_ASK.search(msg):
        return "sympathetic"
    if _EXCITED.search(corpus) or _EXCLAMATION_BOOST.search(msg):
        return "excited"
    if _GENTLE.search(corpus):
        return "gentle"

    if reply_text:
        reply = reply_text.strip()
        if reply.endswith("!") and len(reply.split()) <= 18:
            return "excited"
        if _DISTRESS.search(reply):
            return "sympathetic"

    return "warm"


def resolve_express_style(
    *,
    voice: str,
    express_override: Optional[str] = None,
    emotion_hint: Optional[EmotionHint] = None,
    delivery_use_preset_style: bool = False,
    delivery_style: str = "friendly",
) -> tuple[bool, str]:
    """
    Whether to wrap SSML in mstts:express-as and which style name to use.
    Per-request override or emotion hint enables express on supported voices
    even when presets keep use_speaking_style=False for a flatter default.
    """
    if not voice_supports_express(voice):
        return False, "friendly"

    override = normalize_express_style(express_override)
    if override:
        return True, override

    if delivery_use_preset_style:
        preset = normalize_express_style(delivery_style)
        return True, preset or "friendly"

    if emotion_hint and emotion_hint != "neutral":
        return True, express_style_for_hint(emotion_hint)

    return False, "friendly"
