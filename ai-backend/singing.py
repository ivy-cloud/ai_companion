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


@dataclass(frozen=True)
class SingingIntent:
    style: str
    mood: str
    include_chorus: bool
    copyrighted_request: bool


def is_song_request(message: str) -> bool:
    text = message.strip()
    return bool(text and _SING_INTENT.search(text))


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
