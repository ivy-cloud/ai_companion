"""Runtime context injected into the system prompt (time, friend notes, web lookup)."""

import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Optional
from zoneinfo import ZoneInfo

import companion
import profile
from human_speech import (
    HUMAN_SPEECH_RULES,
    short_date_reply,
    short_day_reply,
    short_this_year_age_reply,
    short_time_reply,
    short_year_reply,
)
from spoken_text import cardinal_word

_IANA_TZ_RE = re.compile(
    r"^(?:UTC|GMT|[A-Za-z][A-Za-z0-9_+-]*(?:/[A-Za-z][A-Za-z0-9_+-]+)+)$"
)
_DEFAULT_IANA = "America/Los_Angeles"


@dataclass(frozen=True)
class ResolvedClock:
    zone: ZoneInfo
    iana: str
    from_device: bool


def _env_default_iana() -> str:
    return os.environ.get("COMPANION_TIMEZONE", _DEFAULT_IANA).strip() or _DEFAULT_IANA


def _try_zone(iana: str) -> Optional[ZoneInfo]:
    name = iana.strip()[:64]
    if not name or not _IANA_TZ_RE.match(name):
        return None
    try:
        return ZoneInfo(name)
    except Exception:
        return None


def resolve_clock(client_timezone: Optional[str] = None) -> ResolvedClock:
    """Phone IANA tz when valid; else COMPANION_TIMEZONE / Pacific default."""
    if client_timezone:
        zone = _try_zone(client_timezone)
        if zone:
            return ResolvedClock(zone=zone, iana=str(client_timezone).strip(), from_device=True)

    for candidate in (_env_default_iana(), _DEFAULT_IANA):
        zone = _try_zone(candidate)
        if zone:
            return ResolvedClock(zone=zone, iana=candidate, from_device=False)

    zone = ZoneInfo(_DEFAULT_IANA)
    return ResolvedClock(zone=zone, iana=_DEFAULT_IANA, from_device=False)


def format_local_now(clock: Optional[ResolvedClock] = None) -> str:
    """For /health display only — not for speaking aloud."""
    p = format_local_now_parts(clock)
    h, m = int(p["hour_24"]), int(p["minute"])
    return f"{p['weekday']}, {p['month']} {p['day']}, {p['year']} — {h}:{m:02d}"


def format_local_now_parts(clock: Optional[ResolvedClock] = None) -> Dict[str, str]:
    resolved = clock or resolve_clock()
    now = datetime.now(resolved.zone)
    day = now.day
    return {
        "hour_24": str(now.hour),
        "minute": str(now.minute),
        "weekday": now.strftime("%A"),
        "month": now.strftime("%B"),
        "day": str(day),
        "year": str(now.year),
        "month_num": str(now.month),
    }


def format_today_anchor(clock: Optional[ResolvedClock] = None) -> str:
    """Compact calendar facts for every turn — so the model knows today's year."""
    p = format_local_now_parts(clock)
    return (
        f"Today is {p['weekday']}, {p['month']} {p['day']}, {p['year']} "
        f"(calendar year {p['year']})."
    )


def format_clock_context_for_model(clock: Optional[ResolvedClock] = None) -> str:
    """Structured clock facts + rules so the model can phrase answers like a human."""
    resolved = clock or resolve_clock()
    p = format_local_now_parts(resolved)
    h, m = int(p["hour_24"]), int(p["minute"])
    whence = (
        "their phone's local time (sent with this message)"
        if resolved.from_device
        else "configured default time"
    )
    try:
        import companion_moments

        moment_line = companion_moments.clock_context_moment_line(resolved)
    except Exception:
        moment_line = ""
    return (
        "## Right now (use for any current time/date/day question)\n"
        f"- source: {whence}\n"
        f"- timezone (do not say aloud unless they ask): {resolved.iana}\n"
        f"- hour (24h): {h}, minute: {m}\n"
        f"- weekday: {p['weekday']}, calendar: {p['month']} {p['day']}, {p['year']}\n"
        f"{moment_line}\n"
        "- You **know** the current time from the lines above. Answer directly.\n"
        "- **Never** say you need their timezone, that they haven't told you the time, "
        "or that you don't know what time it is.\n"
        "- Say it the way a friend would on the phone (short spoken sentences, no parentheses):\n"
        "  - time question → ONLY hour and minute (e.g. one oh one). No timezone name. No full date.\n"
        "  - year question → ONLY the calendar year (e.g. twenty twenty-six). Never a random past year.\n"
        "  - day question → ONLY the day (e.g. Wednesday or the 20th).\n"
        "  - date question → ONLY month + day unless they asked for the year.\n"
        "  - few commas; no PDT/PST/AM/PM or full timestamp strings aloud."
    )


