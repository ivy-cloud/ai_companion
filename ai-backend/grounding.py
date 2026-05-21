"""
Turn live search snippets into a short factual answer (any topic).

Uses a strict, low-temperature Ollama pass on sources only — separate from the
companion personality pass so training data and chat history do not override the web.
"""

import json
import os
from typing import List, Optional

import httpx

from web_search import SearchHit

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"

_GROUNDING_SYSTEM = """Answer using ONLY the numbered sources below.

Spoken delivery (this will be read aloud):
- One or two short sentences. Under 15 words when possible.
- Sound natural spoken: plain words, few commas, no semicolons, no parentheses, no markdown.
- No long clauses — one idea per sentence.

Rules:
- Use only source facts. No outside knowledge.
- If sources conflict, prefer "current", "today", or the newest year.
- If sources don't answer it: reply exactly INSUFFICIENT
- No preamble, lists, or formal tone."""


def _format_sources(hits: List[SearchHit], max_items: int = 8) -> str:
    lines = []
    for i, hit in enumerate(hits[:max_items], 1):
        title = hit["title"].strip() or "Source"
        snippet = hit["snippet"].strip()
        if snippet:
            lines.append(f"[{i}] {title}: {snippet[:700]}")
    return "\n".join(lines)


def answer_from_sources(question: str, hits: List[SearchHit]) -> Optional[str]:
    """Extract an accurate short answer from live search hits (general, any topic)."""
    from current_facts import extract_current_us_president_name, is_us_president_question

    if is_us_president_question(question):
        name = extract_current_us_president_name(hits)
        if name:
            return f"{name} is the president of the United States."

    sources = _format_sources(hits)
    if not sources:
        return None

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": _GROUNDING_SYSTEM},
            {
                "role": "user",
                "content": f"Question: {question.strip()}\n\nSources:\n{sources}",
            },
        ],
        "stream": False,
        "options": {"temperature": 0.1, "top_p": 0.85},
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
            response = client.post(OLLAMA_CHAT_URL, json=payload)
            if response.status_code >= 400:
                return None
            data = response.json()
    except Exception:
        return None

    text = str(data.get("message", {}).get("content", "")).strip()
    if not text or "INSUFFICIENT" in text.upper():
        return None
    return text

