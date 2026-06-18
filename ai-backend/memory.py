"""
Simple conversation memory — last N exchanges on disk.

Chat history is for tone/continuity only. User facts live in profile.py.
Never learned from assistant messages. No vectors, embeddings, or summarization.
"""

import json
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