_SIMPLE_MATH = re.compile(
    r"^\s*"
    r"(?:(?:what(?:'s| is)|how much is|calculate|compute)\s+)?"
    r"(\d{1,4})\s*([+\-*/×÷])\s*(\d{1,4})"
    r"\s*\??\s*$",
    re.I,
)

_OP_EVAL = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "×": lambda a, b: a * b,
    "/": lambda a, b: a / b,
    "÷": lambda a, b: a / b,
}


def is_simple_math_question(message: str) -> bool:
    return bool(_SIMPLE_MATH.match(message.strip()))


def companion_math_reply(message: str) -> Optional[str]:
    """Direct arithmetic — no LLM, clock, or friend-notes meta."""
    match = _SIMPLE_MATH.match(message.strip())
    if not match:
        return None

    left, op_sym, right = int(match.group(1)), match.group(2), int(match.group(3))
    if op_sym in ("/", "÷") and right == 0:
        return None

    result = _OP_EVAL[op_sym](left, right)
    if isinstance(result, float) and result.is_integer():
        result = int(result)
    if isinstance(result, float):
        return None

    return f"That's {cardinal_word(int(result))}."


def needs_clock_context(message: str) -> bool:
    if is_time_question(message):
        return True
    lower = message.lower()
    return bool(
        re.search(
            r"\b(current|today|now|right now|latest|this year|at the moment)\b",
            lower,
        )
    )


def needs_friend_notes_context(message: str) -> bool:
    import profile

    if profile.is_user_profile_turn(message):
        return True
    lower = message.lower()
    return bool(
        re.search(
            r"\b(?:"
            r"my name|my birthday|my age|how old am i|what(?:'s| is) my age|"
            r"when was i born|what year was i born|birth year|year i was born|"
            r"where am i from|where do i live|"
            r"what do you remember|about me|what do you know about me"
            r")\b",
            lower,
        )
    )


_THIS_YEAR_AGE = re.compile(
    r"\bhow\s+old\s+(?:is\s+)?(?:this|the)\s+year\b",
    re.I,
)


def is_this_year_age_question(message: str) -> bool:
    return bool(_THIS_YEAR_AGE.search(message.strip()))


def is_time_question(message: str) -> bool:
    """Clock questions — answered from companion local time, never web search."""
    text = message.strip()
    if not text:
        return False
    lower = text.lower().rstrip("?").strip()

    if is_this_year_age_question(text):
        return True

    # Past / event time — not "what time is it now"
    if re.search(
        r"\b(?:"
        r"what time did|when did|what time was|"
        r"yesterday at|last night at|remember what time"
        r")\b",
        lower,
    ):
        return False

    if lower in (
        "what time is it",
        "what's the time",
        "what is the time",
        "what date is it",
        "what's the date",
        "what is the date",
        "what day is it",
        "what day is today",
        "what time is it now",
        "what's the time now",
        "do you know what time it is",
        "do you know what time it is now",
        "do you know what time it now",
        "what year is it",
        "what's the year",
        "what is the year",
        "which year is it",
        "which year",
        "what year are we in",
    ):
        return True

    if re.search(r"\b(?:what|which)\s+year\b", lower):
        if re.search(
            r"\b(?:was|were|did|ago|back in|born in|since|in\s+\d{4})\b",
            lower,
        ):
            return False
        return True

    if re.match(r"^what(?:'s| is)? (?:the )?(?:time|date|day|year)\b", lower):
        return True

    if re.search(
        r"\b(?:"
        r"what(?:'s| is)?\s+(?:the\s+)?time(?:\s+is\s+it)?(?:\s+now)?|"
        r"what\s+time\s+it\s+(?:is\s+)?now|"
        r"do you know what(?:'s| is)?\s+(?:the\s+)?time|"
        r"do you know what\s+time\s+it\s+(?:is\s+)?now|"
        r"can you tell me(?: what)?\s+(?:the\s+)?time|"
        r"could you tell me(?: what)?\s+(?:the\s+)?time|"
        r"tell me what(?:'s| is)?\s+(?:the\s+)?time|"
        r"got the time|have you got the time|"
        r"what time is it|what's the time|what is the time|"
        r"current time|time is it now"
        r")\b",
        lower,
    ):
        return True

    if re.search(
        r"\b(?:"
        r"what date|what day|what's the date|what day is today|"
        r"do you know what day|what day is it now"
        r")\b",
        lower,
    ):
        return True

    return False


