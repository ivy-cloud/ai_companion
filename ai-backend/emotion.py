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

# Text proxy for audio frustration (Hume: apologetic/softer tone).
_FRUSTRATED = re.compile(
    r"\b(?:"
    r"ugh|annoyed|frustrated|irritated|this is (?:stupid|dumb|ridiculous)|"
    r"doesn't work|does not work|not working|wrong again|come on|"
    r"stop (?:it|that)|whatever\b|you never|you always|"
    r"why (?:won't|can't|doesn't)|for the (?:third|fourth|fifth) time"
    r")\b|"
    r"(?:^|\s)(?:no\.|ugh\.|seriously\??)\s*$",
    re.I,
)

# ALL-CAPS words (≥3 letters) — energy proxy when STT preserves casing.
_CAPS_WORD = re.compile(r"\b[A-Z]{3,}\b")

_NEUTRAL_PITCH = frozenset(
    {"", "0st", "+0st", "medium", "default", "neutral", "x-medium"},
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


def express_style_for_singing(message: str) -> str:
    """TTS express-as for singing turns — brighter for hype, softer for lullabies."""
    lower = (message or "").strip().lower()
    if any(w in lower for w in ("lullaby", "sleep", "bedtime", "soft", "sad", "calm")):
        return "hopeful"
    if any(w in lower for w in ("love", "romantic", "miss you", "for you")):
        return "friendly"
    return "cheerful"


def singing_prosody_params(message: str) -> dict[str, str | int]:
    """
    Slower rate + lifted pitch + longer pauses — Azure TTS cannot carry a real melody,
    but this reads more like sung speech than flat conversation.
    """
    lower = (message or "").strip().lower()
    if "lullaby" in lower or any(w in lower for w in ("sleep", "bedtime", "hush")):
        return {"rate": "0.76", "pitch": "+0.75st", "break_ms": 480}
    if "rap" in lower or "freestyle" in lower or "bars" in lower:
        return {"rate": "0.94", "pitch": "+0.25st", "break_ms": 220}
    if any(w in lower for w in ("hype", "energetic", "party", "dance")):
        return {"rate": "0.90", "pitch": "+1.75st", "break_ms": 300}
    if any(w in lower for w in ("sad", "soft", "calm", "gentle")):
        return {"rate": "0.80", "pitch": "+0.5st", "break_ms": 420}
    return {"rate": "0.84", "pitch": "+1.35st", "break_ms": 360}


def prosody_rate_for_hint(hint: Optional[EmotionHint], base_rate: str) -> str:
    """
    Nudge SSML rate to match conversational vibe (Hume-style prosody match).
    Sympathetic/gentle → slightly slower; excited → slightly faster.
    """
    if not hint or hint == "neutral":
        return base_rate
    try:
        mult = float(base_rate.strip())
    except ValueError:
        return base_rate
    if hint in ("sympathetic", "gentle"):
        return f"{mult * 0.96:.3f}".rstrip("0").rstrip(".")
    if hint == "excited":
        return f"{min(mult * 1.04, 1.18):.3f}".rstrip("0").rstrip(".")
    return base_rate


def prosody_pitch_for_hint(hint: Optional[EmotionHint], base_pitch: str) -> str:
    """
    Nudge SSML pitch for friend-like expressiveness (Her: pitch variance reads human).
    Warm/excited → slightly brighter; sympathetic/gentle → slightly softer.
    """
    p = (base_pitch or "").strip().lower()
    if p in _NEUTRAL_PITCH or not hint or hint == "neutral":
        return base_pitch
    if not re.match(r"^[+-]?\d+(\.\d+)?st$", base_pitch.strip(), re.I):
        base_pitch = "-0.5st"
    try:
        val = float(base_pitch.rstrip("st"))
    except ValueError:
        return base_pitch
    if hint in ("sympathetic", "gentle"):
        return f"{val - 0.15:.2f}st".rstrip("0").rstrip(".")
    if hint in ("warm", "excited"):
        return f"{val + 0.12:.2f}st".rstrip("0").rstrip(".")
    return base_pitch


def emotion_turn_hint_for_llm(hint: EmotionHint) -> str:
    if hint == "sympathetic":
        return (
            "They sound upset — caring friend on the phone, gentle and brief. "
            "Acknowledge the feeling in plain words; one soft follow-up OK. "
            "No lecture, no therapist voice, no stacked validation, no 'I hear that you're'."
        )
    if hint == "excited":
        return "A little pleased — not cheerleader loud, not performative; still brief."
    if hint == "gentle":
        return "Calm, unhurried tone — soft and steady, not sleepy or clinical."
    if hint == "warm":
        return (
            "Warm, engaged friend — natural warmth, not flat or corporate. "
            "Stay with them; don't pivot to fixing or coaching unless they ask. "
            "Tiny reactions OK (that's wild, I love that, wait really?) — one at most."
        )
    return ""


def silence_comfort_turn_hint(
    user_message: str,
    base_hint: EmotionHint,
) -> str:
    """
    When they're brief or low — shorter, warmer replies; presence over questions.
    """
    msg = (user_message or "").strip()
    if not msg:
        return ""

    words = len(msg.split())
    brief = words <= 3 or (words <= 5 and not msg.rstrip("?!.").endswith("?"))
    low = base_hint in ("sympathetic", "gentle") or _DISTRESS.search(msg)

    if not brief and not low:
        return ""
    if brief and low:
        return (
            "Silence comfort: they're quiet and low — one warm sentence, "
            "under 12 words if you can; presence, not fixing; no stacked questions."
        )
    if low:
        return (
            "Silence comfort: keep it short and warm — one sentence; "
            "stay with them, don't coach or interview."
        )
    return (
        "Silence comfort: they were brief — match their energy; "
        "one relaxed sentence, warm not chatty."
    )


def prosody_vibe_turn_hint(user_message: str, base_hint: EmotionHint) -> str:
    """
    Text-based prosody proxy (Hume/Gemini affective dialog) — match energy, soften on frustration.
    STT is usually lower-case; caps/exclamation still land often enough to help.
    """
    msg = (user_message or "").strip()
    if not msg:
        return ""

    if _FRUSTRATED.search(msg):
        return (
            "They sound frustrated — stay calm, brief, slightly apologetic if you contributed "
            "to the snag; no cheerfulness, no 'I understand your concern'."
        )

    caps = _CAPS_WORD.findall(msg)
    if len(caps) >= 2 or (len(caps) == 1 and _EXCLAMATION_BOOST.search(msg)):
        return "High energy — match their pace and enthusiasm; still brief, don't shout back."

    if _EXCLAMATION_BOOST.search(msg) and base_hint == "excited":
        return "Excited vibe — share the moment; one exclamation OK, not hype-y."

    words = len(msg.split())
    if words <= 3 and not msg.rstrip().endswith("?"):
        return "Curt and brief — one relaxed sentence back; don't over-explain."

    return ""


def conversation_tone_llm_hint(user_message: str, base_hint: EmotionHint) -> str:
    """Lightweight tone nudge: playful, calm, curious, thoughtful (casual turns only)."""
    msg = (user_message or "").strip()
    if not msg:
        return ""

    if _FRUSTRATED.search(msg):
        return "Frustrated — calm and direct; fix or clarify without defensiveness."

    if _PLAYFUL.search(msg):
        return (
            "Playful friend energy — light teasing or laughing with them OK; "
            "stay brief, not performative or try-hard."
        )
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
    if _FRUSTRATED.search(msg) or _FRUSTRATED.search(corpus):
        return "sympathetic"
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
