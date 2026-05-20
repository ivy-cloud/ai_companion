"""
In-memory conversation memory (RAM only, lives for the server process).

Stores the latest 10 exchanges as alternating user / assistant messages.
"""

from collections import deque
from typing import Deque, List, Literal, TypedDict

Role = Literal["user", "assistant"]

# One exchange = user message + assistant reply.
MAX_EXCHANGES = 10
MAX_MESSAGE_CHARS = 1500
# Drop oldest turns first if history exceeds this (avoids token explosion).
MAX_TOTAL_HISTORY_CHARS = 6000


class MemoryMessage(TypedDict):
    role: Role
    text: str


_history: Deque[MemoryMessage] = deque(maxlen=MAX_EXCHANGES * 2)


def _trim(text: str) -> str:
    text = text.strip()
    if len(text) <= MAX_MESSAGE_CHARS:
        return text
    return text[:MAX_MESSAGE_CHARS] + "…"


def get_history() -> List[MemoryMessage]:
    """All stored turns, oldest first (at most MAX_EXCHANGES exchanges)."""
    return list(_history)


def exchange_count() -> int:
    """Number of complete user+assistant exchanges in memory."""
    return len(_history) // 2


def append_exchange(user_message: str, assistant_message: str) -> None:
    """Save one exchange after a successful model reply."""
    _history.append({"role": "user", "text": _trim(user_message)})
    _history.append({"role": "assistant", "text": _trim(assistant_message)})


def clear() -> None:
    _history.clear()


def to_ollama_messages() -> List[dict]:
    """
    Convert RAM history to Ollama chat messages (user / assistant roles).
    Keeps the most recent turns that fit within MAX_TOTAL_HISTORY_CHARS.
    """
    if not _history:
        return []

    selected: List[MemoryMessage] = []
    total_chars = 0

    for entry in reversed(_history):
        length = len(entry["text"])
        if selected and total_chars + length > MAX_TOTAL_HISTORY_CHARS:
            break
        selected.append(entry)
        total_chars += length

    selected.reverse()

    return [
        {
            "role": "user" if entry["role"] == "user" else "assistant",
            "content": entry["text"],
        }
        for entry in selected
    ]
