"""
User facts store — only explicit user statements are persisted.

Assistant messages are never a source of truth and are never stored as facts.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

_BACKEND_DIR = Path(__file__).resolve().parent
_PROFILE_PATH = _BACKEND_DIR / "data" / "profile.json"

FactType = Literal["name", "birthday", "location"]
Source = Literal["user"]

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
}

_LABELS: dict[FactType, str] = {
    "birthday": "Birthday",
    "name": "Name",
    "location": "Where they live",
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
}

_REMEMBER_TOPIC = re.compile(
    r"\bdo you remember(?:\s+(?:my|that|when|what|if))?\s+(.+?)\??\s*$",
    re.I,
)

_UNKNOWN_REPLIES = (
    "I don't think you've told me yet.",
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
    timestamp: str
    user_text: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_store() -> dict[str, Any]:
    if not _PROFILE_PATH.is_file():
        return {"facts": {}}
    try:
        data = json.loads(_PROFILE_PATH.read_text(encoding="utf-8"))
        if isinstance(data.get("facts"), dict):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"facts": {}}


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


def _is_valid_fact_value(value: str) -> bool:
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
    if not _USER_ASSERTION_START.search(text):
        return False
    return _has_user_assertion(text)


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

    if not user_text or not _eligible_to_learn(user_text):
        return None
    if not _value_matches_patterns(fact_type, user_text, value):  # type: ignore[arg-type]
        return None

    return {
        "value": value,
        "source": "user",
        "fact_type": fact_type,  # type: ignore[typeddict-item]
        "timestamp": ts,
        "user_text": user_text,
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

    if changed:
        _persist_user_facts(cleaned)
    return cleaned


def _persist_user_facts(facts: dict[FactType, UserFact]) -> None:
    store = _load_store()
    store["facts"] = {k: dict(v) for k, v in facts.items()}
    _save_store(store)


def learn_from_user_message(user_text: str) -> list[str]:
    """
    Store facts from an explicit user statement only.
    Never call for assistant text. Returns fact_type keys updated.
    """
    text = user_text.strip()
    if not _eligible_to_learn(text):
        return []

    facts = _load_user_facts()
    updated: list[str] = []

    for fact_type, patterns in _LEARN_PATTERNS.items():
        for pattern in patterns:
            match = pattern.search(text)
            if not match:
                continue
            value = _trim_value(match.group(1))
            if not _is_valid_fact_value(value):
                continue
            facts[fact_type] = {
                "value": value,
                "source": "user",
                "fact_type": fact_type,
                "timestamp": _utc_now(),
                "user_text": text[:500],
            }
            updated.append(fact_type)
            break

    if updated:
        _persist_user_facts(facts)
    return updated


def get_facts() -> dict[str, str]:
    """Latest user-sourced fact values (API / prompt)."""
    return {k: v["value"] for k, v in _load_user_facts().items()}


def get_fact_entries() -> dict[str, UserFact]:
    return dict(_load_user_facts())


def fact_count() -> int:
    return len(get_facts())


def is_memory_recall_question(message: str) -> bool:
    text = message.strip()
    if not text:
        return False
    if _RECALL_GENERAL.search(text):
        return True
    if _REMEMBER_TOPIC.search(text):
        return True
    return any(pattern.search(text) for pattern in _RECALL_BY_KEY.values())


def _unknown_reply(seed: str) -> str:
    return _UNKNOWN_REPLIES[sum(ord(c) for c in seed) % len(_UNKNOWN_REPLIES)]


def _topic_to_fact_type(topic: str) -> Optional[FactType]:
    t = topic.lower().strip()
    if re.search(r"\b(?:name|called)\b", t):
        return "name"
    if re.search(r"\b(?:birthday|born)\b", t):
        return "birthday"
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
    return f"your {_LABELS[key].lower()} is {value}"


def try_memory_recall_reply(message: str) -> Optional[str]:
    """Answer only from stored user facts — never guess."""
    text = message.strip()
    if not text:
        return None

    facts = get_facts()

    for key, pattern in _RECALL_BY_KEY.items():
        if not pattern.search(text):
            continue
        if key in facts:
            line = _casual_fact_line(key, facts[key])
            return f"Yeah, {line}." if key == "name" else f"Right — {line}."
        return _unknown_reply(text)

    topic_match = _REMEMBER_TOPIC.search(text)
    if topic_match:
        fact_type = _topic_to_fact_type(topic_match.group(1))
        if fact_type and fact_type in facts:
            line = _casual_fact_line(fact_type, facts[fact_type])
            return f"Yeah — {line}."
        return _unknown_reply(text)

    if not _RECALL_GENERAL.search(text):
        return None

    if not facts:
        return "I don't think you've told me much yet."

    parts = [_casual_fact_line(k, v) for k, v in facts.items()]  # type: ignore[arg-type]
    if len(parts) == 1:
        return f"Just that {parts[0]}."
    return f"Not tons — {', and '.join(parts)}."


def format_notes_for_prompt() -> str:
    entries = _load_user_facts()
    if not entries:
        return (
            "(Empty — no user-stated facts saved.)\n"
            "- Do NOT invent, infer, or guess personal details.\n"
            "- If asked what you remember: say naturally they haven't told you yet."
        )

    lines: list[str] = [
        "(ONLY these explicit user statements — never add, infer, or fabricate.)",
    ]
    for fact_type, entry in entries.items():
        label = _LABELS[fact_type]
        lines.append(f"- {label}: {entry['value']}")
    return "\n".join(lines)


def clear_facts() -> None:
    if _PROFILE_PATH.is_file():
        _PROFILE_PATH.unlink()


def bootstrap_facts_from_user_history(user_messages: list[str]) -> None:
    """Rebuild facts from user lines only — assistant history is ignored."""
    _persist_user_facts({})
    for text in user_messages:
        learn_from_user_message(text)
