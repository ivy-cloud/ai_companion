"""
Companion growth — usage signals, skill hints, explicit remember/correct loops.

No ML: pattern matching + counters in profile.json.
"""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

import profile

SkillId = Literal["bedtime_song", "pep_talk", "study_buddy", "sing_along"]

_SKILL_LABELS: dict[SkillId, str] = {
    "bedtime_song": "bedtime song",
    "pep_talk": "pep talk",
    "study_buddy": "study buddy",
    "sing_along": "sing along",
}

_SKILL_UNLOCK_COUNT = 2

_USAGE_SIGNALS: list[tuple[SkillId, re.Pattern[str]]] = [
    (
        "bedtime_song",
        re.compile(
            r"\b(?:"
            r"lullaby|bedtime song|sleepy song|help me sleep|"
            r"can't sleep|time for bed|good night song"
            r")\b",
            re.I,
        ),
    ),
    (
        "pep_talk",
        re.compile(
            r"\b(?:"
            r"pep talk|cheer me up|feeling (?:down|low|anxious|stressed)|"
            r"need encouragement|lift my mood"
            r")\b",
            re.I,
        ),
    ),
    (
        "study_buddy",
        re.compile(
            r"\b(?:"
            r"study (?:with me|buddy|session)|homework help|"
            r"quiz me|help me focus|exam prep"
            r")\b",
            re.I,
        ),
    ),
    (
        "sing_along",
        re.compile(
            r"\b(?:"
            r"sing (?:me |a )|sing along|can you sing|"
            r"hum (?:a |me )|make up a song"
            r")\b",
            re.I,
        ),
    ),
]

_REMEMBER_THAT = re.compile(
    r"(?:"
    r"remember that\s+(.+?)(?:[.!?]|$)|"
    r"don't forget that\s+(.+?)(?:[.!?]|$)|"
    r"keep in mind that\s+(.+?)(?:[.!?]|$)"
    r")",
    re.I,
)

_CORRECTION = re.compile(
    r"\b(?:"
    r"no[,.]?\s+(?:i meant|what i meant was|i said)\s+(.+?)(?:[.!?]|$)|"
    r"actually[,.]?\s+(?:i(?:'m| am)|my|i)\s+(.+?)(?:[.!?]|$)|"
    r"that'?s wrong[,.]?\s+(.+?)(?:[.!?]|$)"
    r")\b",
    re.I,
)

_SHARED_MOMENT = re.compile(
    r"\b(?:"
    r"today (?:i|we)|just (?:found out|heard|learned|got|lost)|"
    r"this morning (?:i|we)|last night (?:i|we)|"
    r"my (?:mom|dad|mother|father|partner|wife|husband|dog|cat|friend)\s+(?:died|passed)|"
    r"(?:we|i) broke up|got (?:fired|laid off)|"
    r"i(?:'m| am) (?:heartbroken|devastated|grieving)|"
    r"big day for me|rough day for me|hard day for me"
    r")\b",
    re.I,
)

_REFLECTION_DETAIL = re.compile(
    r"\b(?:"
    r"because\s+(.+?)(?:[.!?]|$)|"
    r"it(?:'s| is)\s+(.+?)(?:[.!?]|$)|"
    r"about\s+(.+?)(?:[.!?]|$)"
    r")\b",
    re.I,
)

_APPRECIATION = re.compile(
    r"\b(?:"
    r"thanks(?: a lot| so much)?|thank you|"
    r"that'?s (?:right|correct|perfect)|exactly|you got it|"
    r"good memory|nice(?:,)? you remembered"
    r")\b",
    re.I,
)

