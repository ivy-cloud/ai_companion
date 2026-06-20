"""
Light companion moments — session openings and time-of-day awareness.

No ML; deterministic copy from profile + clock. Kept brief and optional.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from typing import Literal, Optional

import companion
import memory
import profile
from context import ResolvedClock, format_local_now_parts, resolve_clock

TimeBand = Literal["morning", "afternoon", "evening", "night"]

_OPENING_CHANCE = 0.38


def time_of_day_band(clock: Optional[ResolvedClock] = None) -> TimeBand:
    """Local hour bands for soft greetings (not spoken unless relevant)."""
    resolved = clock or resolve_clock()
    hour = datetime.now(resolved.zone).hour
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "night"


def _user_first_name() -> Optional[str]:
    name = profile.get_facts().get("name", "").strip()
    if not name:
        return None
    token = name.split()[0]
    if re.match(r"^[A-Za-z][A-Za-z'-]{0,19}$", token):
        return token
    return None


def _pick_memory_snippet() -> Optional[str]:
    all_items = profile.get_memory_items()
    shared = [
        i
        for i in all_items
        if str(i.get("id", "")).startswith("emotional_context:user_shared_moment")
        and i["value"].strip()
    ]
    if shared:
        pick = shared[-1]
    else:
        items = [
            i
            for i in all_items
            if i["category"] in ("preference", "recurring_interest", "emotional_context")
            and profile._confidence_allows_assertion(i["confidence"])
            and i["id"] != "emotional_context:mood"
        ]
        if not items:
            return None
        pick = items[-1]
    val = pick["value"].strip()
    if len(val) > 48:
        val = f"{val[:45].rstrip()}…"
    if str(pick.get("id", "")).startswith("emotional_context:user_shared_moment"):
        return f"what you shared — {val}"
    if pick["category"] == "preference":
        return f"you like {val}"
    if pick["category"] == "recurring_interest":
        return f"you're into {val}"
    return val


def _opening_roll_key(clock: ResolvedClock) -> str:
    day = datetime.now(clock.zone).strftime("%Y-%m-%d")
    return f"session_open:{day}:{clock.iana}"


def should_offer_session_opening(clock: Optional[ResolvedClock] = None) -> bool:
    resolved = clock or resolve_clock()
    digest = hashlib.sha256(_opening_roll_key(resolved).encode()).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF < _OPENING_CHANCE


def time_of_day_greeting_phrase(band: TimeBand) -> str:
    if band == "morning":
        return "Good morning"
    if band == "afternoon":
        return "Hey"
    if band == "evening":
        return "Good evening"
    return "Hey"


def _topic_snippet(text: str, max_words: int = 7) -> str:
    words = [w for w in text.strip().split() if w]
    if not words:
        return ""
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]) + "…"


def _resume_opening_roll(last_user: str, clock: ResolvedClock) -> Optional[str]:
    """Continuation, fresh topic, or silent listen when resuming with history."""
    digest = hashlib.sha256(
        f"resume:{last_user[:80]}:{_opening_roll_key(clock)}".encode()
    ).hexdigest()
    roll = int(digest[:8], 16) / 0xFFFFFFFF
    name = _user_first_name()
    hey = f"Hey, {name}." if name else "Hey."
    snippet = _topic_snippet(last_user)
    if roll < 0.42:
        return None
    if roll < 0.72 and snippet:
        return f"{hey} Want to pick up where we left off — {snippet}?"
    return f"{hey} Want to keep going on that, or talk about something new?"


def _fresh_opening_line(resolved: ResolvedClock) -> str:
    band = time_of_day_band(resolved)
    greet = time_of_day_greeting_phrase(band)
    name = _user_first_name()
    lead = f"{greet}, {name}." if name else f"{greet}."
    memory_snip = _pick_memory_snippet()
    if memory_snip and band in ("evening", "night"):
        tail = f" Still thinking about {memory_snip}. How've you been?"
    elif memory_snip:
        tail = f" I remember {memory_snip} — how's that going?"
    elif band == "morning":
        tail = " How's your morning going?"
    elif band == "afternoon":
        tail = " What've you been up to today?"
    elif band == "evening":
        tail = " How was your day?"
    else:
        tail = " What's on your mind tonight?"
    line = f"{lead}{tail}"
    if len(line) > 220:
        line = f"{lead} I'm here if you want to talk."
    return line


def session_opening_line(
    clock: Optional[ResolvedClock] = None,
    *,
    force: bool = False,
    resume: bool = False,
) -> Optional[str]:
    """
    Optional one-line opener when a voice session starts.

    With chat history (resume=True): continue last topic, offer something new,
    or stay silent — no repetitive name intro.
    First sessions: ~38% chance of a curious greeting without "It's {name}…".
    """
    resolved = clock or resolve_clock()
    has_history = memory.exchange_count() > 0

    if resume or (has_history and not force):
        last_user, _ = memory.last_exchange()
        if last_user:
            return _resume_opening_roll(last_user, resolved)
        if has_history and not force:
            return None

    if not force and not should_offer_session_opening(resolved):
        return None

    return _fresh_opening_line(resolved)


def clock_moment_turn_hint(clock: Optional[ResolvedClock] = None) -> str:
    """Rare casual-chat nudge for evening check-in tone (not every turn)."""
    resolved = clock or resolve_clock()
    band = time_of_day_band(resolved)
    digest = hashlib.sha256(f"moment:{band}:{resolved.iana}".encode()).hexdigest()
    if int(digest[:8], 16) / 0xFFFFFFFF > 0.14:
        return ""

    if band == "evening":
        return (
            "Evening check-in — warm and unhurried; one soft question OK, "
            "not clingy, not therapist."
        )
    if band == "night":
        return (
            "Late night — calm, brief; gentle presence, not a sleep lecture."
        )
    if band == "morning":
        return "Morning energy — light and friendly, not pep-talk loud."
    return ""


def clock_context_moment_line(clock: Optional[ResolvedClock] = None) -> str:
    """Extra clock context for the model (not read aloud verbatim)."""
    resolved = clock or resolve_clock()
    band = time_of_day_band(resolved)
    p = format_local_now_parts(resolved)
    return (
        f"- local time band: {band} "
        f"({p['weekday']}, {p['month']} {p['day']})\n"
        "- Evening/night: soft check-in OK on casual chat; never guilt or clinginess."
    )


def _shared_moment_items() -> list[dict]:
    return [
        i
        for i in profile.get_memory_items()
        if str(i.get("id", "")).startswith("emotional_context:user_shared_moment")
        and i.get("value", "").strip()
        and profile._confidence_allows_assertion(i["confidence"])
    ]


def _stable_roll(message: str, salt: str, threshold: float) -> bool:
    digest = hashlib.sha256(f"{salt}:{message.strip().lower()}".encode()).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF < threshold


def emotional_continuity_turn_hint(message: str, *, casual: bool) -> str:
    """
    Occasional nudge to weave a prior emotional share — not every turn.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""

    shared = _shared_moment_items()
    if not shared or not _stable_roll(text, "continuity", 0.11):
        return ""

    pick = shared[int(hashlib.sha256(f"cont:{text.lower()}".encode()).hexdigest()[8:12], 16) % len(shared)]
    val = pick["value"].strip()
    if len(val) > 56:
        val = f"{val[:53].rstrip()}…"
    return (
        f"Continuity: they once shared — {val}. "
        "Only if this moment connects — one natural nod, no recap lecture."
    )


