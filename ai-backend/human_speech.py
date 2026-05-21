"""
How real people talk — shared rules, voice trimming, and clock helpers.
"""

import re
from typing import Dict

from spoken_text import cardinal_word, normalize_for_speech, ordinal_word

BANNED_PHRASES = (
    "how can i assist",
    "how may i assist",
    "how can i help you",
    "i understand your concern",
    "i'd be happy to help",
    "i would be happy to help",
    "i'm happy to help",
    "certainly",
    "of course",
    "absolutely",
    "as an ai",
    "as a language model",
    "let me know if you need anything else",
    "is there anything else",
    "i'm here to help",
    "thank you for sharing",
    "it sounds like you're",
    "i hear that you're",
    "that must be",
    "i'm sorry you're going through",
    "please don't hesitate",
    "great question",
    "i appreciate you sharing",
    "it's important to note",
    "in conclusion",
    "as your assistant",
)

MAX_REPLY_WORDS = 25
MAX_REPLY_SENTENCES = 3

CONVERSATIONAL_STYLE_RULES = f"""## Conversational style (voice call with a friend)
- **Short:** usually 1–{MAX_REPLY_SENTENCES} sentences, under {MAX_REPLY_WORDS} spoken words.
- **Tone:** casual, warm, grounded — not formal, corporate, therapist-like, or cutesy on basic facts.
- **Factual turns:** lead with the answer; skip openers like "oh," "yeah," "hmm," "interesting," "great question."
- **Non-factual chat:** contractions and everyday words are fine; optional brief follow-up question.
- **Avoid:** long paragraphs, lists, markdown, over-explaining, ambiguous teasing, customer-support scripts."""

SPOKEN_DELIVERY_RULES = f"""## Spoken delivery (write for voice, not text)
- **Sound natural read aloud** — like you're talking on the phone, not writing an article.
- **Short sentences.** One idea per sentence. Usually stop after {MAX_REPLY_SENTENCES} sentences.
- **Light punctuation.** Prefer periods. Use commas and semicolons sparingly — they sound choppy in TTS.
- **No parentheses or brackets** — no asides; say the point in a plain short sentence instead.
- **No long clauses.** Avoid chaining with "and," "but," or "which." One breath per sentence.
- **No markdown** — no bullets, asterisks, headers, links, or code formatting.
- **Concise** — under {MAX_REPLY_WORDS} words most of the time, then stop."""

_TIME_RULE_LINE = (
    "- Time: hour and minute only unless they asked for the day or year. "
    "Year: real calendar year from Right now. No PDT/PST out loud."
)


def build_human_speech_rules(*, include_time_rules: bool = True) -> str:
    rules = f"""{CONVERSATIONAL_STYLE_RULES}

{SPOKEN_DELIVERY_RULES}

## Every reply
- **Factual question:** answer only — correct, direct, no reaction filler first.
- **Other chat:** short answer; optional one brief follow-up — still under the word limit.
- No explanations, lists, paragraphs, or over-helpfulness.
- Never: "How can I assist," "I'd be happy to help," "I understand your concern," or similar."""
    if include_time_rules:
        rules = f"{rules}\n{_TIME_RULE_LINE}"
    return rules


HUMAN_SPEECH_RULES = build_human_speech_rules(include_time_rules=True)

MAX_VOICE_WORDS = MAX_REPLY_WORDS
MAX_VOICE_SENTENCES = MAX_REPLY_SENTENCES

_BANNED_RE = re.compile(
    "|".join(re.escape(p) for p in BANNED_PHRASES),
    re.I,
)


def spoken_hour_minute(hour_24: int, minute: int) -> str:
    hour_12 = hour_24 % 12 or 12
    h = cardinal_word(hour_12)

    if minute == 0:
        return h
    if minute == 15:
        return f"quarter past {h}"
    if minute == 30:
        return f"half past {h}"
    if minute == 45:
        next_hour = (hour_12 % 12) + 1
        if next_hour > 12:
            next_hour = 1
        return f"quarter to {cardinal_word(next_hour)}"
    if minute < 10:
        return f"{h} oh {cardinal_word(minute)}"
    return f"{h} {cardinal_word(minute)}"


def short_time_reply(parts: Dict[str, str], hour_24: int, minute: int) -> str:
    spoken = spoken_hour_minute(hour_24, minute)
    opener = ("Yeah,", "It's", "Right now it's")[minute % 3]
    if minute == 0 and hour_24 in (0, 12):
        return "Midnight." if hour_24 == 0 else "Noon."
    return f"{opener} {spoken}."


def short_day_reply(parts: Dict[str, str]) -> str:
    """Plain words for TTS — e.g. 'Wednesday. The ninth.'"""
    day_num = int(parts["day"])
    return f"{parts['weekday']}. The {ordinal_word(day_num)}."


def short_date_reply(parts: Dict[str, str]) -> str:
    return f"{parts['month']} {parts['day']}."


def spoken_year(year: int) -> str:
    """Say calendar year naturally for TTS (e.g. 2026 → twenty twenty-six)."""
    if 2000 <= year <= 2099:
        last_two = year % 100
        if last_two == 0:
            return "two thousand"
        if last_two < 10:
            return f"twenty oh {cardinal_word(last_two)}"
        return f"twenty {cardinal_word(last_two)}"
    if 1900 <= year <= 1999:
        last_two = year % 100
        if last_two == 0:
            return "nineteen hundred"
        if last_two < 10:
            return f"nineteen oh {cardinal_word(last_two)}"
        return f"nineteen {cardinal_word(last_two)}"
    return str(year)


def short_year_reply(parts: Dict[str, str]) -> str:
    year = int(parts["year"])
    spoken = spoken_year(year)
    opener = ("Yeah,", "It's", "We're in")[year % 3]
    return f"{opener} {spoken}."


def trim_for_voice(text: str) -> str:
    cleaned = text.strip()
    if not cleaned:
        return cleaned

    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    sentences = [s.strip() for s in sentences if s.strip()]
    if len(sentences) > MAX_VOICE_SENTENCES:
        cleaned = " ".join(sentences[:MAX_VOICE_SENTENCES])
        if not re.search(r"[.!?]$", cleaned):
            cleaned += "."

    words = cleaned.split()
    if len(words) > MAX_VOICE_WORDS:
        cleaned = " ".join(words[:MAX_VOICE_WORDS]).rstrip(",;:")
        if not re.search(r"[.!?]$", cleaned):
            cleaned += "."

    return cleaned


def _strip_assistant_tone(text: str) -> str:
    """Remove common robotic / helper / therapist phrases."""
    cleaned = _BANNED_RE.sub("", text)
    cleaned = re.sub(
        r"\b(certainly|absolutely|of course)[,.]?\s*",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _strip_markdown(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"```[\s\S]*?```", " ", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"^\s*[-*#>]+\s*", "", cleaned, flags=re.M)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def polish_for_speech(text: str) -> str:
    cleaned = trim_for_voice(_strip_assistant_tone(_strip_markdown(text.strip())))
    cleaned = re.sub(r"…+", ".", cleaned)
    cleaned = re.sub(r"\.{2,}", ".", cleaned)
    cleaned = re.sub(r"!{2,}", "!", cleaned)
    cleaned = re.sub(r"\?{2,}", "?", cleaned)
    cleaned = re.sub(
        r",?\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+"
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+"
        r"\d{1,2},?\s+\d{4},?\s*",
        " ",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(
        r"\s+\d{1,2}:\d{2}\s*(AM|PM)\s+(PDT|PST|EST|EDT|CST|MDT|UTC)\b",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = normalize_for_speech(cleaned)
    return cleaned or text.strip()
