"""
Sesame-style voice rhythm — backchannels, fast acks, and speakable chunk hints.

No new frameworks; used by /chat NDJSON metadata and turn hints only.
"""

from __future__ import annotations

import hashlib
import re
from typing import List, Optional

from context import is_time_question

# Spoken backchannels the model may use (casual turns only, at most one).
BACKCHANNEL_EXAMPLES = (
    "hmm",
    "yeah",
    "oh wow",
    "wait really?",
    "right",
    "okay",
    "honestly",
    "I mean",
)

FAST_ACK_PHRASES = (
    "Yeah,",
    "Hmm,",
    "Right,",
    "Oh wow,",
    "Okay,",
    "Oh nice,",
    "Got it,",
)

_MAX_CHUNK_CHARS = 120
_MAX_CHUNK_SENTENCES = 2
# Short replies: one Azure clip (no dead air between sentences).
_MAX_SINGLE_CLIP_CHARS = 420

_SIMPLE_ACK = re.compile(
    r"^(?:ok(?:ay)?|k|yeah|yep|yup|sure|right|got it|cool|nice|alright|"
    r"mhm|mm(?:-?hmm)?|fair enough|true|totally|uh[\s-]?huh|gotcha)[.!?]*$",
    re.I,
)


def is_simple_acknowledgment(message: str) -> bool:
    """Bare OK/yeah/got it — match energy; don't therapize or reopen the thread."""
    return bool(_SIMPLE_ACK.match((message or "").strip()))


def acknowledgment_turn_hint(message: str) -> str:
    if not is_simple_acknowledgment(message):
        return ""
    return (
        "Simple ack — one short relaxed line back (Cool. / Got it. / Nice.). "
        "Match their energy; do not interpret their ack as distress. "
        "Don't therapize, coach, or dig into the last topic."
    )


_STORY_OR_FACT = re.compile(
    r"\b(?:weather|forecast|president|population|calculate|math|what time|what day|"
    r"how old|how much|how many|who is|when was)\b",
    re.I,
)


def is_casual_voice_turn(
    message: str,
    *,
    factual: bool = False,
    math_turn: bool = False,
    memory_recall: bool = False,
) -> bool:
    if factual or math_turn or memory_recall or is_time_question(message):
        return False
    if _STORY_OR_FACT.search(message):
        return False
    return True


def _stable_roll(message: str, salt: str, threshold: float) -> bool:
    """Deterministic per message — same utterance → same choice across retries."""
    digest = hashlib.sha256(f"{salt}:{message.strip().lower()}".encode()).hexdigest()
    bucket = int(digest[:8], 16) / 0xFFFFFFFF
    return bucket < threshold


def maybe_fast_ack(message: str, *, casual: bool) -> Optional[str]:
    """
    Short acknowledgment while the model is still thinking (played by the client).
    ~28% of casual turns with enough substance; never on factual/time turns.
    """
    text = message.strip()
    if not casual or len(text.split()) < 4:
        return None
    if not _stable_roll(text, "fast_ack", 0.22):
        return None
    idx = int(hashlib.sha256(f"ack:{text.lower()}".encode()).hexdigest()[:6], 16) % len(
        FAST_ACK_PHRASES
    )
    return FAST_ACK_PHRASES[idx]


def backchannel_turn_hint(message: str, casual: bool) -> str:
    if not casual:
        return (
            "No backchannel openers (hmm, yeah, oh wow) — lead with the answer in plain words."
        )
    if not _stable_roll(message, "backchannel", 0.28):
        return (
            "Skip backchannel this turn — start with your point. Still brief and human."
        )
    examples = ", ".join(f'"{x}"' for x in BACKCHANNEL_EXAMPLES[:4])
    return (
        f"Casual voice: you may open with ONE brief backchannel ({examples}) "
        "only if it fits — never stacked, never on facts, never customer-support tone. "
        "Sound like you're on the couch with them, not at a help desk."
    )


def monologue_interrupt_turn_hint(message: str, *, jumped_in: bool = False) -> str:
    """Friend-style jump-in — brief ack then respond to what they said so far."""
    words = len(message.split())
    if jumped_in and words >= 12:
        return (
            "You jumped in like a friend mid-story — they were still talking. "
            "One warm brief ack, then your reaction or a gentle question about "
            "what they said so far; don't recap or lecture."
        )
    if words < 45:
        return ""
    return (
        "Long story — gently jump in like a friend: one brief ack "
        "(wait / oh hang on), then respond to what they said; no lecture."
    )


def friend_social_turn_hint(message: str, *, casual: bool) -> str:
    """Anti-assistant nudge for social small talk and casual day comments."""
    if not casual:
        return ""
    from context import is_casual_day_comment, is_social_checkin

    text = message.strip()
    if not text:
        return ""
    parts: list[str] = []
    if is_casual_day_comment(text):
        parts.append(
            "Casual day comment — friend vibe, not calendar police. "
            "Do NOT open with 'No, actually' unless they asked what day it is."
        )
    if is_social_checkin(text):
        parts.append(
            "Social check-in — warm and brief; never 'Thanks for asking' or helper-bot polish."
        )
    return " ".join(parts)


def rhythm_stream_meta(
    message: str,
    *,
    factual: bool = False,
    math_turn: bool = False,
    memory_recall: bool = False,
) -> dict:
    casual = is_casual_voice_turn(
        message,
        factual=factual,
        math_turn=math_turn,
        memory_recall=memory_recall,
    )
    ack = maybe_fast_ack(message, casual=casual)
    meta: dict = {
        "casual": casual,
        "stream_tts": True,
        "interruptible": True,
    }
    if ack:
        meta["fast_ack"] = ack
    if len(message.split()) >= 45:
        meta["companion_interrupt"] = True
    try:
        import profile_growth

        growth = profile_growth.growth_meta_for_stream()
        if growth.get("skill_hints"):
            meta["skill_hints"] = growth["skill_hints"]
    except Exception:
        pass
    try:
        import companion_thread

        beats = companion_thread.proactive_beats_for_stream()
        if beats:
            meta["proactive_beats"] = beats
    except Exception:
        pass
    return meta


def speech_chunks_for_reply(text: str) -> List[str]:
    """
    Smaller TTS-sized chunks for progressive playback (sentence-sized clips).
    """
    from human_speech import trim_for_voice

    cleaned = trim_for_voice(text.strip())
    if not cleaned:
        return []

    if len(cleaned) <= _MAX_SINGLE_CLIP_CHARS:
        return [cleaned]

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    sentences = [s.strip() for s in sentences if s.strip()]
    if not sentences:
        return [cleaned] if len(cleaned) <= _MAX_CHUNK_CHARS else [cleaned[:_MAX_CHUNK_CHARS]]

    # Multiple sentences → one TTS clip each (better barge-in and pacing).
    if len(sentences) > 1:
        chunks: List[str] = []
        buffer = ""
        for sentence in sentences:
            if len(sentence) > _MAX_CHUNK_CHARS:
                if buffer:
                    chunks.append(buffer)
                    buffer = ""
                chunks.append(sentence[:_MAX_CHUNK_CHARS])
                continue
            if buffer and len(f"{buffer} {sentence}") > _MAX_CHUNK_CHARS:
                chunks.append(buffer)
                buffer = sentence
            elif not buffer:
                buffer = sentence
            else:
                chunks.append(buffer)
                buffer = sentence
        if buffer:
            chunks.append(buffer)
        return chunks

    if len(cleaned) <= _MAX_CHUNK_CHARS:
        return [cleaned]
    return [cleaned[:_MAX_CHUNK_CHARS]]
