"""
Companion's own name — persisted separately from user facts.

Default or random on first run; user may set via explicit phrases ("call you Luna").
"""

import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

_BACKEND_DIR = Path(__file__).resolve().parent
_PROFILE_PATH = _BACKEND_DIR / "data" / "profile.json"

NameSource = Literal["user", "default"]

_DEFAULT_NAMES = (
    "Luna",
    "Mia",
    "Sage",
    "Ava",
    "Jules",
    "Riley",
    "Nova",
    "Sky",
    "Wren",
    "Cleo",
)

_NAME_TOKEN = r"([A-Za-z][A-Za-z'-]{1,19})"

_LEARN_NAME_PATTERNS = [
    re.compile(rf"\byour name is\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\byour new name is\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bcall you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bi(?:'ll| will) call you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bi want to call you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\b(?:let's|lets) call you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\byou should be called\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bfrom now on (?:you're|you are)\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bname yourself\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bchange your name to\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\brename yourself\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\brename you to\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\b(?:make|set) your name (?:to\s+)?{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bgo by\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bbe called\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bi name you\s+{_NAME_TOKEN}\b", re.I),
]

# User renaming themselves — never treat as companion rename.
_USER_NAME_TOPIC = re.compile(
    r"\b(?:"
    r"(?:change|alter|update|pick|choose) my name|"
    r"rename me\b|"
    r"call me\b|"
    r"my name should be|"
    r"what should my name|"
    r"can i change my name|"
    r"could i change my name|"
    r"how do i change my name|"
    r"i want (?:a )?(?:new|different) name\b"
    r")\b",
    re.I,
)

# Companion-focused: rename / naming *you* (no new name in the message).
_ASK_RENAME_COMPANION = re.compile(
    r"\b(?:"
    r"(?:can|could|would) you change your name|"
    r"(?:can|could) (?:i|we) (?:change|rename) your name|"
    r"(?:can|could) (?:i|we) rename you\b|"
    r"(?:can|could) i (?:call|name) you\b|"
    r"change your name\b|"
    r"rename yourself\b|"
    r"rename you\b|"
    r"pick (?:a )?(?:new |different )?name(?: for you| for yourself)?|"
    r"choose (?:a )?(?:new )?name(?: for you| for yourself)?|"
    r"(?:want|wanted) (?:to )?(?:change|rename) your name|"
    r"(?:want|wanted) (?:to )?rename you\b|"
    r"give yourself a name|"
    r"name yourself\b|"
    r"(?:switch|use) (?:a )?(?:new |different )?name|"
    r"(?:another|different) name for you|"
    r"what do you want to be called|"
    r"what (?:name )?do you want|"
    r"how (?:can|do) i change your name|"
    r"how (?:can|do) i rename you|"
    r"is it possible to change your name|"
    r"do you want (?:a )?(?:new |different )?name|"
    r"would you like (?:a )?(?:new |different )?name"
    r")\b",
    re.I,
)

_MENTIONS_COMPANION_NAME = re.compile(
    r"\b(?:"
    r"your name|"
    r"rename you|"
    r"call you\b|"
    r"name you\b|"
    r"name for you|"
    r"name yourself|"
    r"you(?:'re| are) called|"
    r"about your name"
    r")\b",
    re.I,
)

_RECALL_COMPANION_NAME = re.compile(
    r"\b(?:"
    r"what(?:'s| is) your name|"
    r"do you have a name|"
    r"what should i call you|"
    r"what do i call you|"
    r"who are you|"
    r"what are you called|"
    r"remind me your name|"
    r"remember your name"
    r")\b",
    re.I,
)

_MY_NAME_NOT_THEIRS = re.compile(r"\bmy name is\b", re.I)


class CompanionNameRecord(TypedDict):
    value: str
    source: NameSource
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


def _normalize_name(raw: str) -> Optional[str]:
    name = raw.strip().strip(".,!?\"'")
    if not name or len(name) > 20:
        return None
    if not re.match(r"^[A-Za-z][A-Za-z'-]*$", name):
        return None
    blocked = {"ai", "assistant", "bot", "companion", "friend", "user"}
    if name.lower() in blocked:
        return None
    return name[0].upper() + name[1:]


def _parse_companion_name(entry: Any) -> Optional[CompanionNameRecord]:
    if not isinstance(entry, dict):
        return None
    value = entry.get("value")
    source = entry.get("source")
    if not isinstance(value, str) or source not in ("user", "default"):
        return None
    normalized = _normalize_name(value)
    if not normalized:
        return None
    ts = entry.get("timestamp")
    if not isinstance(ts, str) or not ts.strip():
        ts = _utc_now()
    user_text = entry.get("user_text")
    if not isinstance(user_text, str):
        user_text = ""
    return {
        "value": normalized,
        "source": source,
        "timestamp": ts,
        "user_text": user_text[:500],
    }


