"""
Turn live search snippets into a short factual answer (any topic).

Uses a strict, low-temperature Ollama pass on sources only — separate from the
companion personality pass so training data and chat history do not override the web.
"""

from typing import List, Optional

import llm_provider

from web_search import SearchHit

_GROUNDING_SYSTEM = """Extract the accurate answer from the numbered sources below.

This is an INTERNAL fact digest — not spoken aloud verbatim.

Rules:
- Use only source facts. No outside knowledge.
- If sources conflict, prefer "current", "today", or the newest year.
- One or two short plain sentences. Under 20 words when possible.
- No lists, markdown, "according to", or source numbers in the answer.
- If sources don't answer it: reply exactly INSUFFICIENT"""


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

    text = llm_provider.complete_chat(
        [
            {"role": "system", "content": _GROUNDING_SYSTEM},
            {
                "role": "user",
                "content": f"Question: {question.strip()}\n\nSources:\n{sources}",
            },
        ],
        temperature=0.1,
        max_tokens=80,
    )
    if not text:
        return None
    text = text.strip()
    if not text or "INSUFFICIENT" in text.upper():
        return None
    return text

