"""
Therapeutic chat skills — friend-voice listening moves, not clinician persona.

Routes emotional turns to one skill hint at a time (reflect, explore, ground, etc.).
"""

from __future__ import annotations

import re
from typing import Literal, Optional

import profile
from companion_moments import is_advice_seeking, is_vent_message

ChatSkillId = Literal[
    "reflect_listen",
    "explore_layer",
    "grounding",
    "decision_support",
    "coping_when_asked",
    "crisis_care",
]

_CRISIS = re.compile(
    r"\b(?:"
    r"kill myself|killing myself|end my life|want to die|wanna die|"
    r"suicid(?:e|al)|self[- ]?harm|hurt myself|cutting myself|"
    r"don'?t want to (?:be here|live|exist)|better off dead|"
    r"no reason to (?:live|go on)|thoughts of (?:dying|death)"
    r")\b",
    re.I,
)

_GROUNDING = re.compile(
    r"\b(?:"
    r"panic(?: attack)?|panicking|can'?t breathe|hyperventilat|"
    r"spiraling|freaking out|overwhelmed|overwhelm|"
    r"anxious|anxiety attack|heart (?:is )?racing|shaking (?:so )?bad"
    r")\b",
    re.I,
)

_DECISION = re.compile(
    r"\b(?:"
    r"weighing|torn between|can'?t decide|stuck between|"
    r"should i (?:quit|leave|stay|take|accept|say)|"
    r"not sure (?:if|whether) i should|deciding (?:if|whether)|"
    r"what if i (?:quit|leave|stay|take)"
    r")\b",
    re.I,
)

_REFLECT = re.compile(
    r"\b(?:"
    r"stressed|stressful|sad|depressed|down|lonely|heartbroken|"
    r"conflict|argument|fight with|broke up|passed away|grieving|"
    r"rough day|hard day|bad day|hurt|upset|angry at|mad at|"
    r"crying|cried|miserable|exhausted emotionally"
    r")\b",
    re.I,
)

_EMOTIONAL_CONTEXT = re.compile(
    r"\b(?:"
    r"stressed|sad|anxious|worried|scared|overwhelmed|depressed|"
    r"lonely|heartbroken|grieving|rough|hard day|can'?t sleep|"
    r"feel like|too late|failed|rejected|fired|laid off"
    r")\b",
    re.I,
)


def _sentence_count(text: str) -> int:
    parts = [p.strip() for p in re.split(r"[.!?]+", text) if p.strip()]
    return max(1, len(parts))


def detect_chat_skill(message: str) -> Optional[ChatSkillId]:
    """Pick one support skill for this turn, highest priority first."""
    text = (message or "").strip()
    if not text or profile.is_memory_recall_question(text):
        return None

    if _CRISIS.search(text):
        return "crisis_care"

    if is_advice_seeking(text) and (
        _EMOTIONAL_CONTEXT.search(text) or is_vent_message(text)
    ):
        return "coping_when_asked"

    if _GROUNDING.search(text):
        return "grounding"

    if _DECISION.search(text):
        return "decision_support"

    if _sentence_count(text) >= 2 and (
        is_vent_message(text) or _REFLECT.search(text) or len(text.split()) >= 14
    ):
        return "explore_layer"

    if _REFLECT.search(text) or is_vent_message(text):
        return "reflect_listen"

    return None


_SKILL_HINTS: dict[ChatSkillId, str] = {
    "reflect_listen": (
        "Support chat — reflect listen: echo one short phrase they used, then one "
        "gentle feeling-name question (sounds like… / is it more…). Friend voice — "
        "not 'that must be so hard', not validation stack."
    ),
    "explore_layer": (
        "Support chat — explore layer: they vented a bit — one what/how follow-up "
        "only, not a why stack. Listen first; no fix-it list, no clinical framing."
    ),
    "grounding": (
        "Support chat — grounding buddy: one quick body/breath check-in "
        "(where do you feel it / one slow breath) — no lecture, no numbered steps."
    ),
    "decision_support": (
        "Support chat — decision clarity: one question — what would you want if "
        "fear wasn't in the way? No pros/cons list unless they asked."
    ),
    "coping_when_asked": (
        "Support chat — they asked what to do: ONE small coping step max, friend tone. "
        "No lecture, no 'you could try' stack, no sleep-hygiene list."
    ),
    "crisis_care": (
        "Crisis care — stay present as a caring friend, not a clinician. Brief honest "
        "care; suggest 988 (US) or local crisis line if they're in danger; don't "
        "diagnose or therapize. Stay with them — don't rush to fix."
    ),
}


def chat_skill_turn_hint(message: str, *, casual: bool) -> str:
    """Turn hint for detected support skill, or empty."""
    if not casual:
        return ""
    skill = detect_chat_skill(message)
    if not skill:
        return ""
    return _SKILL_HINTS[skill]