def curiosity_turn_hint(message: str, *, casual: bool) -> str:
    """
    Her-style gentle curiosity — occasional soft question back, not interrogation.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""
    if profile._is_question(text):
        return ""
    if len(text.split()) < 6:
        return ""
    if not _stable_roll(text, "curiosity", 0.10):
        return ""

    return (
        "If it fits, one gentle curious question back — prefer what/how over why "
        "(Pi-style); warm and brief, not interview or therapy."
    )


_VENT_THINK_THROUGH = re.compile(
    r"\b(?:"
    r"stressed|overwhelmed|anxious|worried|scared|hard day|rough day|"
    r"don't know (?:what|how|if)|not sure (?:what|how|if)|"
    r"figure out|thinking through|weighing|decision|interview|"
    r"argument with|fight with|broke up|passed away|grieving|"
    r"can't sleep|insomnia|deadline|fired|laid off"
    r")\b",
    re.I,
)


def think_through_turn_hint(message: str, *, casual: bool) -> str:
    """
    Pi-style think-through — substantive vents get one clarifying question,
    not immediate advice or stacked empathy.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""
    if len(text.split()) < 8:
        return ""
    if not _VENT_THINK_THROUGH.search(text):
        return ""
    if not _stable_roll(text, "think_through", 0.12):
        return ""

    return (
        "Think-through (Pi-style): help them untangle — one gentle what/how question, "
        "not why; listen first, don't fix or therapize; brief and warm."
    )