def _time_intent(lower: str) -> str:
    """year | time | day | date | time_and_day | year_and_time"""
    wants_year = bool(re.search(r"\byear\b", lower))
    wants_time = bool(re.search(r"\btime\b", lower)) or "what time" in lower
    wants_day = bool(re.search(r"\b(?:day|today)\b", lower))
    wants_date = bool(re.search(r"\bdate\b", lower)) and not wants_year

    if wants_year and wants_time:
        return "year_and_time"
    if wants_year:
        return "year"
    if wants_time and (wants_day or wants_date):
        return "time_and_day"
    if wants_date and not wants_time:
        return "date"
    if wants_day and not wants_time:
        return "day"
    return "time"


def companion_time_reply(
    message: str,
    clock: Optional[ResolvedClock] = None,
) -> Optional[str]:
    """Short, spoken-style clock answer — not a timestamp string."""
    if not is_time_question(message):
        return None

    p = format_local_now_parts(clock)
    h, m = int(p["hour_24"]), int(p["minute"])
    lower = message.lower()

    if is_this_year_age_question(message):
        return short_this_year_age_reply(
            p,
            month_num=int(p["month_num"]),
            day=int(p["day"]),
        )

    intent = _time_intent(lower)

    if intent == "year":
        return short_year_reply(p)
    if intent == "year_and_time":
        return f"{short_year_reply(p)} {short_time_reply(p, h, m)}"
    if intent == "date":
        return short_date_reply(p)
    if intent == "day":
        return short_day_reply(p)
    if intent == "time_and_day":
        return f"{short_time_reply(p, h, m)} {short_day_reply(p)}"
    return short_time_reply(p, h, m)


def build_context_appendix(
    web_lookup: Optional[str] = None,
    clock: Optional[ResolvedClock] = None,
    *,
    include_clock: bool = True,
    include_notes: bool = True,
) -> str:
    parts: list[str] = [f"## Calendar\n{format_today_anchor(clock)}"]
    if include_clock:
        parts.append(format_clock_context_for_model(clock))
    parts.extend(
        [
            "## You (companion persona)\n"
            f"{companion.format_companion_persona_for_prompt(clock=clock)}",
            HUMAN_SPEECH_RULES,
        ]
    )
    if include_notes:
        parts.append(
            "## Saved friend notes (about them, not you)\n"
            f"{profile.format_notes_for_prompt()}"
        )

    if web_lookup:
        parts.append(web_lookup)
    elif not include_clock and not include_notes:
        parts.append(
            "## This turn\n"
            "- Answer **only** what they asked (e.g. math → one short sentence with the result).\n"
            "- Do **not** mention the current time, date, weekday, year, or saved friend notes."
        )
    elif include_notes:
        parts.append(
            "## This turn\n"
            "- Casual chat — no web lookup unless a live block is attached above.\n"
            "- You may weave in **Saved friend notes** naturally when relevant; "
            "never invent details not listed."
        )
    else:
        parts.append("## This turn\n- Casual or personal — no web lookup.")

    return "\n\n".join(parts)
