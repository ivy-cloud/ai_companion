"""
Voice + text creative/helper task detection and LLM turn hints.

Routes casual asks (songs, poems, jokes, study help, etc.) without canned shortcuts.
"""

from __future__ import annotations

import re
from typing import Literal, Optional

import singing

TaskType = Literal[
    "song",
    "rap",
    "poem",
    "short_story",
    "joke",
    "translate",
    "summarize",
    "explain",
    "quiz_me",
    "brainstorm",
    "write_message",
]

_TASK_PATTERNS: list[tuple[TaskType, re.Pattern[str]]] = [
    (
        "quiz_me",
        re.compile(
            r"\b(?:"
            r"quiz me|test me on|flashcards?|pop quiz|"
            r"ask me (?:some )?questions about"
            r")\b",
            re.I,
        ),
    ),
    (
        "translate",
        re.compile(
            r"\b(?:"
            r"translate (?:this|that|it|to|into)|"
            r"how (?:do you|to) say .+ in |"
            r"what(?:'s| is) .+ in (?:spanish|french|german|japanese|chinese|korean|italian)"
            r")\b",
            re.I,
        ),
    ),
    (
        "summarize",
        re.compile(
            r"\b(?:"
            r"summarize|summary of|tl;?dr|too long(?:,)? (?:didn't|did not) read|"
            r"give me the gist|main points of"
            r")\b",
            re.I,
        ),
    ),
    (
        "write_message",
        re.compile(
            r"\b(?:"
            r"write (?:me )?(?:a )?(?:text|message|email|dm|reply|caption)|"
            r"help me (?:text|message|reply|respond to)|"
            r"draft (?:a )?(?:text|message|email|reply)"
            r")\b",
            re.I,
        ),
    ),
    (
        "brainstorm",
        re.compile(
            r"\b(?:"
            r"brainstorm|ideas for|help me think of|what should i (?:name|call)|"
            r"come up with (?:some )?ideas"
            r")\b",
            re.I,
        ),
    ),
    (
        "short_story",
        re.compile(
            r"\b(?:"
            r"short story|tell me a story|story about|write (?:me )?(?:a )?story|"
            r"fiction about|once upon a time"
            r")\b",
            re.I,
        ),
    ),
    (
        "poem",
        re.compile(
            r"\b(?:"
            r"poem|poetry|haiku|sonnet|limerick|verse about|write (?:me )?(?:a )?poem"
            r")\b",
            re.I,
        ),
    ),
    (
        "joke",
        re.compile(
            r"\b(?:"
            r"tell me a joke|make me laugh|something funny|dad joke|"
            r"got a joke|joke about"
            r")\b",
            re.I,
        ),
    ),
    (
        "explain",
        re.compile(
            r"\b(?:"
            r"explain (?:this|that|it|how|why|what)|"
            r"help me understand|walk me through|break (?:it|this) down|"
            r"what does .+ mean|how does .+ work"
            r")\b",
            re.I,
        ),
    ),
    (
        "rap",
        re.compile(
            r"\b(?:"
            r"rap (?:verse|about|for)|freestyle about|drop a (?:quick )?rap|"
            r"spit (?:some )?bars"
            r")\b",
            re.I,
        ),
    ),
    (
        "song",
        re.compile(
            r"\b(?:"
            r"sing|song|lullaby|serenade|hum(?:ming)?|melody|chorus|hook"
            r")\b",
            re.I,
        ),
    ),
]

_TASK_HINTS: dict[TaskType, str] = {
    "song": "",  # filled by singing.singing_llm_turn_hint when personalized
    "rap": (
        "Rap/freestyle: short original bars — rhythmic, conversational, no copyrighted lyrics; "
        "line breaks OK in chat; speak with bounce."
    ),
    "poem": (
        "Poem: brief original verse — vivid image or feeling; line breaks OK for chat display; "
        "read aloud with natural pauses between lines."
    ),
    "short_story": (
        "Short story: tiny scene or vignette — one beat, under ~80 spoken words; "
        "hook then punch or warmth; no chapter headings."
    ),
    "joke": (
        "Joke: one clean setup and punchline — friend telling it on the phone, not stand-up MC; "
        "skip 'here's a joke' preamble."
    ),
    "translate": (
        "Translate: give the phrase in the target language, then a quick plain-English gloss; "
        "spell foreign words clearly for TTS."
    ),
    "summarize": (
        "Summarize: 2–4 crisp points in plain speech — no markdown; "
        "chat panel can show bullets, voice stays conversational."
    ),
    "explain": (
        "Explain: simple words first, one analogy max — friend clarifying, not lecture; "
        "match their level; stop when the point lands."
    ),
    "quiz_me": (
        "Quiz: one question at a time — wait for their answer before the next; "
        "friendly coach vibe, not exam proctor."
    ),
    "brainstorm": (
        "Brainstorm: toss 3–5 loose ideas out loud — short phrases, invite their pick; "
        "no numbered essay."
    ),
    "write_message": (
        "Text helper: draft a send-ready message they can copy from chat — "
        "warm, natural, their voice not yours; say it's a draft they can tweak."
    ),
}


def detect_task_type(message: str) -> Optional[TaskType]:
    text = (message or "").strip()
    if not text:
        return None
    for task_id, pattern in _TASK_PATTERNS:
        if pattern.search(text):
            return task_id
    return None


def task_turn_hint(message: str) -> str:
    """LLM routing hint for voice/text creative or helper tasks (casual turns)."""
    text = (message or "").strip()
    if not text:
        return ""

    task = detect_task_type(text)
    if not task:
        return ""

    if task in ("song", "rap") and singing.is_song_request(text):
        if task == "song" and singing.should_use_llm_song(text):
            return singing.singing_llm_turn_hint(text)
        if task == "rap" and (singing.should_use_llm_song(text) or singing.extract_song_topic(text)):
            hint = singing.singing_llm_turn_hint(text)
            if hint:
                return hint
        if task == "rap" and not singing.should_use_llm_song(text):
            return _TASK_HINTS["rap"]

    if task == "song":
        if singing.should_use_llm_song(text):
            return singing.singing_llm_turn_hint(text)
        return ""

    return _TASK_HINTS.get(task, "")