_STRUCTURED_PREF_PATTERNS: list[
    tuple[str, profile.MemoryCategory, profile.Confidence, re.Pattern[str]]
] = [
    (
        "music_style",
        "preference",
        "high",
        re.compile(
            r"\bmy (?:usual )?music style is\s+(.+?)(?:[.!?]|$)",
            re.I,
        ),
    ),
    (
        "music_style",
        "preference",
        "high",
        re.compile(
            r"\b(?:i listen to|i(?:'m| am) into)\s+(.+?)\s+music\b(?:[.!?]|$)",
            re.I,
        ),
    ),
    (
        "mood",
        "emotional_context",
        "medium",
        re.compile(
            r"\b(?:i(?:'ve| have) been|lately i(?:'m| am)|usually i(?:'m| am))\s+"
            r"(?:feeling\s+)?(.+?)(?:[.!?]|$)",
            re.I,
        ),
    ),
    (
        "mood",
        "session_context",
        "medium",
        re.compile(r"\bmy mood (?:lately |right now )?is\s+(.+?)(?:[.!?]|$)", re.I),
    ),
    (
        "topic",
        "recurring_interest",
        "high",
        re.compile(
            r"\b(?:i(?:'m| am) obsessed with|i keep talking about|"
            r"my main hobby is)\s+(.+?)(?:[.!?]|$)",
            re.I,
        ),
    ),
]


def _growth_eligible(text: str) -> bool:
    """Looser than profile._eligible_to_learn — allows remember/structured phrasing."""
    t = text.strip()
    if not t:
        return False
    if _REMEMBER_THAT.search(t):
        return True
    if profile._is_question(t):
        return False
    if profile._looks_like_assistant_echo(t):
        return False
    if profile._SHARED_MEMORY_CLAIM.search(t):
        return False
    for _key, _cat, _conf, pattern in _STRUCTURED_PREF_PATTERNS:
        if pattern.search(t):
            return True
    if profile._AI_OR_SHARED_CLAIM.search(t):
        return False
    return True


def _store_user_text_for_memory(original: str, value: str) -> str:
    """Normalize loader requires a learnable user_text shape."""
    if profile._eligible_to_learn(original):
        return original[:500]
    return f"I like {value}"[:500]


def _load_usage() -> dict[str, int]:
    store = profile._load_store()
    raw = store.get("usage_signals")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for key, val in raw.items():
        if isinstance(key, str) and isinstance(val, int) and val > 0:
            out[key] = val
    return out


def _save_usage(usage: dict[str, int]) -> None:
    store = profile._load_store()
    store["usage_signals"] = usage
    profile._save_store(store)


def record_usage_signals(user_text: str, route: Optional[str] = None) -> list[SkillId]:
    """Bump usage counters from message content (and sing routes)."""
    text = user_text.strip()
    if not text:
        return []

    usage = _load_usage()
    touched: list[SkillId] = []
    for skill_id, pattern in _USAGE_SIGNALS:
        if pattern.search(text):
            usage[skill_id] = usage.get(skill_id, 0) + 1
            touched.append(skill_id)

    if route and "sing" in route.lower():
        usage["sing_along"] = usage.get("sing_along", 0) + 1
        if "sing_along" not in touched:
            touched.append("sing_along")

    if touched:
        _save_usage(usage)
    return touched


def get_usage_counts() -> dict[str, int]:
    return dict(_load_usage())


def get_skill_hints() -> list[str]:
    """Soft capability labels unlocked by repeated usage."""
    usage = _load_usage()
    hints: list[str] = []
    for skill_id, label in _SKILL_LABELS.items():
        if usage.get(skill_id, 0) >= _SKILL_UNLOCK_COUNT:
            hints.append(label)
    return hints


def try_structured_preference_learn(user_text: str) -> bool:
    """Learn music_style / mood / topic with stable memory ids."""
    text = user_text.strip()
    if not text or not _growth_eligible(text):
        return False

    for key, category, confidence, pattern in _STRUCTURED_PREF_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        value = profile._trim_value(match.group(1))
        if not profile._is_valid_fact_value(value):
            continue
        mem_id = f"{category}:{key}"
        items = profile._load_memory_items()
        items = [i for i in items if i["id"] != mem_id]
        items.append(
            {
                "id": mem_id,
                "category": category,
                "value": value,
                "source": "user",
                "confidence": confidence,
                "timestamp": profile._utc_now(),
                "user_text": _store_user_text_for_memory(text, value),
            }
        )
        if len(items) > profile._MAX_MEMORY_ITEMS:
            items = items[-profile._MAX_MEMORY_ITEMS :]
        profile._persist_memory_items(items)
        return True
    return False


