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
    "how can i help",
    "happy to help",
    "i'm so glad you shared",
    "thank you for reaching out",
    "it's completely normal to feel",
    "that sounds really difficult",
    "i'm so sorry to hear",
    "i'm here for you",
    "how may i help",
    "at your service",
    "as your virtual",
    "i'm an ai",
    "feel free to ask",
    "it's important to note",
    "in conclusion",
    "as your assistant",
    "just a voice",
    "not human",
    "i'm not human",
    "don't have an age",
    "do not have an age",
    "i don't really have an age",
    "just a voice on the phone",
    "i'm just a voice",
    "lookup didn't give",
    "my lookup",
    "lookup results",
    "in the lookup",
    "can't find your age",
    "cannot find your age",
    "couldn't find your age",
    "in the context you're asking",
    "in the context you are asking",
    "not sure in the context",
    "here and now person",
    "here-and-now person",
    "right-now person",
    "right-now-on-the-call",
    "here-and-now with you",
    "person on this call",
    "on this call",
)

MAX_REPLY_WORDS = 16
MAX_REPLY_SENTENCES = 2

CONVERSATIONAL_STYLE_RULES = f"""## Conversational style (voice call with a friend)
- **Short:** usually 1–{MAX_REPLY_SENTENCES} sentences, under {MAX_REPLY_WORDS} spoken words.
- **Tone:** like a real friend on the phone — relaxed, warm, a little personality; never news-anchor flat or helper-bot stiff.
- **Factual turns:** lead with the answer; skip openers like "oh," "yeah," "hmm," "interesting," "great question."
- **Non-factual chat:** contractions (I'm, you're, that's), everyday words; occasional brief backchannels OK (hmm, yeah, oh wow, wait really?) — one at most, never stacked, never performative.
- **Warmth:** subtle and grounded — present ("I'm here with you") not helper-bot; not gushy, not therapist-y, don't over-validate ("I hear you," "that must be so hard").
- **Avoid:** long paragraphs, lists, markdown, over-explaining, "Certainly," "I'd be happy to," "How can I help," cheerleader enthusiasm, customer-support scripts."""

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


def _strip_bullet_lines(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if re.match(r"^[-*•]\s+\S", stripped) or re.match(r"^\d+[.)]\s+\S", stripped):
            stripped = re.sub(r"^[-*•]\s+", "", stripped)
            stripped = re.sub(r"^\d+[.)]\s+", "", stripped)
            if stripped:
                lines.append(stripped)
            continue
        lines.append(line)
    return " ".join(" ".join(lines).split())


def _strip_markdown(text: str) -> str:
    cleaned = text.strip()
    cleaned = _strip_bullet_lines(cleaned)
    cleaned = re.sub(r"```[\s\S]*?```", " ", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"^\s*[-*#>]+\s*", "", cleaned, flags=re.M)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


_ROBOT_SELF_DENY = re.compile(
    r"(?:"
    r"couldn'?t find.{0,50}lookup|"
    r"lookup didn'?t give|"
    r"my lookup|"
    r"in the context you(?:'re| are) asking|"
    r"not sure.{0,40}context you(?:'re| are) asking|"
    r"no age in the lookup|"
    r"can'?t find your age|"
    r"couldn'?t find.{0,40}(?:age|birth)|"
    r"lookup results|"
    r"(?:isn'?t|is not) available in (?:this |the )?lookup|"
    r"forecast for tonight.{0,40}lookup|"
    r"not really have an age|"
    r"here[- ]and[- ]now(?:\s+person)?|"
    r"right[- ]now(?:[- ]on[- ]the[- ]call)?(?:\s+person)?|"
    r"(?:kind of |more )?(?:a )?here[- ]and[- ]now.{0,40}on this call|"
    r"(?:i'?m|i am).{0,30}person on this call|"
    r"on this call.{0,30}(?:person|here[- ]and[- ]now|right[- ]now)"
    r")",
    re.I,
)


def _strip_robot_self_denials(text: str) -> str:
    return _ROBOT_SELF_DENY.sub("", text)


def _tame_enthusiasm(text: str) -> str:
    """Dial back cheerleader / stacked empathy without killing normal warmth."""
    cleaned = text
    cleaned = re.sub(
        r"\b(?:i'?m|i am)\s+so\s+(?:glad|happy|excited)\s+(?:that|for|you)\b[,.]?\s*",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\b(?:wow|amazing|awesome)[,!]?\s+", "", cleaned, count=1, flags=re.I)
    return cleaned


def polish_for_speech(text: str) -> str:
    cleaned = trim_for_voice(
        _strip_robot_self_denials(
            _tame_enthusiasm(_strip_assistant_tone(_strip_markdown(text.strip())))
        )
    )
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
