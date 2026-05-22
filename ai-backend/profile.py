"""
User facts store — only explicit user statements are persisted.

Assistant messages are never a source of truth and are never stored as facts.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

_BACKEND_DIR = Path(__file__).resolve().parent
_PROFILE_PATH = _BACKEND_DIR / "data" / "profile.json"

FactType = Literal["name", "birthday", "location", "age"]
Source = Literal["user"]
MemoryCategory = Literal[
    "user_profile",
    "preference",
    "recurring_interest",
    "session_context",
    "emotional_context",
]
Confidence = Literal["high", "medium", "low"]

_MAX_MEMORY_ITEMS = 24

_CATEGORY_FOR_FACT: dict[FactType, MemoryCategory] = {
    "name": "user_profile",
    "birthday": "user_profile",
    "location": "user_profile",
    "age": "user_profile",
}

# First-person assertions only — capture group is the value.
_LEARN_PATTERNS: dict[FactType, list[re.Pattern[str]]] = {
    "birthday": [
        re.compile(r"\bmy birthday is\s+(.+?)(?:[.!?]|$)", re.I),
        re.compile(r"\bbirthday is\s+(.+?)(?:[.!?]|$)", re.I),
        re.compile(r"\bi was born (?:on\s+)?(.+?)(?:[.!?]|$)", re.I),
    ],
    "name": [
        re.compile(r"\bmy name is\s+([A-Za-z][A-Za-z\s'-]{0,40})", re.I),
        re.compile(r"\bcall me\s+([A-Za-z][A-Za-z\s'-]{0,40})", re.I),
    ],
    "location": [
        re.compile(r"\bi(?:'m| am) from\s+(.+?)(?:[.!?]|$)", re.I),
        re.compile(r"\bi live in\s+(.+?)(?:[.!?]|$)", re.I),
    ],
    "age": [
        re.compile(r"\bmy age is\s+(\d{1,3})\b", re.I),
        re.compile(r"\bi(?:'m| am)\s+(\d{1,3})(?:\s+years?\s+old)?(?:[.!?]|$)", re.I),
        re.compile(r"\bit'?s\s+(\d{1,3})(?:\s+years?\s+old)?(?:[.!?]|$)", re.I),
        re.compile(r"^\s*(\d{1,3})\s+years?\s+old\s*\.?\s*$", re.I),
    ],
}

# (category, confidence, pattern, optional (topic_group, value_group) for multi-capture)
_MemoryPattern = tuple[
    MemoryCategory, Confidence, re.Pattern[str], Optional[tuple[int, int]]
]

_MEMORY_LEARN_PATTERNS: list[_MemoryPattern] = [
    (
        "preference",
        "high",
        re.compile(r"\bi (?:really )?(?:like|love|enjoy)\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
    (
        "preference",
        "high",
        re.compile(r"\bi prefer\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
    (
        "preference",
        "high",
        re.compile(r"\bmy favorite\s+(.+?)\s+is\s+(.+?)(?:[.!?]|$)", re.I),
        (1, 2),
    ),
    (
        "recurring_interest",
        "high",
        re.compile(r"\bi(?:'m| am) (?:really )?into\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
    (
        "recurring_interest",
        "high",
        re.compile(r"\bi(?:'ve| have) been (?:really )?into\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
    (
        "session_context",
        "medium",
        re.compile(
            r"\b(?:this week|for now|right now|today) i(?:'m| am)\s+(.+?)(?:[.!?]|$)",
            re.I,
        ),
        None,
    ),
    (
        "session_context",
        "medium",
        re.compile(r"\bi(?:'m| am) staying (?:in|at)\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
    (
        "emotional_context",
        "medium",
        re.compile(r"\bi(?:'m| am) feeling\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
    (
        "emotional_context",
        "medium",
        re.compile(r"\bi feel\s+(.+?)(?:[.!?]|$)", re.I),
        None,
    ),
]

_LABELS: dict[FactType, str] = {
    "birthday": "Birthday",
    "name": "Name",
    "location": "Where they live",
    "age": "Age",
}

_CATEGORY_LABELS: dict[MemoryCategory, str] = {
    "user_profile": "Profile",
    "preference": "Preferences",
    "recurring_interest": "Interests",
    "session_context": "For now",
    "emotional_context": "How they've felt",
}

_RECALL_GENERAL = re.compile(
    r"\b(?:"
    r"what do you remember(?: about me)?|"
    r"what have you remembered|"
    r"what did i tell you|"
    r"what do you know about me|"
    r"do you remember me|"
    r"what(?:'s| is) my info|"
    r"what facts do you have"
    r")\b",
    re.I,
)

_RECALL_BY_KEY: dict[FactType, re.Pattern[str]] = {
    "name": re.compile(
        r"\b(?:what(?:'s| is)? my name|do you know my name|remember my name)\b",
        re.I,
    ),
    "birthday": re.compile(
        r"\b(?:what(?:'s| is)? my birthday|when(?:'s| is) my birthday|remember my birthday)\b",
        re.I,
    ),
    "location": re.compile(
        r"\b(?:where am i from|where do i live|what(?:'s| is) my location|remember where i live)\b",
        re.I,
    ),
    "age": re.compile(
        r"\b(?:"
        r"how old am i|what(?:'s| is) my age|what age am i|"
        r"do you know my age|remember my age|what age did i tell you"
        r")\b",
        re.I,
    ),
}

_USER_AGE_RECALL = _RECALL_BY_KEY["age"]

_RECALL_PREFERENCE = re.compile(
    r"\b(?:"
    r"do you remember (?:that )?i (?:like|love|prefer)|"
    r"what do i (?:like|love|prefer)|"
    r"remember what i (?:like|love|prefer)"
    r")\b",
    re.I,
)

_REMEMBER_TOPIC = re.compile(
    r"\bdo you remember(?:\s+(?:my|that|when|what|if))?\s+(.+?)\??\s*$",
    re.I,
)

_UNKNOWN_REPLIES = (
    "I don't think you've told me that yet.",
    "Hmm, I don't think you've mentioned that.",
    "Not that I remember — you haven't told me.",
)

_ASSISTANT_ECHO = re.compile(
    r"\b(?:you(?:'re| are)|your name is|i think you|remember that you|as you said|you said|you told me)\b",
    re.I,
)

_SHARED_MEMORY_CLAIM = re.compile(
    r"\bremember when we\b",
    re.I,
)

_USER_ASSERTION_START = re.compile(
    r"^\s*(?:i\b|i'm\b|i am\b|my\b|call me\b)",
    re.I,
)

_INFERENCE_OR_GUESS = re.compile(
    r"\b(?:i guess|i think my|maybe my|probably my|not sure but|i'm not sure but)\b",
    re.I,
)

_AI_OR_SHARED_CLAIM = re.compile(
    r"\b(?:as an ai|language model|you told me|remember that i|we went|we used to|when we )\b",
    re.I,
)

_QUESTION_START = re.compile(
    r"^(?:what|who|where|when|why|how|do|does|did|can|could|would|is|are|am)\b",
    re.I,
)


class UserFact(TypedDict):
    value: str
    source: Source
    fact_type: FactType
    category: MemoryCategory
    confidence: Confidence
    timestamp: str
    user_text: str


class MemoryItem(TypedDict):
    id: str
    category: MemoryCategory
    value: str
    source: Source
    confidence: Confidence
    timestamp: str
    user_text: str


@dataclass
class MemoryConflict:
    category: MemoryCategory
    label: str
    existing_value: str
    new_value: str
    fact_key: Optional[str] = None
    memory_id: Optional[str] = None


@dataclass
class LearnResult:
    updated: list[str] = field(default_factory=list)
    conflicts: list[MemoryConflict] = field(default_factory=list)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower().strip())[:48].strip("-")
    return s or "item"


def _load_store() -> dict[str, Any]:
    if not _PROFILE_PATH.is_file():
        return {"facts": {}, "memories": []}
    try:
        data = json.loads(_PROFILE_PATH.read_text(encoding="utf-8"))
        if isinstance(data.get("facts"), dict):
            if not isinstance(data.get("memories"), list):
                data["memories"] = []
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"facts": {}, "memories": []}


def _save_store(store: dict[str, Any]) -> None:
    _PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PROFILE_PATH.write_text(
        json.dumps(store, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _trim_value(value: str, max_len: int = 120) -> str:
    value = " ".join(value.split()).strip(" ,;")
    if len(value) > max_len:
        return value[:max_len] + "…"
    return value


def _is_question(text: str) -> bool:
    t = text.strip()
    if not t:
        return True
    if t.endswith("?"):
        return True
    return bool(_QUESTION_START.match(t))


def _looks_like_assistant_echo(text: str) -> bool:
    return bool(_ASSISTANT_ECHO.search(text))


def _normalize_age_value(raw: str) -> Optional[str]:
    raw = raw.strip()
    if not re.fullmatch(r"\d{1,3}", raw):
        return None
    age = int(raw)
    if not 1 <= age <= 120:
        return None
    return str(age)


def _extract_age_from_text(text: str) -> Optional[str]:
    for pattern in _LEARN_PATTERNS["age"]:
        match = pattern.search(text)
        if not match:
            continue
        normalized = _normalize_age_value(match.group(1))
        if normalized:
            return normalized
    return None


def is_user_age_recall_question(message: str) -> bool:
    text = message.strip()
    return bool(text and _USER_AGE_RECALL.search(text))


def _is_valid_fact_value(value: str, *, fact_type: Optional[FactType] = None) -> bool:
    if fact_type == "age":
        return _normalize_age_value(value) is not None
    if len(value) < 2 or len(value) > 120:
        return False
    lower = value.lower()
    blocked = (
        "assistant",
        "language model",
        "as an ai",
        "i don't know",
        "not sure",
        "unknown",
        "http",
        "www.",
        "remember when",
        "you said",
        "you told me",
    )
    return not any(b in lower for b in blocked)


def _has_user_assertion(text: str) -> bool:
    for patterns in _LEARN_PATTERNS.values():
        for pattern in patterns:
            if pattern.search(text):
                return True
    for _cat, _conf, pattern, _groups in _MEMORY_LEARN_PATTERNS:
        if pattern.search(text):
            return True
    return False


def _value_matches_patterns(fact_type: FactType, user_text: str, value: str) -> bool:
    patterns = _LEARN_PATTERNS[fact_type]
    for pattern in patterns:
        match = pattern.search(user_text)
        if match and _trim_value(match.group(1)).lower() == value.lower():
            return True
    return False


def _eligible_to_learn(user_text: str) -> bool:
    """Only persist explicit first-person user statements — never questions or echoes."""
    text = user_text.strip()
    if not text:
        return False
    if _is_question(text):
        return False
    if _looks_like_assistant_echo(text):
        return False
    if _SHARED_MEMORY_CLAIM.search(text):
        return False
    if _INFERENCE_OR_GUESS.search(text):
        return False
    if _AI_OR_SHARED_CLAIM.search(text):
        return False
    if _extract_age_from_text(text) is not None:
        return True
    if not _USER_ASSERTION_START.search(text):
        return False
    return _has_user_assertion(text)


def _default_confidence(category: MemoryCategory) -> Confidence:
    if category in ("session_context", "emotional_context"):
        return "medium"
    return "high"


def _normalize_entry(key: str, entry: Any) -> Optional[UserFact]:
    if not isinstance(entry, dict):
        return None
    if entry.get("source") != "user":
        return None
    value = entry.get("value")
    fact_type = entry.get("fact_type") or key
    if not isinstance(value, str) or not value.strip():
        return None
    if fact_type not in _LEARN_PATTERNS:
        return None
    ts = entry.get("timestamp")
    if not isinstance(ts, str) or not ts.strip():
        ts = _utc_now()
    user_text = entry.get("user_text")
    if not isinstance(user_text, str):
        user_text = ""
    user_text = user_text[:500]
    value = value.strip()
    category = entry.get("category")
    if category not in _CATEGORY_LABELS:
        category = _CATEGORY_FOR_FACT[fact_type]  # type: ignore[index]
    confidence = entry.get("confidence")
    if confidence not in ("high", "medium", "low"):
        confidence = _default_confidence(category)  # type: ignore[arg-type]

    if not user_text or not _eligible_to_learn(user_text):
        return None
    if not _value_matches_patterns(fact_type, user_text, value):  # type: ignore[arg-type]
        return None

    return {
        "value": value,
        "source": "user",
        "fact_type": fact_type,  # type: ignore[typeddict-item]
        "category": category,  # type: ignore[typeddict-item]
        "confidence": confidence,  # type: ignore[typeddict-item]
        "timestamp": ts,
        "user_text": user_text,
    }


def _normalize_memory_item(entry: Any) -> Optional[MemoryItem]:
    if not isinstance(entry, dict):
        return None
    if entry.get("source") != "user":
        return None
    category = entry.get("category")
    if category not in _CATEGORY_LABELS or category == "user_profile":
        return None
    value = entry.get("value")
    if not isinstance(value, str) or not _is_valid_fact_value(value.strip()):
        return None
    value = _trim_value(value)
    user_text = entry.get("user_text")
    if not isinstance(user_text, str) or not _eligible_to_learn(user_text):
        return None
    item_id = entry.get("id")
    if not isinstance(item_id, str) or not item_id.strip():
        return None
    confidence = entry.get("confidence")
    if confidence not in ("high", "medium", "low"):
        confidence = _default_confidence(category)  # type: ignore[arg-type]
    ts = entry.get("timestamp")
    if not isinstance(ts, str) or not ts.strip():
        ts = _utc_now()
    return {
        "id": item_id,
        "category": category,  # type: ignore[typeddict-item]
        "value": value,
        "source": "user",
        "confidence": confidence,  # type: ignore[typeddict-item]
        "timestamp": ts,
        "user_text": user_text[:500],
    }


def _load_user_facts() -> dict[FactType, UserFact]:
    store = _load_store()
    raw = store.get("facts", {})
    if not isinstance(raw, dict):
        return {}

    cleaned: dict[FactType, UserFact] = {}
    changed = False
    for key, entry in raw.items():
        if key not in _LEARN_PATTERNS:
            changed = True
            continue
        normalized = _normalize_entry(key, entry)
        if not normalized or not _is_valid_fact_value(normalized["value"]):
            changed = True
            continue
        cleaned[key] = normalized  # type: ignore[assignment]
        if not isinstance(entry, dict) or entry.get("source") != "user":
            changed = True
        elif entry.get("category") != normalized["category"] or entry.get("confidence") != normalized["confidence"]:
            changed = True

    if changed:
        _persist_user_facts(cleaned)
    return cleaned


def _load_memory_items() -> list[MemoryItem]:
    store = _load_store()
    raw = store.get("memories", [])
    if not isinstance(raw, list):
        return []

    cleaned: list[MemoryItem] = []
    changed = False
    for entry in raw[:_MAX_MEMORY_ITEMS]:
        normalized = _normalize_memory_item(entry)
        if not normalized:
            changed = True
            continue
        cleaned.append(normalized)

    if len(raw) > _MAX_MEMORY_ITEMS:
        changed = True
    if changed:
        _persist_memory_items(cleaned)
    return cleaned


def _persist_user_facts(facts: dict[FactType, UserFact]) -> None:
    store = _load_store()
    store["facts"] = {k: dict(v) for k, v in facts.items()}
    _save_store(store)


def _persist_memory_items(items: list[MemoryItem]) -> None:
    store = _load_store()
    store["memories"] = [dict(i) for i in items[:_MAX_MEMORY_ITEMS]]
    _save_store(store)


def _extract_memory_from_text(
    text: str,
) -> Optional[tuple[MemoryCategory, Confidence, str, str, str]]:
    """Return category, confidence, value, memory_id, label."""
    for category, confidence, pattern, group_indices in _MEMORY_LEARN_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if group_indices is not None:
            topic_g, value_g = group_indices
            if not match.lastindex or match.lastindex < value_g:
                continue
            topic = _trim_value(match.group(topic_g))
            value = _trim_value(match.group(value_g))
            if not topic or not value:
                continue
            display = f"{topic}: {value}"
            mem_id = f"{category}:favorite-{_slug(topic)}"
            return category, confidence, display, mem_id, _CATEGORY_LABELS[category]
        value = _trim_value(match.group(1))
        if not _is_valid_fact_value(value):
            continue
        mem_id = f"{category}:{_slug(value)}"
        return category, confidence, value, mem_id, _CATEGORY_LABELS[category]
    return None


def _probe_profile_conflicts(
    text: str,
    facts: dict[FactType, UserFact],
) -> list[MemoryConflict]:
    conflicts: list[MemoryConflict] = []
    for fact_type, patterns in _LEARN_PATTERNS.items():
        for pattern in patterns:
            match = pattern.search(text)
            if not match:
                continue
            value = _trim_value(match.group(1))
            if fact_type == "age":
                normalized_age = _normalize_age_value(value)
                if not normalized_age:
                    continue
                value = normalized_age
            elif not _is_valid_fact_value(value):
                continue
            existing = facts.get(fact_type)
            if existing and existing["value"].lower() != value.lower():
                conflicts.append(
                    MemoryConflict(
                        category=_CATEGORY_FOR_FACT[fact_type],
                        label=_LABELS[fact_type],
                        existing_value=existing["value"],
                        new_value=value,
                        fact_key=fact_type,
                    )
                )
            break
    return conflicts


def _probe_memory_conflicts(
    text: str,
    items: list[MemoryItem],
) -> list[MemoryConflict]:
    extracted = _extract_memory_from_text(text)
    if not extracted:
        return []
    category, _conf, value, mem_id, label = extracted
    for item in items:
        if item["id"] != mem_id:
            continue
        if item["value"].lower() != value.lower():
            return [
                MemoryConflict(
                    category=category,
                    label=label,
                    existing_value=item["value"],
                    new_value=value,
                    memory_id=mem_id,
                )
            ]
    return []


def probe_learn_conflicts(user_text: str) -> list[MemoryConflict]:
    text = user_text.strip()
    if not _eligible_to_learn(text):
        return []
    facts = _load_user_facts()
    items = _load_memory_items()
    return _probe_profile_conflicts(text, facts) + _probe_memory_conflicts(text, items)


def try_user_age_learn_reply(message: str) -> Optional[str]:
    """Short ack when they tell you their age — not a recall question."""
    text = message.strip()
    if not text or is_user_age_recall_question(text):
        return None
    if _extract_age_from_text(text) is None:
        return None
    result = learn_from_user_message(text)
    if result.conflicts:
        return _conflict_clarification_reply(result.conflicts[0])
    if "age" in result.updated:
        age = get_facts().get("age", "")
        return f"Got it — you're {age}." if age else None
    return None


def try_memory_conflict_reply(message: str) -> Optional[str]:
    conflicts = probe_learn_conflicts(message)
    if not conflicts:
        return None
    return _conflict_clarification_reply(conflicts[0])


def _conflict_clarification_reply(conflict: MemoryConflict) -> str:
    if conflict.fact_key:
        return (
            f"Wait — you told me your {conflict.label.lower()} was "
            f"{conflict.existing_value}, but now it sounds like {conflict.new_value}. "
            f"Which should I keep?"
        )
    return (
        f"Wait — you said {conflict.existing_value}, but now it sounds like "
        f"{conflict.new_value}. Which should I keep?"
    )


def learn_from_user_message(user_text: str) -> LearnResult:
    """
    Store facts from an explicit user statement only.
    Never call for assistant text. Conflicts are not auto-overwritten.
    """
    text = user_text.strip()
    result = LearnResult()
    if not _eligible_to_learn(text):
        return result

    facts = _load_user_facts()
    items = _load_memory_items()
    result.conflicts = _probe_profile_conflicts(text, facts) + _probe_memory_conflicts(
        text, items
    )
    if result.conflicts:
        return result

    for fact_type, patterns in _LEARN_PATTERNS.items():
        for pattern in patterns:
            match = pattern.search(text)
            if not match:
                continue
            value = _trim_value(match.group(1))
            if fact_type == "age":
                normalized_age = _normalize_age_value(value)
                if not normalized_age:
                    continue
                value = normalized_age
            elif not _is_valid_fact_value(value):
                continue
            facts[fact_type] = {
                "value": value,
                "source": "user",
                "fact_type": fact_type,
                "category": _CATEGORY_FOR_FACT[fact_type],
                "confidence": "high",
                "timestamp": _utc_now(),
                "user_text": text[:500],
            }
            result.updated.append(fact_type)
            break

    extracted = _extract_memory_from_text(text)
    if extracted:
        category, confidence, value, mem_id, _label = extracted
        items = [i for i in items if i["id"] != mem_id]
        items.append(
            {
                "id": mem_id,
                "category": category,
                "value": value,
                "source": "user",
                "confidence": confidence,
                "timestamp": _utc_now(),
                "user_text": text[:500],
            }
        )
        if len(items) > _MAX_MEMORY_ITEMS:
            items = items[-_MAX_MEMORY_ITEMS:]
        result.updated.append(mem_id)

    profile_changed = any(k in _LEARN_PATTERNS for k in result.updated)
    if profile_changed:
        _persist_user_facts(facts)
    if extracted:
        _persist_memory_items(items)

    return result


def get_facts() -> dict[str, str]:
    """Latest user-sourced profile fact values (API / prompt)."""
    return {k: v["value"] for k, v in _load_user_facts().items()}


def get_fact_entries() -> dict[str, UserFact]:
    return dict(_load_user_facts())


def get_memory_items() -> list[MemoryItem]:
    return list(_load_memory_items())


def fact_count() -> int:
    return len(get_facts()) + len(get_memory_items())


def is_memory_recall_question(message: str) -> bool:
    text = message.strip()
    if not text:
        return False
    if is_user_age_recall_question(text):
        return True
    if _RECALL_GENERAL.search(text):
        return True
    if _RECALL_PREFERENCE.search(text):
        return True
    if _REMEMBER_TOPIC.search(text):
        return True
    return any(pattern.search(text) for pattern in _RECALL_BY_KEY.values())


def _unknown_reply(seed: str, *, soft: bool = False) -> str:
    if soft:
        return "I'm not totally sure — I don't think you've told me that yet."
    return _UNKNOWN_REPLIES[sum(ord(c) for c in seed) % len(_UNKNOWN_REPLIES)]


def _topic_to_fact_type(topic: str) -> Optional[FactType]:
    t = topic.lower().strip()
    if re.search(r"\b(?:name|called)\b", t):
        return "name"
    if re.search(r"\b(?:birthday|born)\b", t):
        return "birthday"
    if re.search(r"\b(?:age|old)\b", t):
        return "age"
    if re.search(r"\b(?:from|live|location|city|hometown)\b", t):
        return "location"
    return None


def _casual_fact_line(key: FactType, value: str) -> str:
    if key == "name":
        return f"you're {value}"
    if key == "birthday":
        return f"your birthday's {value}"
    if key == "location":
        return f"you're from {value}"
    if key == "age":
        return f"you're {value}"
    return f"your {_LABELS[key].lower()} is {value}"


def _casual_memory_line(item: MemoryItem) -> str:
    cat = item["category"]
    val = item["value"]
    if cat == "preference":
        return f"you said you like {val}" if not val.startswith("you") else f"you mentioned {val}"
    if cat == "recurring_interest":
        return f"you're into {val}"
    if cat == "session_context":
        return f"for now you're {val}"
    if cat == "emotional_context":
        return f"you were feeling {val}"
    return val


def _confidence_allows_assertion(confidence: Confidence) -> bool:
    return confidence == "high"


def _find_memory_match(message: str, items: list[MemoryItem]) -> Optional[MemoryItem]:
    lower = message.lower()
    for item in reversed(items):
        val_lower = item["value"].lower()
        if val_lower in lower or any(
            tok in lower for tok in val_lower.split() if len(tok) > 4
        ):
            return item
    return None


def try_memory_recall_reply(message: str) -> Optional[str]:
    """Answer only from stored user facts — never guess."""
    text = message.strip()
    if not text:
        return None

    facts = get_facts()
    items = get_memory_items()

    for key, pattern in _RECALL_BY_KEY.items():
        if not pattern.search(text):
            continue
        if key in facts:
            entry = get_fact_entries()[key]
            if not _confidence_allows_assertion(entry["confidence"]):
                return _unknown_reply(text, soft=True)
            line = _casual_fact_line(key, facts[key])
            if key == "name":
                return f"Yeah, {line}."
            if key == "age":
                return f"Right — {line}."
            return f"Right — {line}."
        return _unknown_reply(text)

    topic_match = _REMEMBER_TOPIC.search(text)
    if topic_match:
        fact_type = _topic_to_fact_type(topic_match.group(1))
        if fact_type and fact_type in facts:
            entry = get_fact_entries()[fact_type]
            if not _confidence_allows_assertion(entry["confidence"]):
                return _unknown_reply(text, soft=True)
            line = _casual_fact_line(fact_type, facts[fact_type])
            return f"Yeah — {line}."
        matched = _find_memory_match(text, items)
        if matched:
            if not _confidence_allows_assertion(matched["confidence"]):
                return _unknown_reply(text, soft=True)
            return f"Yeah — {_casual_memory_line(matched)}."
        return _unknown_reply(text)

    if _RECALL_PREFERENCE.search(text) and items:
        prefs = [i for i in items if i["category"] == "preference"]
        if prefs:
            lines = [_casual_memory_line(p) for p in prefs[-3:]]
            if len(lines) == 1:
                return f"Yeah — {lines[0]}."
            return f"Things you've said — {', and '.join(lines)}."

    if not _RECALL_GENERAL.search(text):
        return None

    if not facts and not items:
        return "I don't think you've told me much yet."

    parts: list[str] = []
    for k, v in facts.items():
        entry = get_fact_entries().get(k)
        if entry and _confidence_allows_assertion(entry["confidence"]):
            parts.append(_casual_fact_line(k, v))  # type: ignore[arg-type]
    for item in items:
        if _confidence_allows_assertion(item["confidence"]):
            parts.append(_casual_memory_line(item))

    if not parts:
        return "I don't think you've told me much yet."

    if len(parts) == 1:
        return f"Just that {parts[0]}."
    return f"Not tons — {', and '.join(parts)}."


def format_notes_for_prompt() -> str:
    entries = _load_user_facts()
    items = _load_memory_items()
    if not entries and not items:
        return (
            "(Empty — no user-stated facts saved.)\n"
            "- Do NOT invent, infer, or guess personal details.\n"
            "- If asked what you remember: say naturally they haven't told you yet."
        )

    lines: list[str] = [
        "(ONLY explicit user statements below — never add, infer, paraphrase into new facts, or fabricate.)",
        "- Quote stored wording when recalling; if a detail is not listed, say they haven't told you yet.",
    ]
    by_category: dict[MemoryCategory, list[str]] = {}
    for fact_type, entry in entries.items():
        cat = entry["category"]
        label = _LABELS[fact_type]
        conf = entry["confidence"]
        by_category.setdefault(cat, []).append(
            f"{label}: {entry['value']} (confidence: {conf}, source: user)"
        )
    for item in items:
        cat = item["category"]
        conf = item["confidence"]
        by_category.setdefault(cat, []).append(
            f"{item['value']} (confidence: {conf}, source: user)"
        )

    for cat in (
        "user_profile",
        "preference",
        "recurring_interest",
        "session_context",
        "emotional_context",
    ):
        section = by_category.get(cat)
        if not section:
            continue
        lines.append(f"### {_CATEGORY_LABELS[cat]}")
        lines.extend(f"- {line}" for line in section)

    return "\n".join(lines)


def clear_facts() -> None:
    store = _load_store()
    store["facts"] = {}
    store["memories"] = []
    _save_store(store)


def bootstrap_facts_from_user_history(user_messages: list[str]) -> None:
    """Rebuild facts from user lines only — assistant history is ignored."""
    _persist_user_facts({})
    _persist_memory_items([])
    for text in user_messages:
        learn_from_user_message(text)
