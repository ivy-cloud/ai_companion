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


def session_opening_line(
    clock: Optional[ResolvedClock] = None,
    *,
    force: bool = False,
) -> Optional[str]:
    """
    Optional one-line opener when a voice session starts (~38% of days per tz).
    Uses first name + at most one saved note; never clingy or assistant-y.
    """
    resolved = clock or resolve_clock()
    if not force and not should_offer_session_opening(resolved):
        return None

    band = time_of_day_band(resolved)
    greet = time_of_day_greeting_phrase(band)
    name = _user_first_name()
    companion_name = companion.get_companion_name()

    if name:
        lead = f"{greet}, {name}."
    else:
        lead = f"{greet}."

    memory = _pick_memory_snippet()
    if memory and band in ("evening", "night"):
        tail = f" I'm {companion_name} — still thinking about how {memory}. Here if you want to talk."
    elif memory:
        tail = f" It's {companion_name} — I remember {memory}. What's on your mind?"
    elif band in ("evening", "night"):
        tail = f" It's {companion_name}. I'm here with you if you want to talk."
    else:
        tail = f" It's {companion_name}. I'm around — say what's on your mind."

    line = f"{lead}{tail}"
    if len(line) > 220:
        line = f"{lead} It's {companion_name}. I'm here with you."
    return line


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
