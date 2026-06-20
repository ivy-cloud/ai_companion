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

# Expand what's / how's so "what's the weather" counts as a factual question.
_CONTRACTION_START = re.compile(
    r"^(what|who|where|when|how)'s\b",
    re.I,
)

_WH_START = re.compile(
    r"^(?:who|what|when|where|which|why)\b",
    re.I,
)

_HOW_FACTUAL = re.compile(
    r"^how (?:many|much|old|long|far|tall|big|often|is|are|will|was|were)\b",
    re.I,
)

# Topics that should always trigger a live web search when mentioned.
_WORLD_FACT = re.compile(
    r"\b(?:weather|forecast|temperature|rain|snow|humidity|wind chill|"
    r"headline|headlines|stock price|stock market|score|game score|"
    r"election|population|ceo|president|prime minister)\b",
    re.I,
)

_WEATHER = re.compile(r"\b(?:weather|forecast|temperature|rain|snow|humidity)\b", re.I)

# Feedback about the companion / app — not world facts; skip slow web lookup.
_COMPANION_OR_APP = re.compile(
    r"\b(?:"
    r"something(?:'s| is) wrong|why (?:do )?you|you(?:'re| are) (?:stuck|wrong|broken)|"
    r"stuck (?:on|in|at|with)|stutter(?:ing)?|glitch(?:y|es)?|"
    r"(?:voice|audio) (?:is )?(?:low|quiet|bad)|too quiet|"
    r"don't recall|can't remember|won't remember|forget(?:ting)?|"
    r"pause(?:s|d)? between|gap between|suck(?:s|ing)? (?:in|on|at)|"
    r"bug(?:gy)?|broken|not working|doesn't work|"
    r"(?:you )?(?:can|could) speak|speak(?:ing)? more|sound(?:s|ed)? (?:better|different|weird|off)|"
    r"(?:more )?(?:fluent(?:ly)?|clear(?:ly)?|natural(?:ly)?|human)\b"
    r")\b",
    re.I,
)

