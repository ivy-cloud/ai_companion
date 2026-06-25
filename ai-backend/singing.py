"""Singing intent detection + safe original lyric generation."""

from __future__ import annotations

import re
from dataclasses import dataclass

_SING_INTENT = re.compile(
    r"\b(?:"
    r"sing|song|lullaby|serenade|rap|freestyle|"
    r"hum\b|humming|verse|chorus|melody|"
    r"write (?:me )?(?:a )?(?:song|rap)|"
    r"make (?:me )?(?:a )?(?:song|rap)"
    r")\b",
    re.I,
)

_COPYRIGHT_REQUEST = re.compile(
    r"\b(?:"
    r"sing (?:me )?(?:the )?|"
    r"lyrics (?:to|for)\s+|"
    r"play (?:me )?(?:the )?|"
    r"cover (?:the )?"
    r")",
    re.I,
)

_KNOWN_TITLE_MARKER = re.compile(
    r"(?:"
    r"['\"][^'\"]{2,80}['\"]|"
    r"\bby\s+[A-Z][A-Za-z0-9'&.\- ]{1,60}|"
    r"\b(?:taylor swift|drake|beyonce|adele|billie eilish|ed sheeran|the weeknd)\b"
    r")",
    re.I,
)

_STYLE_HINTS: list[tuple[str, str]] = [
    ("lullaby", "lullaby"),
    ("rap", "rap"),
    ("freestyle", "rap"),
    ("acoustic", "acoustic"),
    ("pop", "pop"),
    ("r&b", "rnb"),
    ("rnb", "rnb"),
    ("sad", "soft"),
    ("calm", "soft"),
    ("romantic", "romantic"),
    ("love", "romantic"),
    ("hype", "hype"),
    ("energetic", "hype"),
]

_MOOD_HINTS: list[tuple[str, str]] = [
    ("sad", "gentle"),
    ("calm", "gentle"),
    ("sleep", "sleepy"),
    ("night", "sleepy"),
    ("happy", "bright"),
    ("hype", "confident"),
    ("energetic", "confident"),
    ("romantic", "tender"),
]

_TOPIC_ABOUT = re.compile(
    r"\b(?:"
    r"(?:sing|write|make|rap)(?:\s+me)?(?:\s+a)?(?:\s+(?:song|rap|verse))?\s+about\s+(.+?)(?:[.!?]|$)|"
    r"(?:song|rap|verse|lullaby)\s+about\s+(.+?)(?:[.!?]|$)|"
    r"about\s+my\s+(.+?)(?:[.!?]|$)"
    r")\b",
    re.I,
)

_TOPIC_FOR = re.compile(
    r"\b(?:"
    r"(?:birthday|bday|wedding|anniversary|graduation|farewell|goodbye|welcome|"
    r"retirement|promotion|valentine(?:'s)?)\s+song(?:\s+for\s+(.+?))?(?:[.!?]|$)|"
    r"song\s+for\s+(.+?)(?:[.!?]|$)|"
    r"sing\s+(?:to|for)\s+(.+?)(?:[.!?]|$)|"
    r"dedicate(?:\s+a\s+song)?\s+to\s+(.+?)(?:[.!?]|$)"
    r")\b",
    re.I,
)

_GENERIC_ONLY = re.compile(
    r"^(?:"
    r"(?:can you |could you |please )?"
    r"(?:sing|hum)(?:\s+me)?(?:\s+(?:something|anything|a\s+(?:song|tune|lullaby|verse)))?"
    r"|(?:sing|hum)\s+(?:something|anything)"
    r"|(?:drop|spit)\s+(?:a\s+)?(?:quick\s+)?(?:rap|verse|bars?)"
    r"|make\s+me\s+a\s+(?:song|rap|tune)"
    r")\.?$",
    re.I,
)


@dataclass(frozen=True)
class SingingIntent:
    style: str
    mood: str
    include_chorus: bool
    copyrighted_request: bool


def is_song_request(message: str) -> bool:
    text = message.strip()
    return bool(text and _SING_INTENT.search(text))


def extract_song_topic(message: str) -> str | None:
    """Pull a custom theme, subject, or dedicatee from the request."""
    text = message.strip()
    if not text:
        return None

    for match in _TOPIC_ABOUT.finditer(text):
        for group in match.groups():
            if group:
                topic = _clean_topic(group)
                if topic:
                    return topic

    for match in _TOPIC_FOR.finditer(text):
        groups = [g for g in match.groups() if g]
        if groups:
            topic = _clean_topic(groups[0])
            if topic:
                return topic
        occasion = match.group(0).split()[0].lower()
        if occasion in {"birthday", "bday", "wedding", "anniversary", "graduation"}:
            return f"{occasion} song"

    return None


def _clean_topic(raw: str) -> str:
    topic = raw.strip().strip("\"'")
    topic = re.sub(r"^(?:my|our|the|a|an)\s+", "", topic, flags=re.I)
    topic = re.sub(r"\s+", " ", topic).strip(" .,!?:;")
    if len(topic) < 2 or len(topic) > 120:
        return ""
    return topic


