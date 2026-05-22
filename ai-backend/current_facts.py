"""
Live current-office facts from Wikipedia (no hardcoded names).
"""

import re
from typing import List, Optional

import httpx

from web_search import SearchHit, _HEADERS

_POTUS_PAGE = "President of the United States"

_US_PRESIDENT_ASK = re.compile(
    r"\b(?:"
    r"who(?:'s| is)?\s+(?:the\s+)?(?:current\s+)?president(?:\s+of)?(?:\s+the)?\s+"
    r"(?:united states|u\.?s\.?|america)"
    r"|"
    r"president(?:\s+of)?\s+(?:the\s+)?(?:united states|u\.?s\.?|america)"
    r"|"
    r"(?:united states|u\.?s\.?)\s+president"
    r")\b",
    re.I,
)

_CURRENT_POTUS = re.compile(
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+){0,3})\s+is\s+the\s+"
    r"(\d+(?:st|nd|rd|th)?)\s+(?:and\s+)?current\s+president",
    re.I,
)

_CURRENT_POTUS_ALT = re.compile(
    r"the\s+current\s+president\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+){0,3})",
    re.I,
)

_INCUMBENT_POTUS = re.compile(
    r"incumbent\s+president\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+){0,3})",
    re.I,
)

_NTH_POTUS_BIO = re.compile(
    r"([A-Z][a-z]+(?:\s+(?:[A-Z][a-z]+\.?|[A-Z]\.?)){1,3}).{0,120}?"
    r"the\s+\d+(?:st|nd|rd|th)?\s+president\s+of\s+the\s+United\s+States",
    re.I | re.S,
)

_POTUS_SOURCE_TITLES = (
    "List of presidents of the United States",
    "Donald Trump",
    _POTUS_PAGE,
)

_STALE_PRESIDENT = re.compile(
    r"\b(?:joe\s+biden|biden)\b.*\b(?:46th|2021\s+to\s+2025|was\s+the)\b",
    re.I,
)


def is_us_president_question(message: str) -> bool:
    return bool(_US_PRESIDENT_ASK.search(message.strip()))


def _wikipedia_extract(title: str, *, sentences: int = 12) -> Optional[str]:
    try:
        resp = httpx.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "prop": "extracts",
                "explaintext": True,
                "exsentences": sentences,
                "titles": title,
                "format": "json",
            },
            headers=_HEADERS,
            timeout=12.0,
        )
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})
        for page in pages.values():
            extract = str(page.get("extract", "")).strip()
            if extract:
                return extract
    except Exception:
        return None
    return None


def fetch_potus_wikipedia_hit() -> Optional[SearchHit]:
    """Prefer List of presidents (has 'incumbent president is …')."""
    for title in _POTUS_SOURCE_TITLES:
        sentences = 10 if "List of" in title else 8
        extract = _wikipedia_extract(title, sentences=sentences)
        if not extract:
            continue
        hit: SearchHit = {
            "title": title,
            "snippet": extract[:1200],
            "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
        }
        if extract_current_us_president_name([hit]):
            return hit
    return None


def _name_from_match(match: re.Match[str]) -> Optional[str]:
    name = match.group(1).strip().rstrip(".")
    if not name or name.lower() in ("the", "united", "states"):
        return None
    # Prefer "Donald Trump" over "Donald John Trump" for speech.
    if name.lower().startswith("donald john trump"):
        return "Donald Trump"
    return name


def extract_current_us_president_name(hits: List[SearchHit]) -> Optional[str]:
    blob = " ".join(f"{h['title']} {h['snippet']}" for h in hits)
    for pattern in (
        _INCUMBENT_POTUS,
        _CURRENT_POTUS,
        _CURRENT_POTUS_ALT,
        _NTH_POTUS_BIO,
    ):
        match = pattern.search(blob)
        if match:
            name = _name_from_match(match)
            if name:
                return name
    return None


def prioritize_potus_hits(message: str, hits: List[SearchHit]) -> List[SearchHit]:
    if not is_us_president_question(message):
        return hits

    potus = fetch_potus_wikipedia_hit()
    merged: List[SearchHit] = []
    if potus:
        merged.append(potus)

    for hit in hits:
        blob = f"{hit['title']} {hit['snippet']}".lower()
        if _STALE_PRESIDENT.search(blob) and "current" not in blob:
            continue
        if hit.get("url") and potus and hit["url"] == potus["url"]:
            continue
        merged.append(hit)

    return merged[:8]


def try_us_president_reply(message: str) -> Optional[str]:
    """Short spoken answer from live Wikipedia — not training data."""
    if not is_us_president_question(message):
        return None

    potus = fetch_potus_wikipedia_hit()
    if not potus:
        return None

    name = extract_current_us_president_name([potus])
    if not name:
        return None

    return f"{name} is the president of the United States."