# Confusion / pushback about what the companion just said — not a world-fact lookup.
_CONVERSATIONAL_CONFUSION = re.compile(
    r"(?:"
    r"^what(?:'s| is| are) (?:that|this|it|going on)\??\s*$|"
    r"^what(?:'s| is| are) (?:that|this|it) (?:about|mean)\??\s*$|"
    r"^what (?:are|were) you (?:talking|going on) about\??\s*$|"
    r"^what do you mean(?: by that)?\??\s*$|"
    r"^what did you (?:mean|say|just say)\??\s*$|"
    r"^what does that mean\??\s*$|"
    r"^what was that\??\s*$|"
    r"^say that again\??\s*$|"
    r"^what are you saying\??\s*$|"
    r"^why would you say (?:that|this)\??\s*$|"
    r"^huh\??\s*$|"
    r"^come again\??\s*$|"
    r"^sorry,? what\??\s*$|"
    r"^what\??\s*$"
    r")",
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
    raw = os.environ.get("WEB_SEARCH_MODE", "smart").strip().lower()
    return raw if raw else "smart"


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


def _normalize_question_stem(message: str) -> str:
    """Lowercase stem with common contractions expanded for classification."""
    lower = message.strip().lower().rstrip("?").strip()
    return _CONTRACTION_START.sub(r"\1 is", lower)


def is_weather_question(message: str) -> bool:
    return bool(_WEATHER.search(message))


def is_factual_question(message: str) -> bool:
    """Generic: user wants a verifiable fact, not casual chat."""
    import profile
    from companion import is_companion_identity_turn
    from context import is_time_question

    text = message.strip()
    lower = _normalize_question_stem(text)
    if profile.is_user_profile_turn(text):
        return False
    if is_companion_identity_turn(text):
        return False
    if is_simple_math_question(text):
        return False
    if is_time_question(text):
        return False
    if _COMPANION_OR_APP.search(lower):
        return False
    if is_conversational_confusion(text):
        return False
    if re.match(
        r"^how (?:are you|you doing|is it going|have you been|was your|did your)\b",
        lower,
    ):
        return False
    if _WORLD_FACT.search(lower):
        return True
    if _WH_START.match(lower) or _HOW_FACTUAL.match(lower):
        return True
    return False


def asks_about_current(message: str) -> bool:
    lower = message.lower()
    return bool(
        re.search(
            r"\b(?:"
            r"current|today|tonight|tomorrow|latest|"
            r"this year|this morning|this afternoon|this evening|at the moment|"
            r"right now|as of now|what now|for now|from now|until now"
            r")\b",
            lower,
        )
    )


_EXPLICIT_WEB = re.compile(
    r"\b(?:"
    r"look(?:\s+it)?\s+up|search(?:\s+(?:for|online|the web))?|"
    r"google|check online|find online|on the internet"
    r")\b",
    re.I,
)

_LIVE_DATA = re.compile(
    r"\b(?:"
    r"current|today'?s?|tonight'?s?|latest|live|right now|as of now|"
    r"this (?:morning|afternoon|evening|week|weekend)"
    r")\b",
    re.I,
)


def is_conversational_confusion(message: str) -> bool:
    lower = message.strip().lower().rstrip("?").strip()
    return bool(_CONVERSATIONAL_CONFUSION.match(lower))


def needs_live_web_lookup(message: str) -> bool:
    """
    Clear signals that only the open web can answer — not chat history alone.
    """
    text = message.strip()
    lower = _normalize_question_stem(text)
    if _EXPLICIT_WEB.search(lower):
        return True
    if _WORLD_FACT.search(lower):
        return True
    if is_weather_question(text):
        return True
    if _LIVE_DATA.search(lower) and (
        _WORLD_FACT.search(lower)
        or re.search(r"\b(?:news|headline|score|price|who is|who's|who won)\b", lower)
    ):
        return True
    return False


def should_search(message: str) -> bool:
    if not is_enabled():
        return False

    import memory
    from companion import is_companion_identity_turn
    from context import is_time_question

    text = message.strip()
    if (
        len(text) < 4
        or is_time_question(text)
        or is_simple_math_question(text)
        or is_companion_identity_turn(text)
    ):
        return False

    lower = text.lower().rstrip("?").strip()
    if lower in _GREETINGS:
        return False
    if is_conversational_confusion(text):
        return False
    if _COMPANION_OR_APP.search(lower):
        return False
    if memory.should_answer_from_chat_first(text):
        return False

    mode = search_mode()
    if mode in ("off", "false", "0", "disabled", "none"):
        return False
    if mode == "always":
        return needs_live_web_lookup(text) or is_factual_question(text)
    if mode == "questions":
        return is_factual_question(text) and needs_live_web_lookup(text)
    # smart (default): live-web signals only
    return needs_live_web_lookup(text)


def rewrite_for_search(message: str) -> str:
    """Strip conversational filler so search engines get a clean query."""
    text = message.strip().rstrip("?").strip()
    text = _FILLER_PREFIX.sub("", text).strip()
    return text or message.strip()


def _location_hint_from_context(clock=None) -> str:
    """Saved city/region, else a coarse place name from the device timezone."""
    import profile

    loc = profile.get_facts().get("location", "").strip()
    if loc:
        return loc
    if clock is not None and getattr(clock, "iana", ""):
        iana = str(clock.iana).strip()
        if "/" in iana:
            return iana.split("/")[-1].replace("_", " ")
    return ""


def build_search_queries(
    user_message: str,
    *,
    location_hint: str = "",
    conversation_context: Optional[str] = None,
) -> List[str]:
    """Build live search queries (keywords only — never stored answers)."""
    original = user_message.strip()
    core = rewrite_for_search(original)
    year = _current_year()
    queries = [core, original]
    place = location_hint.strip()

    if conversation_context:
        context = conversation_context.strip()
        if context:
            queries.insert(0, f"{core} {context[:140]}")
            queries.insert(1, f"{context[:100]} {core}")

    if is_weather_question(original):
        if place:
            queries.insert(0, f"weather forecast tonight {place}")
            queries.insert(1, f"{core} {place}")
        else:
            queries.insert(0, f"{core} weather forecast")

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


def search_web(
    user_message: str,
    *,
    location_hint: str = "",
    conversation_context: Optional[str] = None,
) -> List[SearchHit]:
    limit = max_results()
    providers: List[Callable[[str, int], List[SearchHit]]] = [
        _search_tavily,
        _search_duckduckgo,
        _search_wikipedia,
    ]

    combined: List[SearchHit] = []
    queries = build_search_queries(
        user_message,
        location_hint=location_hint,
        conversation_context=conversation_context,
    )

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


def format_for_prompt(
    hits: List[SearchHit],
    query: str,
    *,
    contextual_follow_up: bool = False,
) -> str:
    if not hits:
        extra = ""
        if is_weather_question(query):
            extra = (
                " For weather, say you couldn't get a forecast online right now — "
                "suggest they name their city if they haven't, or check a weather app. "
            )
        return (
            "## Live web search (just now — no usable results)\n"
            f"Question: {query}\n"
            f"{extra}"
            "Answer in one or two short spoken sentences. Do not guess facts. "
            "Never say lookup, search results, or context."
        )

    if contextual_follow_up:
        history_line = (
            "Answer from recent chat first if it already covers this — "
            "only then use these notes. Do NOT read snippets aloud."
        )
    else:
        history_line = (
            "Internal notes from a quick check — digest into your own words; "
            "never quote titles, numbers, or list sources."
        )

    lines = [
        "## Fact check (internal — synthesize, do not recite)\n",
        f"Question: {query}",
        history_line,
        "Say it like you already know it — friend on the phone, not a newsreader.",
    ]
    for i, hit in enumerate(hits, 1):
        lines.append(f"{i}. {hit['title'][:200]} — {hit['snippet'][:700]}")
    return "\n".join(lines)


def lookup_for_message(
    user_message: str,
    *,
    clock=None,
    chat_topic: str = "",
) -> Optional[str]:
    if not should_search(user_message):
        return None
    hint = _location_hint_from_context(clock)
    topic = chat_topic.strip()
    hits = search_web(
        user_message.strip(),
        location_hint=hint,
        conversation_context=topic or None,
    )
    return format_for_prompt(
        hits,
        user_message.strip(),
        contextual_follow_up=bool(topic),
    )


def lookup_with_hits(
    user_message: str,
    *,
    clock=None,
    chat_topic: Optional[str] = None,
) -> tuple[Optional[str], List[SearchHit]]:
    if not should_search(user_message):
        return None, []
    hint = _location_hint_from_context(clock)
    topic = (chat_topic or "").strip()
    hits = search_web(
        user_message.strip(),
        location_hint=hint,
        conversation_context=topic or None,
    )
    return (
        format_for_prompt(
            hits,
            user_message.strip(),
            contextual_follow_up=bool(topic),
        ),
        hits,
    )


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
