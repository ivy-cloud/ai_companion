"""
Proactive companion thread — short follow-up beats when the user is quiet.

In-memory state only (v1). Plans 1–2 optional beats after each assistant reply;
the frontend may trigger a proactive turn with `proactive: true` on /chat.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import List, Optional

PROACTIVE_USER_MARKER = "__companion_proactive__"

_MAX_BEATS = 2
_TOPIC_MAX = 80


@dataclass
class CompanionThreadState:
    """Current conversational thread the companion may continue unprompted."""

    topic: str
    next_beat: str
    beats_remaining: List[str] = field(default_factory=list)


_thread: Optional[CompanionThreadState] = None


def get_thread_state() -> Optional[CompanionThreadState]:
    return _thread


def clear_thread() -> None:
    global _thread
    _thread = None


def _extract_topic(user_message: str, assistant_reply: str) -> str:
    user = (user_message or "").strip()
    if user and user != PROACTIVE_USER_MARKER:
        words = user.split()
        snippet = " ".join(words[:8])
        if len(snippet) > _TOPIC_MAX:
            snippet = f"{snippet[: _TOPIC_MAX - 1].rstrip()}…"
        return snippet
    reply = (assistant_reply or "").strip()
    if not reply:
        return "this moment"
    first = re.split(r"(?<=[.!?])\s+", reply)[0].strip()
    if len(first) > _TOPIC_MAX:
        first = f"{first[: _TOPIC_MAX - 1].rstrip()}…"
    return first or "this moment"


def _beat_templates(topic: str, assistant_reply: str) -> List[str]:
    """Deterministic 1–2 short beats from topic + reply tone."""
    digest = hashlib.sha256(f"beats:{topic}:{assistant_reply[:120]}".encode()).hexdigest()
    pool = [
        f"soft curiosity about {topic} — one gentle thought, not a question barrage",
        f"a warm aside related to {topic} — presence, not fixing",
        f"brief reflection on what you just said about {topic}",
        f"a quiet follow-up thread on {topic} — thinking aloud, under two sentences",
        f"share a small personal-feeling note tied to {topic}",
    ]
    idx = int(digest[:4], 16) % len(pool)
    beats = [pool[idx]]
    if int(digest[4:8], 16) % 3 == 0:
        alt = pool[(idx + 2) % len(pool)]
        if alt != beats[0]:
            beats.append(alt)
    return beats[:_MAX_BEATS]


def plan_follow_up_beats(user_message: str, assistant_reply: str) -> List[str]:
    topic = _extract_topic(user_message, assistant_reply)
    return _beat_templates(topic, assistant_reply)


def update_after_reply(user_message: str, assistant_reply: str) -> List[str]:
    """Refresh thread state after a normal or proactive assistant reply."""
    global _thread
    topic = _extract_topic(user_message, assistant_reply)
    beats = _beat_templates(topic, assistant_reply)
    if not beats:
        _thread = None
        return []
    next_beat = beats[0]
    remaining = beats[1:]
    _thread = CompanionThreadState(
        topic=topic,
        next_beat=next_beat,
        beats_remaining=remaining,
    )
    return beats


def consume_next_beat() -> Optional[str]:
    """Pop the next planned beat for a proactive turn."""
    global _thread
    if not _thread:
        return None
    beat = _thread.next_beat
    if _thread.beats_remaining:
        _thread.next_beat = _thread.beats_remaining[0]
        _thread.beats_remaining = _thread.beats_remaining[1:]
    else:
        _thread = None
    return beat


def proactive_beats_for_stream() -> List[str]:
    """Beats queued for the client (may fire while user is silent)."""
    if not _thread:
        return []
    out = [_thread.next_beat, *_thread.beats_remaining]
    return out[:_MAX_BEATS]


def proactive_turn_hint(beat: Optional[str] = None) -> str:
    topic = _thread.topic if _thread else "the chat"
    beat_line = beat or (_thread.next_beat if _thread else "")
    beat_part = f' Beat to weave in: "{beat_line}".' if beat_line else ""
    return (
        f"Proactive voice turn: they are quiet — continue your thread on {topic} warmly.{beat_part} "
        "1–2 short sentences max, thinking aloud — no interrogation, no "
        "'Are you still there?' — gentle monologue snippet; they may interrupt anytime."
    )


def is_proactive_user_message(message: str) -> bool:
    return message.strip() == PROACTIVE_USER_MARKER