def _pick_default_name() -> str:
    env = os.environ.get("COMPANION_DEFAULT_NAME", "").strip()
    if env:
        normalized = _normalize_name(env)
        if normalized:
            return normalized
    return secrets.choice(_DEFAULT_NAMES)


def _save_companion_name(
    name: str,
    source: NameSource,
    user_text: str = "",
) -> str:
    store = _load_store()
    store["companion_name"] = {
        "value": name,
        "source": source,
        "timestamp": _utc_now(),
        "user_text": user_text[:500],
    }
    _save_store(store)
    return name


def ensure_companion_name() -> str:
    """Return saved name, or assign default/random once."""
    store = _load_store()
    record = _parse_companion_name(store.get("companion_name"))
    if record:
        return record["value"]
    return _save_companion_name(_pick_default_name(), "default")


def get_companion_name() -> str:
    return ensure_companion_name()


def get_companion_name_record() -> CompanionNameRecord:
    store = _load_store()
    record = _parse_companion_name(store.get("companion_name"))
    if record:
        return record
    name = _save_companion_name(_pick_default_name(), "default")
    return {
        "value": name,
        "source": "default",
        "timestamp": _utc_now(),
        "user_text": "",
    }


def get_companion_info() -> dict[str, Any]:
    record = get_companion_name_record()
    return {
        "name": record["value"],
        "source": record["source"],
        "timestamp": record["timestamp"],
        "user_set": record["source"] == "user",
    }


def try_learn_name_from_user(user_text: str) -> bool:
    """Persist companion name from an explicit user instruction (not inferred)."""
    text = user_text.strip()
    if not text or _MY_NAME_NOT_THEIRS.search(text):
        return False

    for pattern in _LEARN_NAME_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        name = _normalize_name(match.group(1))
        if name:
            _save_companion_name(name, "user", text)
            return True
    return False


def try_name_recall_reply(message: str) -> Optional[str]:
    """Short spoken answer for 'what's your name?' — from saved record only."""
    text = message.strip()
    if not text or _is_user_name_topic(text):
        return None
    # Rename asks overlap ("what do you want to be called") — hint, not recall.
    if _is_companion_rename_ask(text):
        return _rename_hint_reply()
    if not _RECALL_COMPANION_NAME.search(text):
        return None
    name = get_companion_name()
    return f"I'm {name}."


def _is_user_name_topic(text: str) -> bool:
    """True when they mean their own name, not the companion's."""
    if _MENTIONS_COMPANION_NAME.search(text):
        return False
    return bool(_USER_NAME_TOPIC.search(text))


def _is_companion_rename_ask(text: str) -> bool:
    if _is_user_name_topic(text):
        return False
    if _ASK_RENAME_COMPANION.search(text):
        return True
    # Short asks with clear "you" target: "new name for you?"
    if _MENTIONS_COMPANION_NAME.search(text) and re.search(
        r"\b(?:change|rename|new|different|pick|choose)\b.*\bname\b",
        text,
        re.I,
    ):
        return True
    return False


def _rename_hint_reply() -> str:
    name = get_companion_name()
    return f"Yeah — I'm {name}. Say call you whatever you want."


def try_name_change_reply(message: str) -> Optional[str]:
    """
    Rename *companion* (not the user). Canned so the model won't say
    'you can change your name' about the human.
    """
    text = message.strip()
    if not text or _is_user_name_topic(text):
        return None

    if try_learn_name_from_user(text):
        name = get_companion_name()
        return f"Sure — I'm {name} now."

    if not _is_companion_rename_ask(text):
        return None

    return _rename_hint_reply()


def set_companion_name_by_user(name: str, user_text: str = "") -> str:
    """Explicit rename (API or validated caller)."""
    normalized = _normalize_name(name)
    if not normalized:
        raise ValueError("Invalid name")
    return _save_companion_name(normalized, "user", user_text or f"set name to {normalized}")


def format_name_for_prompt() -> str:
    record = get_companion_name_record()
    if record["source"] == "user":
        return (
            f"- Your name is **{record['value']}** (they chose this for you).\n"
            f"- Do **not** say your name in every reply — only when they ask who you are.\n"
            f"- Never say \"AI companion\", \"an AI\", or \"language model\".\n"
            f"- If they ask your name: you're {record['value']}.\n"
            f"- If they ask to change **your** name: they mean **you**, not them — "
            f"tell them to say \"call you <name>\" (do not talk about changing *their* name)."
        )
    return (
        f"- Your name is **{record['value']}** (default until they rename you).\n"
        f"- Do **not** say your name in every reply — only when they ask who you are.\n"
        f"- Never say \"AI companion\", \"an AI\", or \"language model\".\n"
        f"- If they ask to change **your** name: they mean **you** — say \"call you <name>\" "
        f"(never \"you can change your name\" about the human)."
    )