def should_use_llm_song(message: str) -> bool:
    """
    Personalized or themed songs → LLM with singing hint.
    Generic quick asks and copyrighted-title fallback stay canned.
    """
    text = message.strip()
    if not text or not is_song_request(text):
        return False

    intent = parse_singing_intent(text)
    if not intent:
        return False
    if intent.copyrighted_request:
        return False
    if extract_song_topic(text):
        return True
    if _TOPIC_FOR.search(text):
        return True
    if _GENERIC_ONLY.match(text):
        return False
    return False


def singing_llm_turn_hint(message: str) -> str:
    """LLM hint for original lyrics tailored to their ask."""
    intent = parse_singing_intent(message) or SingingIntent(
        style="acoustic", mood="warm", include_chorus=False, copyrighted_request=False
    )
    topic = extract_song_topic(message)
    style = intent.style
    mood = intent.mood

    parts = [
        "Singing turn: write short **original** lyrics only — never copyrighted song lyrics.",
        "Line breaks OK for chat; speak rhythmically with natural pauses between lines.",
        f"Style: {style}; mood: {mood}.",
    ]
    if topic:
        parts.append(f"Theme or dedicatee: {topic} — weave it in naturally.")
    if intent.include_chorus:
        parts.append("Include a short repeatable chorus or hook.")
    if intent.copyrighted_request:
        parts.append(
            "They asked for a known song — same vibe only, brief original substitute."
        )
    parts.append("Keep it under ~8 lines; warm friend singing, not concert MC.")
    return " ".join(parts)


def parse_singing_intent(message: str) -> SingingIntent | None:
    text = message.strip()
    if not text or not is_song_request(text):
        return None

    lower = text.lower()
    style = "acoustic"
    mood = "warm"
    for needle, value in _STYLE_HINTS:
        if needle in lower:
            style = value
            break
    for needle, value in _MOOD_HINTS:
        if needle in lower:
            mood = value
            break

    include_chorus = "chorus" in lower or "hook" in lower
    copyrighted = bool(_COPYRIGHT_REQUEST.search(text) and _KNOWN_TITLE_MARKER.search(text))
    return SingingIntent(
        style=style,
        mood=mood,
        include_chorus=include_chorus,
        copyrighted_request=copyrighted,
    )


def _lines_for_style(style: str, mood: str) -> list[str]:
    if style == "rap":
        if mood in {"confident", "bright"}:
            return [
                "I step in with a grin and a beat in my chest,",
                "Kick dust off the doubt, now I'm moving my best,",
                "Late night to sunrise, we keep chasing the glow,",
                "You and me, same rhythm, never walking it slow,",
            ]
        return [
            "Soft bass in the dark, and I'm talking low,",
            "Thoughts on the table, let the true words show,",
            "No rush in this moment, just the pulse and the breath,",
            "You and me on the line, steady life over stress,",
        ]
    if style == "lullaby":
        return [
            "Close your eyes, let the quiet hold your name,",
            "Moonlight on the window, breathing slow like rain,",
            "I will hum beside you till the worries fade,",
            "Night keeps us gentle in a silver shade,",
        ]
    if mood in {"tender", "gentle", "sleepy"}:
        return [
            "Slow lights on the ceiling, and the room feels kind,",
            "We can leave the heavy parts outside tonight,",
            "Every little heartbeat learns a softer time,",
            "Stay here in this calm till your shoulders unwind,",
        ]
    if mood in {"bright", "confident"}:
        return [
            "Sun on the pavement and the day says go,",
            "Hands in the air while we laugh on the road,",
            "Every small win turns the city to gold,",
            "You and me, loud joy, never doing what's told,",
        ]
    return [
        "You call my name and the room feels lighter,",
        "Tiny sparks in the dark burning brighter and brighter,",
        "We keep talking like the night is ours to keep,",
        "Heartbeats in rhythm, honest and deep,",
    ]


def _chorus_for_mood(mood: str) -> list[str]:
    if mood in {"sleepy", "gentle", "tender"}:
        return [
            "So breathe in, breathe out, let the world turn slow,",
            "I'm right here in the quiet where the soft winds blow,",
        ]
    if mood in {"bright", "confident"}:
        return [
            "Hands up, lights up, we were made to glow,",
            "Step close, sing loud, let the whole night know,",
        ]
    return [
        "Stay close, stay warm, we can ride this tone,",
        "Same beat, same spark, never singing alone,",
    ]


def build_song_reply(message: str) -> str | None:
    intent = parse_singing_intent(message)
    if not intent:
        return None
    lines = _lines_for_style(intent.style, intent.mood)
    if intent.include_chorus:
        lines.extend(_chorus_for_mood(intent.mood))
    if intent.copyrighted_request:
        lead = "I can't do exact lyrics from that song, but here's an original verse with that vibe:"
    else:
        lead = "Okay, here's a little original one:"
    payload = "\n".join(lines[:8])
    return f"{lead}\n{payload}"
