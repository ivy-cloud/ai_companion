"""
Normalize text for natural Azure TTS — words and phrases, not spelled-out fragments.
"""

import re
import unicodedata

_THE_ORDINAL = re.compile(r"\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b", re.I)
_SPACED_ORDINAL = re.compile(r"(\d+)\s+(st|nd|rd|th)\b", re.I)
_BARE_ORDINAL = re.compile(r"\b(\d{1,2})(st|nd|rd|th)\b", re.I)
_ORPHAN_SUFFIX = re.compile(r"(?<!\d)\b(st|nd|rd|th)\b", re.I)
_LETTER_FRAGMENT = re.compile(
    r"\b([stnrl])\s+([hdts])\b",
    re.I,
)
_TIME_24H = re.compile(r"\b(\d{1,2}):(\d{2})\b")
_YEAR = re.compile(r"\b((?:19|20)\d{2})\b")
_DIGIT_TO_WORD = re.compile(r"\b(\d{1,2})(?!'s\b)")
# e.g. 2+2, 2 + 2 = 4 — must run before symbol strip (which removes + and =).
_MATH_EXPR = re.compile(
    r"\b(\d{1,2})\s*([+\-*/×÷])\s*(\d{1,2})(?:\s*=\s*(\d{1,2}))?\b"
)

_OP_WORDS: dict[str, str] = {
    "+": "plus",
    "-": "minus",
    "*": "times",
    "×": "times",
    "/": "divided by",
    "÷": "divided by",
}

_ORDINAL_WORDS: dict[int, str] = {
    1: "first",
    2: "second",
    3: "third",
    4: "fourth",
    5: "fifth",
    6: "sixth",
    7: "seventh",
    8: "eighth",
    9: "ninth",
    10: "tenth",
    11: "eleventh",
    12: "twelfth",
    13: "thirteenth",
    14: "fourteenth",
    15: "fifteenth",
    16: "sixteenth",
    17: "seventeenth",
    18: "eighteenth",
    19: "nineteenth",
    20: "twentieth",
    21: "twenty-first",
    22: "twenty-second",
    23: "twenty-third",
    24: "twenty-fourth",
    25: "twenty-fifth",
    26: "twenty-sixth",
    27: "twenty-seventh",
    28: "twenty-eighth",
    29: "twenty-ninth",
    30: "thirtieth",
    31: "thirty-first",
}

_CARDINAL_WORDS: dict[int, str] = {
    0: "zero",
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
    11: "eleven",
    12: "twelve",
    13: "thirteen",
    14: "fourteen",
    15: "fifteen",
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
    20: "twenty",
    21: "twenty-one",
    22: "twenty-two",
    23: "twenty-three",
    24: "twenty-four",
    25: "twenty-five",
    26: "twenty-six",
    27: "twenty-seven",
    28: "twenty-eight",
    29: "twenty-nine",
    30: "thirty",
    31: "thirty-one",
    32: "thirty-two",
    40: "forty",
    50: "fifty",
    60: "sixty",
    70: "seventy",
    80: "eighty",
    90: "ninety",
}

# Casual reactions / shorts — say as words, not spelled letters.
_PHRASE_MAP: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bok\b", re.I), "okay"),
    (re.compile(r"\byeah\b", re.I), "yeah"),
    (re.compile(r"\byep\b", re.I), "yep"),
    (re.compile(r"\bnope\b", re.I), "nope"),
    (re.compile(r"\bhmm+\b", re.I), "hmm"),
    (re.compile(r"\buh+\b", re.I), "uh"),
    (re.compile(r"\bum+\b", re.I), "um"),
    (re.compile(r"\bha+\b", re.I), "ha"),
    (re.compile(r"\boh+\b", re.I), "oh"),
    (re.compile(r"\baw+\b", re.I), "aw"),
    (re.compile(r"\bvs\.?\b", re.I), "versus"),
    (re.compile(r"\betc\.?\b", re.I), "et cetera"),
    (re.compile(r"\bPDT\b"), ""),
    (re.compile(r"\bPST\b"), ""),
    (re.compile(r"\bEST\b"), ""),
    (re.compile(r"\bEDT\b"), ""),
    (re.compile(r"\bCST\b"), ""),
    (re.compile(r"\bMDT\b"), ""),
    (re.compile(r"\bUTC\b"), ""),
    (re.compile(r"\bAM\b", re.I), ""),
    (re.compile(r"\bPM\b", re.I), ""),
)