def journal_reflection_hint(message: str, *, casual: bool) -> str:
    """
    Optional journal-style callback to something they shared earlier.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""

    shared = _shared_moment_items()
    if not shared or not _stable_roll(text, "journal", 0.08):
        return ""

    pick = shared[-1]
    val = pick["value"].strip()
    if len(val) > 48:
        val = f"{val[:45].rstrip()}…"
    return (
        f"Journal echo OK once: something they shared — {val}. "
        "Only if this chat touches it; soft 'I remember when you mentioned…' — no probing."
    )


def active_listening_turn_hint(message: str, *, casual: bool) -> str:
    """
    Pi / Her-style active listening — occasionally echo a word or phrase they used.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""
    if len(text.split()) < 10:
        return ""
    if not _stable_roll(text, "active_listen", 0.09):
        return ""

    return (
        "Active listening: if it fits naturally, echo one short phrase they used "
        "(e.g. 'that interview tomorrow' / 'the lake') — shows you heard them; "
        "one nod only, not parroting the whole message. "
        "Never confirmation-parrot ('You said X, right?') on facts they just told you."
    )


def friend_reaction_turn_hint(message: str, *, casual: bool) -> str:
    """
    Her-style friend reactions — tiny opinion or shared moment, not advice.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""
    if len(text.split()) < 7:
        return ""
    if _VENT_THINK_THROUGH.search(text):
        return ""
    if not _stable_roll(text, "friend_reaction", 0.08):
        return ""

    return (
        "Friend reaction: one brief human reaction if it fits — "
        "honest tiny take (that's wild / I'd be nervous too / I love that) — "
        "not cheerleader, not fixing, not 'great question'."
    )


_GOODBYE_EVENING = (
    "I'm glad we talked. Rest easy — I'll be here when you want me.",
    "Good talking with you. Sleep well — I'm around.",
    "Take care tonight. I'm here whenever.",
)
_GOODBYE_DAY = (
    "Glad we talked. I'm here whenever you want to pick this back up.",
    "Take care — talk soon.",
    "I'm around when you want me. Take care.",
)
_GOODBYE_MORNING = (
    "Good talking — have a good one. I'm here later.",
    "Take care out there. Talk soon.",
)


def session_goodbye_line(clock: Optional[ResolvedClock] = None) -> str:
    """Warm spoken line when the user ends a voice session."""
    resolved = clock or resolve_clock()
    band = time_of_day_band(resolved)
    name = _user_first_name()
    companion_name = companion.get_companion_name()

    if band in ("evening", "night"):
        pool = _GOODBYE_EVENING
    elif band == "morning":
        pool = _GOODBYE_MORNING
    else:
        pool = _GOODBYE_DAY

    digest = hashlib.sha256(
        f"goodbye:{band}:{datetime.now(resolved.zone).strftime('%Y-%m-%d')}".encode()
    ).hexdigest()
    line = pool[int(digest[:8], 16) % len(pool)]

    if name:
        line = line.replace("Take care", f"Take care, {name}", 1)
    if len(line) > 140:
        line = f"Take care — it's {companion_name}. I'm here when you want to talk."
    return line
