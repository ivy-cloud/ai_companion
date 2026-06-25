import json
import logging
import os
import time
from pathlib import Path
from typing import Generator, Iterator, List, NamedTuple, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env", override=True)

import companion
import companion_moments
import companion_thread
import conversation_rhythm
import dev_mode
import current_facts
import emotion
import grounding
import llm_provider
import memory
import profile
import profile_growth
import realtime_voice
import session_log
import singing
import stt
import tts
import web_search
from context import (
    build_context_appendix,
    companion_math_reply,
    companion_time_reply,
    format_local_now,
    format_local_now_parts,
    is_simple_math_question,
    needs_clock_context,
    resolve_clock,
)
from human_speech import polish_for_display, polish_for_speech
from personality import (
    COMPANION_REPLY_INSTRUCTIONS,
    DIRECT_MATH_INSTRUCTIONS,
    build_personality_system_prompt,
    build_turn_hints,
)

def _bootstrap_profile_from_saved_chat() -> None:
    """Re-index user lines only — assistant messages are never fact sources."""
    user_lines = [msg["text"] for msg in memory.get_history() if msg["role"] == "user"]
    profile.bootstrap_facts_from_user_history(user_lines)


def _install_quiet_access_log_paths() -> None:
    """Drop uvicorn access lines for high-frequency debug routes (e.g. voice-log)."""
    quiet = ("/debug/voice-log",)

    class _Filter(logging.Filter):
        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            return not any(path in msg for path in quiet)

    logging.getLogger("uvicorn.access").addFilter(_Filter())


_install_quiet_access_log_paths()

app = FastAPI(title="AI Companion API")
_bootstrap_profile_from_saved_chat()
companion.ensure_companion_name()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    timezone: Optional[str] = None  # IANA from the phone, e.g. America/New_York
    proactive: bool = False
    thread_beat: Optional[str] = None
    companion_interrupt: bool = False  # Jessica jumped in mid-user monologue


class TtsRequest(BaseModel):
    text: str
    style: str = "default"
    voice_gender: Optional[str] = None  # female | male — app voice-tone picker
    express_style: Optional[str] = None  # Azure mstts:express-as (cheerful, friendly, …)
    emotion_hint: Optional[str] = None  # warm | sympathetic | excited | gentle | neutral


class VoiceLogRequest(BaseModel):
    event: str
    detail: Optional[dict] = None
    platform: Optional[str] = None


class ChatContext(NamedTuple):
    system: dict
    history: List[dict]
    latest_user: dict
    trimmed_latest: str
    factual_reply: bool = False

    def to_ollama_messages(self) -> List[dict]:
        return [self.system, *self.history, self.latest_user]


def build_system_prompt(
    user_message: str,
    web_block: Optional[str] = None,
    *,
    clock=None,
) -> str:
    if web_block is None:
        web_block = web_search.lookup_for_message(user_message, clock=clock)
    name = companion.get_companion_name()
    msg = user_message.strip()
    math_turn = is_simple_math_question(msg)
    appendix = build_context_appendix(
        web_block,
        clock,
        include_clock=needs_clock_context(msg) and not math_turn,
        include_notes=not math_turn,
    )
    return f"{build_personality_system_prompt(name)}\n\n{appendix}"