def _first_capture_group(match: re.Match[str]) -> str:
    for i in range(1, (match.lastindex or 0) + 1):
        g = match.group(i)
        if g and g.strip():
            return g.strip()
    return ""


def try_explicit_remember_learn(user_text: str) -> bool:
    """\"Remember that …\" — store as high-confidence preference."""
    text = user_text.strip()
    if not text:
        return False
    match = _REMEMBER_THAT.search(text)
    if not match:
        return False
    payload = profile._trim_value(_first_capture_group(match))
    if not payload or not profile._is_valid_fact_value(payload):
        return False
    if not _growth_eligible(text):
        return False

    mem_id = f"preference:remembered-{profile._slug(payload)}"
    items = profile._load_memory_items()
    items = [i for i in items if i["id"] != mem_id]
    items.append(
        {
            "id": mem_id,
            "category": "preference",
            "value": payload,
            "source": "user",
            "confidence": "high",
            "timestamp": profile._utc_now(),
            "user_text": _store_user_text_for_memory(text, payload),
        }
    )
    if len(items) > profile._MAX_MEMORY_ITEMS:
        items = items[-profile._MAX_MEMORY_ITEMS :]
    profile._persist_memory_items(items)
    return True


def try_correction_strengthen(user_text: str) -> bool:
    """User corrects companion — overwrite matching memory when unambiguous."""
    text = user_text.strip()
    if not text:
        return False
    match = _CORRECTION.search(text)
    if not match:
        return False
    payload = profile._trim_value(_first_capture_group(match))
    if not payload or len(payload) < 3:
        return False
    if not profile._USER_ASSERTION_START.search(payload):
        wrapped = f"{payload}"
    else:
        wrapped = payload
    if not _growth_eligible(text) and not profile._eligible_to_learn(wrapped):
        return False

    result = profile.learn_from_user_message(wrapped, apply_growth=False)
    if result.updated:
        return True
    if try_structured_preference_learn(wrapped):
        return True
    extracted = profile._extract_memory_from_text(wrapped)
    if not extracted:
        return False
    category, confidence, value, mem_id, _label = extracted
    items = profile._load_memory_items()
    items = [i for i in items if i["id"] != mem_id]
    items.append(
        {
            "id": mem_id,
            "category": category,
            "value": value,
            "source": "user",
            "confidence": "high",
            "timestamp": profile._utc_now(),
            "user_text": _store_user_text_for_memory(text, value),
        }
    )
    if len(items) > profile._MAX_MEMORY_ITEMS:
        items = items[-profile._MAX_MEMORY_ITEMS :]
    profile._persist_memory_items(items)
    return True


def try_reflection_moment_learn(user_text: str) -> bool:
    """
    Learn emotional shares as user_shared_moment — for gentle recall later.
    Skips questions and assistant-echo phrasing.
    """
    text = user_text.strip()
    if not text or len(text.split()) < 4:
        return False
    if not _SHARED_MOMENT.search(text):
        return False
    if profile._is_question(text) or profile._looks_like_assistant_echo(text):
        return False
    if not _growth_eligible(text) and not profile._eligible_to_learn(text):
        return False

    payload = profile._trim_value(text[:160])
    detail = _REFLECTION_DETAIL.search(text)
    if detail:
        extra = profile._trim_value(_first_capture_group(detail))
        if extra and len(extra) > 8 and extra.lower() not in payload.lower():
            payload = profile._trim_value(f"{payload[:100]} — {extra[:60]}")
    if not profile._is_valid_fact_value(payload):
        return False

    mem_id = f"emotional_context:user_shared_moment-{profile._slug(payload[:80])}"
    items = profile._load_memory_items()
    items = [i for i in items if i["id"] != mem_id]
    items.append(
        {
            "id": mem_id,
            "category": "emotional_context",
            "value": payload,
            "source": "user",
            "confidence": "high",
            "timestamp": profile._utc_now(),
            "user_text": _store_user_text_for_memory(text, payload),
        }
    )
    if len(items) > profile._MAX_MEMORY_ITEMS:
        items = items[-profile._MAX_MEMORY_ITEMS :]
    profile._persist_memory_items(items)
    return True


