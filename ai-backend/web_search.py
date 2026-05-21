"""
Live web lookup on each request — nothing is pre-written or cached as answers.

Providers: Tavily (optional) + DuckDuckGo + Wikipedia, merged and ranked generically.
"""

import os
import re
from datetime import datetime
from typing import Callable, List, Optional, Set, TypedDict
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx

_HEADERS = {"User-Agent": "ai-companion/1.0 (local; educational)"}

_FILLER_PREFIX = re.compile(
    r"^(?:do you know|could you tell me|can you tell me|please tell me|"
    r"i(?:'m| am) wondering|i wonder|hey,?|so,?)\s+",
    re.I,
)


class SearchHit(TypedDict):
    title: str
    snippet: str
    url: str


_GREETINGS = frozenset(
    {
        "hi",
        "hello",
        "hey",
        "thanks",
        "thank you",
        "ok",
        "okay",
        "bye",
        "goodbye",
        "good morning",
        "good night",
    }
)


def search_mode() -> str:
    return os.environ.get("WEB_SEARCH_MODE", "always").strip().lower()


def is_enabled() -> bool:
    return search_mode() not in ("off", "false", "0", "disabled", "none")


def max_results() -> int:
    try:
        n = int(os.environ.get("WEB_SEARCH_MAX_RESULTS", "6"))
        return max(1, min(n, 10))
    except ValueError:
        return 6


def _current_year() -> str:
    tz_name = os.environ.get("COMPANION_TIMEZONE", "America/Los_Angeles").strip()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/Los_Angeles")
    return str(datetime.now(tz).year)


def is_simple_math_question(message: str) -> bool:
    """Arithmetic / pure math — no web lookup, no clock or notes in context."""
    from context import is_simple_math_question as _is_simple_math

    return _is_simple_math(message)


def is_factual_question(message: str) -> bool:
    """Generic: user wants a verifiable fact, not casual chat."""
    from context import is_time_question

    text = message.strip()
    lower = text.lower().rstrip("?").strip()
    if is_simple_math_question(text):
        return False
    if is_time_question(text):
        return False
    if re.match(
        r"^how (?:are you|you doing|is it going|have you been|was your|did your)\b",
        lower,
    ):
        return False
    if lower.startswith(
        ("who ", "what ", "when ", "where ", "which ", "why ")
    ) or re.match(r"^how (?:many|much|old|long|far|tall|big|often)\b", lower):
        return True
    if "?" in text and not lower.startswith(("how ", "why not ")):
        return True
    return False


def asks_about_current(message: str) -> bool:
    lower = message.lower()
    return bool(
        re.search(r"\b(current|today|now|right now|latest|this year|at the moment)\b", lower)
    )


def should_search(message: str) -> bool:
    if not is_enabled():
        return False

    from context import is_time_question

    text = message.strip()
    if len(text) < 4 or is_time_question(text) or is_simple_math_question(text):
        return False

    lower = text.lower().rstrip("?").strip()
    if lower in _GREETINGS:
        return False

    mode = search_mode()
    if mode == "always":
        return is_factual_question(text) or asks_about_current(text)

    if mode == "questions":
        return is_factual_question(text)

    if mode == "smart":
        return is_factual_question(text) or asks_about_current(text)

    return False


def rewrite_for_search(message: str) -> str:
    """Strip conversational filler so search engines get a clean query."""
    text = message.strip().rstrip("?").strip()
    text = _FILLER_PREFIX.sub("", text).strip()
    return text or message.strip()


def build_search_queries(user_message: str) -> List[str]:
    """Build live search queries (keywords only — never stored answers)."""
    original = user_message.strip()
    core = rewrite_for_search(original)
    year = _current_year()
    queries = [core, original]

    if re.search(
        r"\b(?:president|ceo|prime minister|governor)\b.*\b(?:united states|u\.?s\.?|america)\b",
        original,
        re.I,
    ) or re.search(
        r"\b(?:united states|u\.?s\.?|america)\b.*\bpresident\b",
        original,
        re.I,
    ):
        queries.insert(0, f"current president of the United States {year}")
    elif asks_about_current(original) or re.search(
        r"\b(ceo|president|prime minister|governor|population|price|score)\b",
        original,
        re.I,
    ):
        queries.append(f"{core} {year}")

    seen: Set[str] = set()
    out: List[str] = []
    for q in queries:
        key = q.lower()
        if key and key not in seen:
            seen.add(key)
            out.append(q)
    return out[:4]


