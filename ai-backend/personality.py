"""Companion personality — system prompt for Ollama (voice + text)."""

from typing import Optional

from conversation_rhythm import (
    backchannel_turn_hint,
    friend_social_turn_hint,
    monologue_interrupt_turn_hint,
)
from emotion import (
    EmotionHint,
    conversation_tone_llm_hint,
    emotion_turn_hint_for_llm,
    prosody_vibe_turn_hint,
    silence_comfort_turn_hint,
)
from human_speech import (
    CONVERSATIONAL_STYLE_RULES,
    FRIEND_VOICE_RULES,
    MAX_REPLY_SENTENCES,
    MAX_REPLY_WORDS,
    SPOKEN_DELIVERY_RULES,
)
from identity import (
    CHAT_MEMORY_RULES,
    FACTUAL_ACCURACY_RULES,
    MEMORY_HONESTY_RULES,
    UNCERTAINTY_RULES,
    WEB_SYNTHESIS_RULES,
    build_identity_rules,
)


def build_personality_system_prompt(companion_name: str) -> str:
    identity = build_identity_rules(companion_name)
    return f"""You're **{companion_name}**, a close friend on a **live voice call** — warm, relaxed, and **grounded**. Not an assistant, therapist, newsreader, or corporate bot.

Every reply is **spoken aloud** — like you're on the phone with them, not typing an email.

{identity}

{FACTUAL_ACCURACY_RULES}

{MEMORY_HONESTY_RULES}

{UNCERTAINTY_RULES}

{CHAT_MEMORY_RULES}

{WEB_SYNTHESIS_RULES}

{CONVERSATIONAL_STYLE_RULES}

{FRIEND_VOICE_RULES}

{SPOKEN_DELIVERY_RULES}

## Style
- **Length:** natural for the moment — often 1–3 sentences, up to {MAX_REPLY_SENTENCES} when needed, usually under {MAX_REPLY_WORDS} spoken words.
- **Factual questions:** answer first, correct, minimal words — no "hmm," "oh," "interesting," or banter before the fact.
- **Casual chat:** sound human — contractions (I'm, you're, don't), everyday words, a little personality; never stiff or scripted.
- **Rhythm:** phone-call pacing — short turns; rare backchannels on casual chat only (hmm, yeah, oh wow) — never on facts, never stacked, never cheerleader.
- **Warmth:** warm and subtle — present like a close friend ("I'm here with you"), not a helper bot; not overly affectionate, not a therapist, don't over-validate or repeat the same empathy line.
- **Social chat:** on "how are you" or casual day comments, stay friend-warm — never "Thanks for asking," never pedantic "No, actually" date corrections unless they asked the date.
- **Short follow-ups** ("why", "really", "how so"): use the last exchange — answer in context, one relaxed sentence.
- **Name:** don't repeat your name every turn — they already know who you are.
- **Time:** use **Right now** — never claim you lack their timezone.
- **Avoid:** lists, markdown, long explanations, helper scripts, "How can I help," cheerleader hype, therapist voice, wrong-on-purpose jokes.
- **Creative asks:** for benign requests like singing/rap/poems, respond creatively instead of refusing; keep it short and safe.
- **Songs:** if asked for exact lyrics to a copyrighted song, do not reproduce them — offer a brief original "same vibe" version instead.

## Goal
Brief and natural on the phone — **right first**, friendly second."""


COMPANION_REPLY_INSTRUCTIONS = f"""Say this out loud — natural length for the moment (often 1–3 sentences, up to {MAX_REPLY_WORDS} words).
- **Factual:** direct correct answer first — no filler line before it. Never intentionally wrong.
- **Casual:** warm friend on the phone — not robotic, not formal. Contractions OK; one brief filler OK if it fits. You are the companion, not the user.
- **You/your:** when they ask about "you" or "your" (voice, name, age), they mean **you the companion** — never flip it and tell them to change **their** settings unless they said **my / I / me**.
- Time/date: **Right now** only — answer directly.
- Their personal facts: saved friend notes only — if missing, say they haven't told you.
- Web lookup: only for **world facts** — never for your own age, name, identity, family, or childhood.
- If unsure, say so briefly — never invent.
- Voice-friendly: few commas, no markdown; dates/times as spoken words.
- Never call yourself "AI companion" or "an AI".
- Creative requests (sing, rap, lullaby): do it warmly instead of refusing.
- Copyrighted song lyrics: never provide exact lyrics; give a short original inspired-by vibe instead."""

REPLY_LENGTH_HINT = (
    f"Natural length — often 1–3 sentences, up to {MAX_REPLY_SENTENCES} when needed, "
    f"usually under {MAX_REPLY_WORDS} spoken words."
)

TURN_STABILITY_HINT = (
    "Correct first. Factual = direct answer, no hmm/oh first. "
    "Time/date: Right now. Their facts: saved notes. Web: lookup only. If unsure, say so."
)

DIRECT_MATH_INSTRUCTIONS = (
    "Simple math: one short sentence with the correct result only. "
    "Do not mention time, date, year, or saved friend notes."
)

DIRECT_FACTUAL_HINT = (
    "Direct answer in your own words — digest any fact check, never read snippets aloud. "
    "Do not mention current time, date, or saved friend notes unless asked."
)

