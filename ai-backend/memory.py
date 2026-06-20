"""
Simple conversation memory — last N exchanges on disk.

Chat history is for tone/continuity only. User facts live in profile.py.
Never learned from assistant messages. No vectors, embeddings, or summarization.
"""

import json
import re
from collections import deque
from pathlib import Path
from typing import Deque, List, Literal, Optional, TypedDict

Role = Literal["user", "assistant"]

# Keep recent 5–10 exchanges (8 ≈ middle of range)
MAX_EXCHANGES = 8
MAX_MESSAGE_CHARS = 1200

_BACKEND_DIR = Path(__file__).resolve().parent
_HISTORY_PATH = _BACKEND_DIR / "data" / "history.json"


class MemoryMessage(TypedDict):
    role: Role
    text: str


_history: Deque[MemoryMessage] = deque(maxlen=MAX_EXCHANGES * 2)


def _trim(text: str) -> str:
    text = text.strip()
    if len(text) <= MAX_MESSAGE_CHARS:
        return text
    return text[:MAX_MESSAGE_CHARS] + "…"


def _persist() -> None:
    _HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"messages": get_history()}
    _HISTORY_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_persisted() -> None:
    if not _HISTORY_PATH.is_file():
        return
    try:
        data = json.loads(_HISTORY_PATH.read_text(encoding="utf-8"))
        messages = data.get("messages", [])
        if not isinstance(messages, list):
            return
        for item in messages:
            if not isinstance(item, dict):
                continue
            role = item.get("role")
            text = item.get("text")
            if role in ("user", "assistant") and isinstance(text, str) and text.strip():
                _history.append({"role": role, "text": _trim(text)})
    except (json.JSONDecodeError, OSError):
        pass


_load_persisted()


def get_history() -> List[MemoryMessage]:
    return list(_history)


def exchange_count() -> int:
    return len(_history) // 2


def last_exchange() -> tuple[Optional[str], Optional[str]]:
    """Most recent user message and assistant reply, if any."""
    user_text: Optional[str] = None
    asst_text: Optional[str] = None
    for msg in reversed(_history):
        if msg["role"] == "assistant" and asst_text is None:
            asst_text = msg["text"]
        elif msg["role"] == "user" and user_text is None:
            user_text = msg["text"]
        if user_text and asst_text:
            break
    return user_text, asst_text


_DEICTIC = re.compile(
    r"\b(?:that|this|it|those|these|there|the same|what about|how about|"
    r"who won|which one|last game|the game|the match|the score|that game)\b",
    re.I,
)

_AMBIGUOUS_SHORT = re.compile(
    r"^(?:"
    r"(?:what|who)\s+about\b|"
    r"(?:who|what)\s+won\b|"
    r"last\s+\w+\s+today\b|"
    r"the\s+(?:game|match|score|result)\b|"
    r"and\s+(?:the|that)\b|"
    r"how\s+(?:did|was)\s+(?:that|it)\b|"
    r"what(?:'s| is| are) (?:that|this|it)\b|"
    r"what (?:are|were) you (?:talking|going on) about\b|"
    r"what do you mean\b|"
    r"what did you (?:mean|say)\b|"
    r"what was that\b|"
    r"say that again\b|"
    r"what are you saying\b|"
    r"why would you say\b|"
    r"^huh\b|"
    r"^sorry,? what\b"
    r")",
    re.I,
)

_CURRENT_TIME = re.compile(
    r"\b(?:today|tonight|yesterday|this morning|this afternoon|this evening|"
    r"right now|latest|just now)\b",
    re.I,
)


def is_ambiguous_follow_up(message: str) -> bool:
    """Short or deictic follow-up that needs recent chat to interpret."""
    text = message.strip()
    if not text or not _history:
        return False
    words = text.split()
    lower = text.lower().rstrip("?!.")
    if len(words) <= 2:
        return True
    if len(words) <= 6 and _DEICTIC.search(lower):
        return True
    if _AMBIGUOUS_SHORT.match(lower):
        return True
    if re.search(r"\blast\s+(?:game|match|one)\b", lower) and _CURRENT_TIME.search(lower):
        return True
    return False


def recent_user_messages(limit: int = 2) -> List[str]:
    """Last N user lines from chat history (oldest first)."""
    users: List[str] = []
    for msg in reversed(_history):
        if msg["role"] == "user":
            users.append(msg["text"])
            if len(users) >= limit:
                break
    return list(reversed(users))