def _search_tavily(query: str, limit: int) -> List[SearchHit]:
    key = os.environ.get("TAVILY_API_KEY", "").strip()
    if not key:
        return []

    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": key,
                "query": query,
                "max_results": limit,
                "search_depth": "advanced",
                "include_answer": True,
            },
            timeout=20.0,
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        return []

    hits: List[SearchHit] = []
    answer = str(data.get("answer", "")).strip()
    if answer:
        hits.append({"title": "Summary", "snippet": answer[:800], "url": ""})

    for item in data.get("results", [])[:limit]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        snippet = str(item.get("content", "")).strip()
        url = str(item.get("url", "")).strip()
        if title or snippet:
            hits.append({"title": title or "Result", "snippet": snippet, "url": url})
    return hits


def _search_duckduckgo(query: str, limit: int) -> List[SearchHit]:
    hits: List[SearchHit] = []
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS  # type: ignore

        with DDGS() as ddgs:
            for row in ddgs.text(query, max_results=limit):
                if not isinstance(row, dict):
                    continue
                title = str(row.get("title", "")).strip()
                snippet = str(row.get("body", "")).strip()
                url = str(row.get("href", "")).strip()
                if title or snippet:
                    hits.append({"title": title or "Result", "snippet": snippet, "url": url})
    except Exception:
        return []
    return hits


def _wikipedia_summary(title: str) -> Optional[SearchHit]:
    slug = quote(title.replace(" ", "_"), safe="/")
    try:
        resp = httpx.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}",
            timeout=10.0,
            headers=_HEADERS,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        extract = str(data.get("extract", "")).strip()
        if not extract:
            return None
        return {
            "title": str(data.get("title", title)).strip(),
            "snippet": extract[:800],
            "url": str(data.get("content_urls", {}).get("desktop", {}).get("page", "")),
        }
    except Exception:
        return None


def _search_wikipedia(query: str, limit: int) -> List[SearchHit]:
    hits: List[SearchHit] = []
    try:
        search_resp = httpx.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": limit,
                "format": "json",
            },
            timeout=12.0,
            headers=_HEADERS,
        )
        search_resp.raise_for_status()
        pages = search_resp.json().get("query", {}).get("search", [])
    except Exception:
        return []

    for page in pages[:limit]:
        if not isinstance(page, dict):
            continue
        title = str(page.get("title", "")).strip()
        if not title:
            continue
        hit = _wikipedia_summary(title)
        if hit:
            hits.append(hit)
        else:
            snippet = re.sub(r"<[^>]+>", "", str(page.get("snippet", ""))).strip()
            if snippet:
                hits.append(
                    {
                        "title": title,
                        "snippet": snippet[:600],
                        "url": f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}",
                    }
                )
    return hits


def _merge_hits(existing: List[SearchHit], new: List[SearchHit], cap: int) -> List[SearchHit]:
    seen: Set[str] = set()
    merged: List[SearchHit] = []

    for hit in existing + new:
        key = (hit.get("url") or hit["title"]).lower()[:120]
        if key in seen:
            continue
        seen.add(key)
        merged.append(hit)
        if len(merged) >= cap:
            break
    return merged


def _query_terms(query: str) -> Set[str]:
    words = re.findall(r"[a-z0-9]+", query.lower())
    stop = {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "of",
        "do",
        "you",
        "know",
        "who",
        "what",
        "when",
        "where",
        "how",
        "why",
        "which",
        "current",
        "tell",
        "me",
        "about",
    }
    return {w for w in words if len(w) > 2 and w not in stop}