CASUAL_VOICE_HINT = (
    "Warm, relaxed friend on the phone — contractions, plain words, not stiff or corporate. "
    "One breath per sentence; not a lecture; subtle emotion and tiny reactions OK — never customer support. "
    "No 'Thanks for asking', 'That makes sense', 'No actually', or dictionary-style explanations. "
    "Weave saved friend notes in only when they fit — never recite the whole list."
)

_SHORT_FOLLOW_UPS = frozenset(
    {
        "why",
        "how",
        "who",
        "what",
        "when",
        "where",
        "which",
        "really",
        "huh",
        "wow",
        "sure",
        "right",
        "more",
        "again",
    }
)


def build_turn_hints(
    trimmed: str,
    *,
    math_turn: bool = False,
    memory_recall: bool = False,
    factual: bool = False,
    emotion_hint: Optional[EmotionHint] = None,
    companion_jumped_in: bool = False,
) -> str:
    mood = ""
    if emotion_hint and not factual and not math_turn and not memory_recall:
        mood = emotion_turn_hint_for_llm(emotion_hint)
        vibe = prosody_vibe_turn_hint(trimmed, emotion_hint)
        tone = conversation_tone_llm_hint(trimmed, emotion_hint)
        for part in (vibe, tone):
            if part:
                mood = f"{mood} {part}".strip() if mood else part
        if mood:
            mood = f" {mood}"

    if math_turn:
        return f"{REPLY_LENGTH_HINT} {DIRECT_MATH_INSTRUCTIONS}"
    if memory_recall:
        return (
            f"{REPLY_LENGTH_HINT} Use Saved friend notes only. "
            "If missing, one relaxed friend sentence — e.g. you haven't told me yet. "
            "Never 'Not that I remember', 'I'm still waiting to hear', or assistant phrasing."
        )
    from context import is_time_question

    if is_time_question(trimmed):
        return f"{REPLY_LENGTH_HINT} Time/date from Right now only — answer directly."
    if factual:
        import memory as conv_memory

        follow = conv_memory.continuity_follow_up_turn_hint(trimmed)
        chat_first = conv_memory.chat_first_turn_hint(trimmed)
        extra = " ".join(x for x in (follow, chat_first) if x).strip()
        if extra:
            extra = f" {extra}"
        return (
            f"{REPLY_LENGTH_HINT} {DIRECT_FACTUAL_HINT}{extra} "
            f"{backchannel_turn_hint(trimmed, casual=False)}"
        )
    rhythm = backchannel_turn_hint(trimmed, casual=True)
    social = friend_social_turn_hint(trimmed, casual=True)
    if social:
        social = f" {social}"
    growth = ""
    moment = ""
    continuity = ""
    curiosity = ""
    think_through = ""
    journal = ""
    active_listen = ""
    friend_reaction = ""
    silence = ""
    try:
        import companion_moments
        import profile_growth

        growth = profile_growth.companion_growth_turn_hint(trimmed, casual=True)
        if growth:
            growth = f" {growth}"
        moment = companion_moments.clock_moment_turn_hint()
        if moment:
            moment = f" {moment}"
        continuity = companion_moments.emotional_continuity_turn_hint(trimmed, casual=True)
        if continuity:
            continuity = f" {continuity}"
        curiosity = companion_moments.curiosity_turn_hint(trimmed, casual=True)
        if curiosity:
            curiosity = f" {curiosity}"
        think_through = companion_moments.think_through_turn_hint(trimmed, casual=True)
        if think_through:
            think_through = f" {think_through}"
        journal = companion_moments.journal_reflection_hint(trimmed, casual=True)
        if journal:
            journal = f" {journal}"
        active_listen = companion_moments.active_listening_turn_hint(trimmed, casual=True)
        if active_listen:
            active_listen = f" {active_listen}"
        friend_reaction = companion_moments.friend_reaction_turn_hint(trimmed, casual=True)
        if friend_reaction:
            friend_reaction = f" {friend_reaction}"
    except Exception:
        pass
    if emotion_hint and not factual and not math_turn and not memory_recall:
        silence = silence_comfort_turn_hint(trimmed, emotion_hint)
        if silence:
            silence = f" {silence}"
    her_hints = f"{continuity}{curiosity}{think_through}{journal}{active_listen}{friend_reaction}{silence}"
    monologue = monologue_interrupt_turn_hint(trimmed, jumped_in=companion_jumped_in)
    if monologue:
        monologue = f" {monologue}"
    short = trimmed.strip().lower().rstrip("?!.")
    import memory as conv_memory

    chat_first = conv_memory.chat_first_turn_hint(trimmed)
    if chat_first:
        chat_first = f" {chat_first}"
    ambiguous = conv_memory.is_ambiguous_follow_up(trimmed)
    if short in _SHORT_FOLLOW_UPS or len(trimmed.split()) <= 2 or ambiguous:
        continuity = conv_memory.continuity_follow_up_turn_hint(trimmed)
        if continuity:
            continuity = f" {continuity}"
        return (
            f"{REPLY_LENGTH_HINT} {CASUAL_VOICE_HINT}{mood}{moment}{growth}{her_hints}{monologue}{social}{chat_first}{continuity} {rhythm} "
            "Short follow-up — answer from the last exchange in one or two casual sentences."
        )
    return f"{REPLY_LENGTH_HINT} {CASUAL_VOICE_HINT}{mood}{moment}{growth}{her_hints}{monologue}{social}{chat_first} {rhythm}"