def _turn_emotion(
    trimmed: str,
    *,
    factual: bool = False,
    memory_recall: bool = False,
    reply_text: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """LLM mood hint + Azure express style for this turn (None = no express-as)."""
    if factual or memory_recall:
        return "neutral", None
    hint = emotion.detect_emotion_hint(
        trimmed,
        memory.get_history(),
        reply_text=reply_text,
    )
    return hint, emotion.express_style_for_hint(hint)


def build_chat_context(
    latest_user_message: str,
    web_block: Optional[str] = None,
    hits: Optional[list] = None,
    *,
    clock=None,
    companion_jumped_in: bool = False,
) -> ChatContext:
    trimmed = latest_user_message.strip()
    if len(trimmed) > memory.MAX_MESSAGE_CHARS:
        trimmed = trimmed[: memory.MAX_MESSAGE_CHARS] + "…"

    ambiguous_follow_up = memory.is_ambiguous_follow_up(trimmed)
    chat_first = memory.should_answer_from_chat_first(trimmed)
    chat_topic = memory.current_topic_summary() if (ambiguous_follow_up or chat_first) else None

    if web_block is None or hits is None:
        if not chat_first and web_search.should_search(trimmed):
            web_block, hits = web_search.lookup_with_hits(
                trimmed,
                clock=clock,
                chat_topic=chat_topic,
            )
        else:
            web_block, hits = None, []

    math_turn = is_simple_math_question(trimmed)
    has_web = web_search.has_usable_hits(hits or [])
    factual = math_turn or (
        has_web
        and web_search.is_factual_question(trimmed)
        and not chat_first
    )
    profile_turn = profile.is_user_profile_turn(trimmed)
    memory_recall = profile_turn
    emotion_hint, _express = _turn_emotion(
        trimmed, factual=factual, memory_recall=memory_recall
    )

    # Factual / profile turns: no chat history (avoids wrong or invented context).
    # Ambiguous follow-ups keep history so "last game today" resolves after World Cup chat.
    if memory.should_keep_history_for_turn(
        trimmed, math_turn=math_turn, profile_turn=profile_turn, factual=factual
    ):
        history = memory.to_ollama_messages(trimmed)
    else:
        history = []

    user_content = trimmed
    if math_turn:
        user_content = f"{trimmed}\n\n{DIRECT_MATH_INSTRUCTIONS}"
    elif factual and web_block:
        topic_prefix = ""
        if (ambiguous_follow_up or chat_first) and chat_topic:
            topic_prefix = (
                f"Recent conversation (answer from this first if it fits): "
                f"{chat_topic}\n\n"
            )
        user_content = (
            f"{topic_prefix}Fact check (internal — digest into your own words, do not recite):\n"
            f"{web_block}\n\n"
            f"They asked: {trimmed}\n\n"
            "Say it like you already know it — brief friend on the phone, not a newsreader.\n\n"
            f"{COMPANION_REPLY_INSTRUCTIONS}"
        )

    if memory_recall:
        user_content = (
            f"{user_content}\n\n"
            "They are asking what you remember. Use ONLY Saved friend notes in the system prompt. "
            "If the fact is not listed, say naturally that they haven't told you yet. "
            "Do not invent memories or shared experiences."
        )

    user_content = (
        f"{user_content}\n\n"
        f"({build_turn_hints(trimmed, math_turn=math_turn, memory_recall=memory_recall, factual=factual, emotion_hint=emotion_hint, companion_jumped_in=companion_jumped_in)})"
    )

    return ChatContext(
        system={
            "role": "system",
            "content": build_system_prompt(
                trimmed, web_block if factual else None, clock=clock
            ),
        },
        history=history,
        latest_user={"role": "user", "content": user_content},
        trimmed_latest=trimmed,
        factual_reply=factual,
    )


def build_grounded_chat_context(
    trimmed: str,
    grounded_fact: str,
    web_block: Optional[str],
    *,
    clock=None,
    keep_history: bool = False,
    chat_topic: Optional[str] = None,
) -> ChatContext:
    """Companion voice pass after sources-only grounding."""
    system = build_system_prompt(trimmed, web_block, clock=clock)
    topic_prefix = ""
    if chat_topic:
        topic_prefix = (
            f"Recent conversation topic (resolve their follow-up in this context): "
            f"{chat_topic}\n\n"
        )
    user_content = (
        f"{topic_prefix}They asked: {trimmed}\n\n"
        f"Facts you looked up (internal — weave in naturally, do NOT read as a list):\n"
        f"{grounded_fact}\n\n"
        "Say it like you already know it — brief friend on the phone.\n\n"
        f"{COMPANION_REPLY_INSTRUCTIONS}\n\n"
        f"({build_turn_hints(trimmed, factual=True)})"
    )
    history = memory.to_ollama_messages(trimmed) if keep_history else []
    return ChatContext(
        system={"role": "system", "content": system},
        history=history,
        latest_user={"role": "user", "content": user_content},
        trimmed_latest=trimmed,
        factual_reply=True,
    )


def build_proactive_chat_context(
    *,
    thread_beat: Optional[str] = None,
    clock=None,
) -> ChatContext:
    """Companion continues its thread while the user listens quietly."""
    beat = thread_beat or companion_thread.consume_next_beat()
    hint = companion_thread.proactive_turn_hint(beat)
    trimmed = companion_thread.PROACTIVE_USER_MARKER
    history = memory.to_ollama_messages(trimmed)
    user_content = (
        "(Companion continues while the user is quiet — they may interrupt anytime.)\n\n"
        f"{COMPANION_REPLY_INSTRUCTIONS}\n\n"
        f"({hint})"
    )
    return ChatContext(
        system={
            "role": "system",
            "content": build_system_prompt("", clock=clock),
        },
        history=history,
        latest_user={"role": "user", "content": user_content},
        trimmed_latest=trimmed,
        factual_reply=False,
    )


def _ndjson_line(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _stream_text_chunks(text: str, chunk_size: int = 14) -> Iterator[str]:
    """Yield canned replies in small chunks so the client can render/speak progressively."""
    if not text:
        return
    step = max(4, chunk_size)
    for i in range(0, len(text), step):
        yield text[i : i + step]


def _turn_log_fields(
    started_at: float,
    clock,
    learn_result: profile.LearnResult,
) -> dict:
    return {
        "duration_ms": int((time.monotonic() - started_at) * 1000),
        "timezone_iana": clock.iana,
        "learn_updated": list(learn_result.updated),
        "learn_conflicts": len(learn_result.conflicts),
        "profile_facts": profile.get_facts(),
    }


def _merge_log_extra(
    base: Optional[dict] = None,
    audio_extra: Optional[dict] = None,
) -> Optional[dict]:
    if not base and not audio_extra:
        return None
    merged: dict = {}
    if base:
        merged.update(base)
    if audio_extra:
        merged.update(audio_extra)
    return merged


def _finalize_replies(
    raw_reply: str,
    *,
    polish: bool = True,
    hits: Optional[list] = None,
    user_message: str = "",
) -> tuple[str, str, list]:
    """Split raw LLM text into chat display vs spoken TTS, with optional link enrichment."""
    if polish:
        display_reply = polish_for_display(raw_reply)
        speech_reply = polish_for_speech(raw_reply)
    else:
        stripped = raw_reply.strip()
        display_reply = speech_reply = stripped

    link_hits = hits or []
    links = web_search.links_for_display(link_hits) if link_hits else []
    if link_hits and user_message:
        display_reply = web_search.enrich_display_with_links(
            display_reply, link_hits, user_message
        )

    if not speech_reply:
        speech_reply = "I don't have a reply right now. Please try again."
    if not display_reply:
        display_reply = speech_reply
    return display_reply, speech_reply, links


def _stream_canned_reply(
    trimmed: str,
    reply: str,
    *,
    route: str,
    started_at: float,
    clock,
    learn_at_start: profile.LearnResult,
    polish_reply: bool = True,
    singing_reply: bool = False,
    speech_chunks: Optional[list[str]] = None,
    log_extra: Optional[dict] = None,
    hits: Optional[list] = None,
) -> Generator[str, None, None]:
    companion.try_learn_name_from_user(trimmed)
    profile.learn_from_user_message(trimmed)
    profile_growth.record_usage_signals(trimmed, route)
    display_reply, spoken_reply, links = _finalize_replies(
        reply,
        polish=polish_reply,
        hits=hits,
        user_message=trimmed,
    )
    memory.append_exchange(trimmed, spoken_reply)
    session_log.log_turn(
        trimmed,
        spoken_reply,
        route=route,
        **_turn_log_fields(started_at, clock, learn_at_start),
        extra=log_extra,
    )
    emotion_hint, express_style = _turn_emotion(trimmed, reply_text=spoken_reply)
    for piece in _stream_text_chunks(spoken_reply):
        yield _ndjson_line({"text": piece})
    done_payload: dict = {
        "done": True,
        "reply": display_reply,
        "speech_reply": spoken_reply,
        "emotion_hint": emotion_hint,
        "speech_chunks": speech_chunks
        if speech_chunks is not None
        else conversation_rhythm.speech_chunks_for_reply(spoken_reply),
    }
    if links:
        done_payload["links"] = links
    if singing_reply:
        done_payload["singing"] = True
    if express_style:
        done_payload["express_style"] = express_style
    yield _ndjson_line(done_payload)


def _normalize_audio_source(raw: Optional[str]) -> str:
    value = (raw or "phone").strip().lower() or "phone"
    if value in ("meta-glasses", "meta-glasses-stub", "meta-stub"):
        return "meta-glasses"
    return value


def _audio_source_extra(audio_source: Optional[str]) -> Optional[dict]:
    normalized = _normalize_audio_source(audio_source)
    if normalized == "phone":
        return None
    return {"audio_source": normalized}


def stream_chat_events(
    user_message: str,
    client_timezone: Optional[str] = None,
    *,
    audio_source: Optional[str] = None,
    proactive: bool = False,
    thread_beat: Optional[str] = None,
    companion_jumped_in: bool = False,
) -> Generator[str, None, None]:
    trimmed = user_message.strip()
    clock = resolve_clock(client_timezone)
    audio_extra = _audio_source_extra(audio_source)

    if proactive or companion_thread.is_proactive_user_message(trimmed):
        rhythm: dict = {
            "casual": True,
            "stream_tts": True,
            "interruptible": True,
            "proactive": True,
        }
        beats = companion_thread.proactive_beats_for_stream()
        if beats:
            rhythm["proactive_beats"] = beats
        yield _ndjson_line(
            {
                "start": True,
                "timezone": clock.iana,
                "timezone_from_device": clock.from_device,
                "rhythm": rhythm,
            }
        )
        started_at = time.monotonic()
        learn_at_start = profile.LearnResult()
        try:
            context = build_proactive_chat_context(thread_beat=thread_beat, clock=clock)
            collected: List[str] = []
            for piece in llm_provider.stream_chat_text(
                context.to_ollama_messages(),
                factual=False,
            ):
                collected.append(piece)
                yield _ndjson_line({"text": piece})

            raw_reply = "".join(collected).strip()
            display_reply, speech_reply, links = _finalize_replies(raw_reply)
            if not speech_reply:
                speech_reply = "I'm still here with you."
            if not display_reply:
                display_reply = speech_reply

            memory.append_assistant_continuation(speech_reply)
            companion_thread.update_after_reply(context.trimmed_latest, speech_reply)
            emotion_hint, express_style = _turn_emotion("", factual=False, memory_recall=False)
            done_payload: dict = {
                "done": True,
                "reply": display_reply,
                "speech_reply": speech_reply,
                "emotion_hint": emotion_hint,
                "speech_chunks": conversation_rhythm.speech_chunks_for_reply(speech_reply),
                "proactive": True,
            }
            if links:
                done_payload["links"] = links
            refreshed = companion_thread.proactive_beats_for_stream()
            if refreshed:
                done_payload["proactive_beats"] = refreshed
            if express_style:
                done_payload["express_style"] = express_style
            session_log.log_turn(
                context.trimmed_latest,
                speech_reply,
                route="llm:proactive",
                **_turn_log_fields(started_at, clock, learn_at_start),
                extra=audio_extra,
            )
            yield _ndjson_line(done_payload)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            session_log.log_turn(
                trimmed,
                "",
                route="error:http",
                error=detail,
                **_turn_log_fields(started_at, clock, learn_at_start),
                extra=audio_extra,
            )
            yield _ndjson_line({"error": detail})
        except Exception as exc:
            session_log.log_turn(
                trimmed,
                "",
                route="error:exception",
                error=str(exc),
                **_turn_log_fields(started_at, clock, learn_at_start),
                extra=audio_extra,
            )
            yield _ndjson_line({"error": str(exc)})
        return

    math_turn = is_simple_math_question(trimmed)
    memory_recall = profile.is_user_profile_turn(trimmed)
    factual_guess = math_turn or memory_recall or web_search.is_factual_question(trimmed)
    rhythm = conversation_rhythm.rhythm_stream_meta(
        trimmed,
        factual=factual_guess,
        math_turn=math_turn,
        memory_recall=memory_recall,
    )
    yield _ndjson_line(
        {
            "start": True,
            "timezone": clock.iana,
            "timezone_from_device": clock.from_device,
            "rhythm": rhythm,
        }
    )

    started_at = time.monotonic()
    learn_at_start = profile.learn_from_user_message(trimmed)
    companion.try_learn_name_from_user(trimmed)
    profile_growth.record_usage_signals(trimmed)
    audio_extra = _audio_source_extra(audio_source)

    def _canned(raw_reply: str, route: str) -> Generator[str, None, None]:
        return _stream_canned_reply(
            trimmed,
            raw_reply,
            route=route,
            started_at=started_at,
            clock=clock,
            learn_at_start=learn_at_start,
            log_extra=audio_extra,
        )

    try:
        time_reply = companion_time_reply(trimmed, clock)
        if time_reply:
            yield from _canned(time_reply, "canned:time")
            return

        math_reply = companion_math_reply(trimmed)
        if math_reply:
            yield from _canned(math_reply, "canned:math")
            return

        birth_reply = companion.try_companion_birth_reply(trimmed)
        if birth_reply:
            yield from _canned(birth_reply, "canned:companion_birthday")
            return

        age_reply = companion.try_companion_age_reply(trimmed)
        if age_reply:
            yield from _canned(age_reply, "canned:companion_age")
            return

        voice_reply = companion.try_companion_voice_reply(trimmed)
        if voice_reply:
            yield from _canned(voice_reply, "canned:companion_voice")
            return

        identity_reply = companion.try_companion_identity_reply(trimmed)
        if identity_reply:
            yield from _canned(identity_reply, "canned:companion_identity")
            return

        presence_reply = companion.try_companion_presence_reply(trimmed)
        if presence_reply:
            yield from _canned(presence_reply, "canned:companion_presence")
            return

        family_reply = companion.try_companion_family_reply(trimmed)
        if family_reply:
            yield from _canned(family_reply, "canned:companion_family")
            return

        name_reply = companion.try_name_recall_reply(trimmed)
        if name_reply:
            yield from _canned(name_reply, "canned:companion_name_recall")
            return

        rename_reply = companion.try_name_change_reply(trimmed)
        if rename_reply:
            yield from _canned(rename_reply, "canned:companion_rename")
            return

        age_learn_reply = profile.try_user_age_learn_reply(trimmed)
        if age_learn_reply:
            yield from _canned(age_learn_reply, "canned:user_age_learn")
            return

        conflict_reply = profile.try_memory_conflict_reply(trimmed)
        if conflict_reply:
            yield from _canned(conflict_reply, "canned:memory_conflict")
            return

        song_reply = singing.build_song_reply(trimmed)
        if song_reply:
            song_lines = [line.strip() for line in song_reply.splitlines() if line.strip()]
            yield from _stream_canned_reply(
                trimmed,
                song_reply,
                route="canned:singing",
                started_at=started_at,
                clock=clock,
                learn_at_start=learn_at_start,
                polish_reply=False,
                singing_reply=True,
                speech_chunks=song_lines,
                log_extra=audio_extra,
            )
            return

        calendar_year = int(format_local_now_parts(clock)["year"])
        recall_reply = profile.try_memory_recall_reply(
            trimmed, calendar_year=calendar_year
        )
        if recall_reply:
            yield from _canned(recall_reply, "canned:memory_recall")
            return

        president_reply = current_facts.try_us_president_reply(trimmed)
        if president_reply:
            yield from _canned(president_reply, "canned:president")
            return

        ambiguous_follow_up = memory.is_ambiguous_follow_up(trimmed)
        chat_first = memory.should_answer_from_chat_first(trimmed)
        chat_topic = memory.current_topic_summary() if (ambiguous_follow_up or chat_first) else None
        web_block, hits = (None, [])
        if not chat_first and web_search.should_search(trimmed):
            web_block, hits = web_search.lookup_with_hits(
                trimmed,
                clock=clock,
                chat_topic=chat_topic,
            )
        use_grounding = (
            not chat_first
            and web_search.is_factual_question(trimmed)
            and web_search.has_usable_hits(hits)
        )
        grounded: Optional[str] = None
        math_turn = is_simple_math_question(trimmed)
        profile_turn = profile.is_user_profile_turn(trimmed)
        keep_history = memory.should_keep_history_for_turn(
            trimmed,
            math_turn=math_turn,
            profile_turn=profile_turn,
            factual=use_grounding or (
                web_search.is_factual_question(trimmed) and web_search.has_usable_hits(hits)
            ),
        )

        if use_grounding:
            grounded = grounding.answer_from_sources(trimmed, hits)
            if grounded:
                context = build_grounded_chat_context(
                    trimmed,
                    grounded,
                    web_block,
                    clock=clock,
                    keep_history=keep_history,
                    chat_topic=chat_topic,
                )
            else:
                context = build_chat_context(
                    trimmed, web_block, hits, clock=clock, companion_jumped_in=companion_jumped_in
                )
        else:
            context = build_chat_context(
                trimmed, web_block, hits, clock=clock, companion_jumped_in=companion_jumped_in
            )

        collected: List[str] = []
        for piece in llm_provider.stream_chat_text(
            context.to_ollama_messages(),
            factual=context.factual_reply,
        ):
            collected.append(piece)
            yield _ndjson_line({"text": piece})

        raw_reply = "".join(collected).strip()
        raw_reply = companion.finalize_birth_reply(trimmed, raw_reply)
        raw_reply = companion.finalize_voice_reply(trimmed, raw_reply)
        raw_reply = companion.finalize_presence_reply(trimmed, raw_reply)
        raw_reply = companion.finalize_family_reply(trimmed, raw_reply)
        display_reply, speech_reply, links = _finalize_replies(
            raw_reply,
            hits=hits,
            user_message=context.trimmed_latest,
        )

        # Facts: user turn only — never learn from assistant reply text.
        companion.try_learn_name_from_user(context.trimmed_latest)
        profile.learn_from_user_message(context.trimmed_latest)
        memory.append_exchange(context.trimmed_latest, speech_reply)
        if not context.factual_reply and not profile.is_user_profile_turn(context.trimmed_latest):
            companion_thread.update_after_reply(context.trimmed_latest, speech_reply)
        emotion_hint, express_style = _turn_emotion(
            context.trimmed_latest,
            factual=context.factual_reply,
            memory_recall=profile.is_user_profile_turn(context.trimmed_latest),
            reply_text=speech_reply,
        )
        done_payload: dict = {
            "done": True,
            "reply": display_reply,
            "speech_reply": speech_reply,
            "emotion_hint": emotion_hint,
            "speech_chunks": conversation_rhythm.speech_chunks_for_reply(speech_reply),
        }
        if links:
            done_payload["links"] = links
        proactive_beats = companion_thread.proactive_beats_for_stream()
        if proactive_beats:
            done_payload["proactive_beats"] = proactive_beats
        if express_style:
            done_payload["express_style"] = express_style
        llm_route = "llm:grounded" if grounded else "llm"
        session_log.log_turn(
            context.trimmed_latest,
            speech_reply,
            route=llm_route,
            **_turn_log_fields(started_at, clock, learn_at_start),
            extra=_merge_log_extra({"web_hits": len(hits) if hits else 0}, audio_extra),
        )
        yield _ndjson_line(done_payload)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        session_log.log_turn(
            trimmed,
            "",
            route="error:http",
            error=detail,
            **_turn_log_fields(started_at, clock, learn_at_start),
            extra=audio_extra,
        )
        yield _ndjson_line({"error": detail})
    except Exception as exc:
        session_log.log_turn(
            trimmed,
            "",
            route="error:exception",
            error=str(exc),
            **_turn_log_fields(started_at, clock, learn_at_start),
            extra=audio_extra,
        )
        yield _ndjson_line({"error": str(exc)})


@app.get("/companion/session-open")
def companion_session_open(
    timezone: Optional[str] = None,
    force: bool = False,
    resume: bool = False,
):
    """Optional spoken opener when the app starts a voice conversation session."""
    clock = resolve_clock(timezone)
    line = companion_moments.session_opening_line(clock, force=force, resume=resume)
    has_history = memory.exchange_count() > 0
    if resume and has_history:
        mode = "resume" if line else "silent_listen"
    elif line:
        mode = "fresh"
    else:
        mode = "none"
    return {
        "line": line,
        "time_band": companion_moments.time_of_day_band(clock),
        "offered": line is not None,
        "mode": mode,
    }


@app.get("/companion/session-goodbye")
def companion_session_goodbye(timezone: Optional[str] = None):
    """Warm spoken line when the user ends a voice conversation session."""
    clock = resolve_clock(timezone)
    line = companion_moments.session_goodbye_line(clock)
    return {
        "line": line,
        "time_band": companion_moments.time_of_day_band(clock),
    }


@app.get("/health")
def health(voice_gender: Optional[str] = None):
    provider = llm_provider.llm_provider()
    model_ready, hint, installed = llm_provider.check_model_ready()
    ollama_status = "skipped"
    base_url = None
    if provider == "ollama":
        try:
            httpx.get(f"{llm_provider.OLLAMA_BASE_URL}/api/tags", timeout=5.0).raise_for_status()
            ollama_status = "reachable"
            base_url = llm_provider.OLLAMA_BASE_URL
        except Exception as exc:
            ollama_status = "unreachable"
            model_ready = False
            hint = hint or f"Start Ollama: ollama serve ({exc})"
    azure_tts_status = tts.tts_status(voice_gender)
    status_ok = model_ready and azure_tts_status.get("ready", False) is not False
    combined_hint = hint
    if not azure_tts_status.get("ready", False) and azure_tts_status.get("hint"):
        combined_hint = azure_tts_status["hint"]
    return {
        "status": "ok" if status_ok else "degraded",
        "llm_provider": provider,
        "model": llm_provider.active_model(),
        "model_ready": model_ready,
        "ollama": ollama_status,
        "base_url": base_url,
        "groq_configured": llm_provider.groq_configured() if provider == "groq" else None,
        "installed_models": installed if provider == "ollama" else [],
        "memory_exchanges": memory.exchange_count(),
        "profile_facts": profile.get_facts(),
        "companion": companion.get_companion_info(),
        "local_time": format_local_now(),
        "streaming": "ndjson",
        "hint": combined_hint,
        "azure_tts": azure_tts_status,
        "azure_stt": stt.stt_status(),
        "realtime_voice": realtime_voice.realtime_status(),
        "web_search": web_search.status(),
        "dev_mode": dev_mode.mock_status(),
        "session_log": session_log.status(),
    }


@app.post("/chat")
def chat(body: ChatRequest, request: Request):
    if body.proactive:
        message = companion_thread.PROACTIVE_USER_MARKER
    else:
        message = body.message.strip()
        if not message:
            raise HTTPException(status_code=400, detail="message cannot be empty")

    audio_source = request.headers.get("X-Audio-Source")

    return StreamingResponse(
        stream_chat_events(
            message,
            body.timezone,
            audio_source=audio_source,
            proactive=body.proactive,
            thread_beat=body.thread_beat,
            companion_jumped_in=body.companion_interrupt,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/tts")
def synthesize(body: TtsRequest):
    style = body.style if body.style in ("default", "filler") else "default"
    audio = tts.synthesize_speech(
        body.text,
        style,
        voice_gender=body.voice_gender,
        express_style=body.express_style,
        emotion_hint=body.emotion_hint,
    )
    media_type = "audio/wav" if dev_mode.mock_tts_enabled() else "audio/mpeg"
    return Response(content=audio, media_type=media_type)


@app.post("/stt")
async def transcribe(
    file: UploadFile = File(...),
    partial: bool = False,
):
    """Speech-to-text via Azure (upload recording from the app)."""
    audio_bytes = await file.read()
    filename = file.filename or "recording.wav"
    try:
        text = stt.transcribe_audio(
            audio_bytes,
            filename=filename,
            content_type=file.content_type,
            partial=partial,
        )
        if not partial:
            session_log.log_stt(text, filename=filename)
        return {"text": text, "partial": partial}
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        if not partial:
            session_log.log_stt("", filename=filename, error=detail)
        raise
    except Exception as exc:
        if not partial:
            session_log.log_stt("", filename=filename, error=str(exc))
        raise


@app.post("/chat/reset")
def reset_conversation():
    memory.clear()
    companion_thread.clear_thread()
    return {"status": "ok", "profile_facts_kept": profile.get_facts()}


@app.get("/chat/profile")
def get_friend_profile():
    return {
        "companion": companion.get_companion_info(),
        "facts": profile.get_facts(),
        "fact_entries": profile.get_fact_entries(),
        "memory_items": profile.get_memory_items(),
        "notes": profile.format_notes_for_prompt(),
    }


class CompanionNameRequest(BaseModel):
    name: str


@app.put("/chat/companion-name")
def set_companion_name(body: CompanionNameRequest):
    try:
        companion.set_companion_name_by_user(body.name, f"set via api: {body.name.strip()}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid name (letters, 2–20 chars)")
    return {"companion": companion.get_companion_info()}


@app.get("/chat/history")
def get_conversation_history():
    return {
        "exchanges_max": memory.MAX_EXCHANGES,
        "exchanges_stored": memory.exchange_count(),
        "messages": memory.get_history(),
        "profile_facts": profile.get_facts(),
    }


@app.get("/debug/session-log")
def get_session_log(limit: int = 50, format: str = "json", type: Optional[str] = None):
    """Recent phone test turns — JSON list or plain text for debugging."""
    limit = max(1, min(limit, 200))
    entry_type = type.strip() if type else None
    entries = session_log.read_entries(limit, entry_type=entry_type or None)
    if format.lower() in ("text", "txt", "plain"):
        from fastapi.responses import PlainTextResponse

        return PlainTextResponse(
            session_log.format_entries_text(entries),
            media_type="text/plain; charset=utf-8",
        )
    return {
        "status": session_log.status(),
        "count": len(entries),
        "entries": entries,
    }


@app.post("/debug/session-log/clear")
def clear_session_log():
    session_log.clear()
    return {"status": "ok", "session_log": session_log.status()}


@app.post("/debug/voice-log")
def post_voice_log(body: VoiceLogRequest):
    """Append voice/TTS debug lines from Expo (readable via session-log)."""
    if session_log.voice_http_enabled():
        session_log.log_voice(
            body.event,
            detail=body.detail,
            platform=body.platform,
        )
    return {"status": "ok"}