def current_topic_summary() -> Optional[str]:
    """Lightweight topic from the last 1–2 substantive user turns."""
    users = recent_user_messages(2)
    if not users:
        return None
    for text in reversed(users):
        words = text.split()
        if len(words) < 3:
            continue
        snippet = " ".join(words[:12])
        if len(snippet) > 100:
            snippet = f"{snippet[:99].rstrip()}…"
        return snippet
    last = users[-1].strip()
    return last[:80] if last else None


_REFERENCES_CHAT = re.compile(
    r"\b(?:"
    r"you said|you just said|what you said|what you meant|"
    r"earlier|before|we were talking|that thing|remember when|"
    r"last time|you mentioned|from what you|based on what|"
    r"like you said|when you said|back to what"
    r")\b",
    re.I,
)


def should_answer_from_chat_first(message: str) -> bool:
    """
    Prefer recent chat over web lookup — follow-ups, confusion, social chat,
    or general questions answerable from the thread.
    """
    text = message.strip()
    if not text or not _history:
        return False

    from context import is_casual_day_comment, is_social_checkin
    from web_search import is_conversational_confusion, is_factual_question, needs_live_web_lookup

    # Weather, scores, headlines, explicit lookup — never chat-only.
    if needs_live_web_lookup(text):
        return False

    if is_ambiguous_follow_up(text):
        return True
    if is_conversational_confusion(text):
        return True
    if is_social_checkin(text) or is_casual_day_comment(text):
        return True
    if _REFERENCES_CHAT.search(text):
        return True
    # General WH questions without live-web signals — history first, no search.
    if is_factual_question(text):
        return True
    return False


def chat_first_turn_hint(message: str) -> str:
    if not should_answer_from_chat_first(message):
        return ""
    topic = current_topic_summary()
    if topic:
        return (
            f"Chat-first: use recent messages about «{topic}» before any fact check. "
            "Friend voice — not a search recap."
        )
    return (
        "Chat-first: answer from recent messages if you can — "
        "friend voice, not a search recap."
    )


def continuity_follow_up_turn_hint(message: str) -> str:
    """Turn hint when a short follow-up refers to the ongoing thread."""
    if not is_ambiguous_follow_up(message):
        return ""
    topic = current_topic_summary()
    if topic:
        return (
            f"Continuity: they are continuing the thread about «{topic}» — "
            "resolve their follow-up in that context before answering generally."
        )
    return (
        "Continuity: short follow-up — use the recent chat messages to infer "
        "what they mean; do not answer as if this were a brand-new topic."
    )


def should_keep_history_for_turn(
    message: str,
    *,
    math_turn: bool,
    profile_turn: bool,
    factual: bool,
) -> bool:
    """Whether recent exchanges stay in the LLM message list for this turn."""
    if math_turn or profile_turn:
        return False
    if should_answer_from_chat_first(message):
        return bool(_history)
    if factual and not is_ambiguous_follow_up(message):
        return False
    return bool(_history)


def append_exchange(user_message: str, assistant_message: str) -> None:
    """Store dialogue only — assistant text is never used for long-term facts."""
    _history.append({"role": "user", "text": _trim(user_message)})
    _history.append({"role": "assistant", "text": _trim(assistant_message)})
    _persist()


def append_assistant_continuation(assistant_message: str) -> None:
    """Proactive companion line — no user turn; chains after prior assistant if needed."""
    text = _trim(assistant_message)
    if not text:
        return
    if _history and _history[-1]["role"] == "assistant":
        prev = _history[-1]["text"]
        merged = _trim(f"{prev} {text}")
        _history[-1] = {"role": "assistant", "text": merged}
    else:
        _history.append({"role": "assistant", "text": text})
    _persist()


def clear() -> None:
    _history.clear()
    if _HISTORY_PATH.is_file():
        _HISTORY_PATH.unlink()


def to_ollama_messages(_current_user_message: str = "") -> List[dict]:
    """Last MAX_EXCHANGES only — no retrieval, embeddings, or summarization."""
    if not _history:
        return []

    return [
        {
            "role": "user" if entry["role"] == "user" else "assistant",
            "content": entry["text"],
        }
        for entry in _history
    ]