def try_appreciation_boost(user_text: str) -> bool:
    """Light positive signal — refresh timestamp on most recent memory."""
    text = user_text.strip()
    if not text or not _APPRECIATION.search(text):
        return False
    items = profile._load_memory_items()
    if not items:
        return False
    last = items[-1]
    if last["confidence"] == "low":
        last = {**last, "confidence": "medium"}
    else:
        last = {**last, "timestamp": profile._utc_now()}
    items[-1] = last  # type: ignore[assignment]
    profile._persist_memory_items(items)
    return True


def apply_growth_learn_extras(user_text: str) -> list[str]:
    """Side-channel learning (remember/correct/structured) — ids for logging."""
    updated: list[str] = []
    if try_explicit_remember_learn(user_text):
        updated.append("remember_that")
    if try_structured_preference_learn(user_text):
        updated.append("structured_pref")
    if try_correction_strengthen(user_text):
        updated.append("correction")
    if try_reflection_moment_learn(user_text):
        updated.append("user_shared_moment")
    if try_appreciation_boost(user_text):
        updated.append("appreciation_boost")
    return updated


def companion_growth_turn_hint(message: str, *, casual: bool) -> str:
    """
    Occasional casual-chat nudge to weave saved prefs — not every turn.
    """
    if not casual:
        return ""
    text = message.strip()
    if not text or profile.is_memory_recall_question(text):
        return ""

    import hashlib

    digest = hashlib.sha256(f"growth:{text.lower()}".encode()).hexdigest()
    if int(digest[:8], 16) / 0xFFFFFFFF > 0.18:
        return ""

    prefs = [
        i
        for i in profile.get_memory_items()
        if profile._confidence_allows_assertion(i["confidence"])
        and (
            i["category"] in ("preference", "recurring_interest")
            or (
                i["category"] == "emotional_context"
                and str(i.get("id", "")).startswith(
                    "emotional_context:user_shared_moment"
                )
            )
        )
    ]
    if not prefs:
        return ""

    skills = get_skill_hints()
    skill_line = ""
    if skills and int(digest[12:16], 16) % 5 == 0:
        label = skills[int(digest[16:20], 16) % len(skills)]
        skill_line = (
            f" You've grown into a good {label} for them — nod once if it fits, "
            "not a sales pitch."
        )

    pick = prefs[int(digest[8:12], 16) % len(prefs)]
    val = pick["value"]
    if pick["category"] == "preference":
        return (
            f"Saved note: they like {val}. Mention only if it fits this turn — "
            f"one brief nod, not a list.{skill_line}"
        )
    if pick["category"] == "emotional_context" and pick["id"].startswith(
        "emotional_context:user_shared_moment"
    ):
        return (
            f"Shared moment on file: {val}. Only if this chat touches it — "
            f"gentle, no probing.{skill_line}"
        )
    return (
        f"Saved note: they're into {val}. Mention only if natural — "
        f"never recite all notes.{skill_line}"
    )


def growth_meta_for_stream() -> dict[str, Any]:
    hints = get_skill_hints()
    meta: dict[str, Any] = {"usage": get_usage_counts()}
    if hints:
        meta["skill_hints"] = hints
    return meta