def _ordinal_to_word(day: int) -> str:
    if day in _ORDINAL_WORDS:
        return _ORDINAL_WORDS[day]
    if 11 <= day % 100 <= 13:
        return f"{day}th"
    suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def spoken_year(year: int) -> str:
    """Calendar year for TTS (e.g. 1998 → nineteen ninety-eight)."""
    if 2000 <= year <= 2099:
        last_two = year % 100
        if last_two == 0:
            return "two thousand"
        if last_two < 10:
            return f"twenty oh-{_cardinal_word(last_two)}"
        return f"twenty {_cardinal_word(last_two)}"
    if 1900 <= year <= 1999:
        last_two = year % 100
        if last_two == 0:
            return "nineteen hundred"
        if last_two < 10:
            return f"nineteen oh-{_cardinal_word(last_two)}"
        return f"nineteen {_cardinal_word(last_two)}"
    return str(year)


def _cardinal_word(n: int) -> str:
    if n in _CARDINAL_WORDS:
        return _CARDINAL_WORDS[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        if tens == 0:
            return _cardinal_word(ones)
        tens_words = {
            2: "twenty",
            3: "thirty",
            4: "forty",
            5: "fifty",
            6: "sixty",
            7: "seventy",
            8: "eighty",
            9: "ninety",
        }
        tens_word = tens_words.get(tens, str(tens * 10))
        if ones == 0:
            return tens_word
        return f"{tens_word} {_cardinal_word(ones)}"
    return str(n)


def _time_to_words(match: re.Match[str]) -> str:
    hour = int(match.group(1))
    minute = int(match.group(2))
    hour_12 = hour % 12 or 12
    h = _cardinal_word(hour_12)
    if minute == 0:
        return h
    if minute < 10:
        return f"{h} oh {_cardinal_word(minute)}"
    if minute == 15:
        return f"quarter past {h}"
    if minute == 30:
        return f"half past {h}"
    if minute == 45:
        next_h = _cardinal_word(hour_12 % 12 + 1 if hour_12 < 12 else 12)
        return f"quarter to {next_h}"
    return f"{h} {_cardinal_word(minute)}"


def _normalize_ordinals(text: str) -> str:
    cleaned = _SPACED_ORDINAL.sub(r"\1\2", text)
    cleaned = _THE_ORDINAL.sub(
        lambda m: f"the {_cardinal_word(int(m.group(1)))}s",
        cleaned,
    )
    cleaned = _BARE_ORDINAL.sub(lambda m: _ordinal_to_word(int(m.group(1))), cleaned)
    cleaned = _ORPHAN_SUFFIX.sub("", cleaned)
    return cleaned


def _verbalize_math(match: re.Match[str]) -> str:
    left = _cardinal_word(int(match.group(1)))
    op = _OP_WORDS.get(match.group(2), match.group(2))
    right = _cardinal_word(int(match.group(3)))
    if match.group(4) is not None:
        result = _cardinal_word(int(match.group(4)))
        return f"{left} {op} {right} is {result}"
    return f"{left} {op} {right}"


def _verbalize_math_expressions(text: str) -> str:
    return _MATH_EXPR.sub(_verbalize_math, text)


def _normalize_fragments(text: str) -> str:
    """Fix letter-by-letter debris (e.g. 't h' left after bad number handling)."""
    cleaned = _LETTER_FRAGMENT.sub(lambda m: m.group(1) + m.group(2), text)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _normalize_numbers(text: str) -> str:
    cleaned = _TIME_24H.sub(_time_to_words, text)
    cleaned = _YEAR.sub(lambda m: spoken_year(int(m.group(1))), cleaned)
    cleaned = _DIGIT_TO_WORD.sub(lambda m: _cardinal_word(int(m.group(1))), cleaned)
    return cleaned


def _apply_phrase_map(text: str) -> str:
    cleaned = text
    for pattern, replacement in _PHRASE_MAP:
        cleaned = pattern.sub(replacement, cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def ordinal_word(day: int) -> str:
    return _ordinal_to_word(day)


def cardinal_word(n: int) -> str:
    """Spoken form for clock minutes, counts, etc."""
    return _cardinal_word(n)


def normalize_for_speech(text: str) -> str:
    """
    Full pipeline: symbols → ordinals → times → small numbers as words → casual phrases.
    Output is plain English suitable for neural TTS without spelling fragments.
    """
    cleaned = unicodedata.normalize("NFKC", text or "")
    cleaned = _verbalize_math_expressions(cleaned)
    cleaned = re.sub(r"[@#$%^&*+=|\\<>~`[\]{}©®™°§¶•·/]", "", cleaned)
    cleaned = re.sub(r"[—–]", " ", cleaned)
    cleaned = re.sub(r"…+", ".", cleaned)
    cleaned = re.sub(r"\.{2,}", ".", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    cleaned = _normalize_ordinals(cleaned)
    cleaned = _normalize_fragments(cleaned)
    cleaned = _normalize_numbers(cleaned)
    cleaned = _apply_phrase_map(cleaned)
    cleaned = _normalize_fragments(cleaned)

    return re.sub(r"\s+", " ", cleaned).strip()