def _filter_stale_hits(question: str, hits: List[SearchHit]) -> List[SearchHit]:
    """When the user asks about 'current' things, drop obvious past-tense-only bios."""
    if not asks_about_current(question):
        return hits

    kept: List[SearchHit] = []
    for hit in hits:
        blob = f"{hit['title']} {hit['snippet']}".lower()
        if re.search(r"\b(current|today|is the|incumbent|as of)\b", blob):
            kept.append(hit)
            continue
        if re.search(r"\bwas the \d+", blob) and "current" not in blob:
            continue
        if "retired" in blob and "current" not in blob:
            continue
        kept.append(hit)

    return kept if kept else hits


def _score_hit(query: str, hit: SearchHit) -> int:
    blob = f"{hit['title']} {hit['snippet']}".lower()
    q_terms = _query_terms(query)
    score = sum(2 for term in q_terms if term in blob)

    if hit["title"].strip().lower() == "summary":
        score += 6
    if re.search(r"\b(is|are|was)\s+[^.]+\b", blob):
        score += 2
    if asks_about_current(query):
        if "current" in blob or "incumbent" in blob:
            score += 5
        if re.search(r"\b20(2[4-9]|3[0-9])\b", blob):
            score += 3
        if re.search(r"\bwas the \d+", blob) and "current" not in blob:
            score -= 6
    if len(hit["snippet"]) < 80:
        score -= 2
    return score


def _rank_hits(query: str, hits: List[SearchHit]) -> List[SearchHit]:
    return sorted(hits, key=lambda h: _score_hit(query, h), reverse=True)


def search_web(user_message: str) -> List[SearchHit]:
    limit = max_results()
    providers: List[Callable[[str, int], List[SearchHit]]] = [
        _search_tavily,
        _search_duckduckgo,
        _search_wikipedia,
    ]

    combined: List[SearchHit] = []
    queries = build_search_queries(user_message)

    for query in queries:
        for provider in providers:
            combined = _merge_hits(combined, provider(query, limit), limit)
            if len(combined) >= limit:
                break
        if len(combined) >= limit:
            break

    if not combined and queries:
        q = queries[0]
        combined = _merge_hits(combined, _search_wikipedia(q, limit), limit)
        combined = _merge_hits(combined, _search_duckduckgo(q, limit), limit)

    combined = _filter_stale_hits(user_message, combined)

    from current_facts import prioritize_potus_hits

    combined = prioritize_potus_hits(user_message, combined)

    return _rank_hits(user_message, combined[:limit])


def format_for_prompt(hits: List[SearchHit], query: str) -> str:
    if not hits:
        return (
            "## Live web lookup (just now — no results)\n"
            f"Question: {query}\n"
            "Say you couldn't find anything reliable right now. Do not guess."
        )

    lines = [
        "## Live web lookup (fetched seconds ago)\n",
        f"Question: {query}",
        "Answer from these sources only. Ignore earlier chat turns about facts — they may be wrong.",
        "Do not use training memory if it conflicts with these notes.",
    ]
    for i, hit in enumerate(hits, 1):
        lines.append(f"{i}. {hit['title'][:200]} — {hit['snippet'][:700]}")
    return "\n".join(lines)


def lookup_for_message(user_message: str) -> Optional[str]:
    if not should_search(user_message):
        return None
    hits = search_web(user_message.strip())
    return format_for_prompt(hits, user_message.strip())


def lookup_with_hits(user_message: str) -> tuple[Optional[str], List[SearchHit]]:
    if not should_search(user_message):
        return None, []
    hits = search_web(user_message.strip())
    return format_for_prompt(hits, user_message.strip()), hits


def has_usable_hits(hits: List[SearchHit]) -> bool:
    return bool(hits)


def status() -> dict:
    provider = "duckduckgo+wikipedia (live)"
    if os.environ.get("TAVILY_API_KEY", "").strip():
        provider = "tavily+duckduckgo+wikipedia (live)"
    return {
        "enabled": is_enabled(),
        "mode": search_mode(),
        "max_results": max_results(),
        "provider": provider,
        "grounded": True,
    }
