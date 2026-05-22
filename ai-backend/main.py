import json
import os
from pathlib import Path
from typing import Generator, Iterator, List, NamedTuple, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env", override=True)

import companion
import current_facts
import emotion
import grounding
import llm_provider
import memory
import profile
import stt
import tts
import web_search
from context import (
    build_context_appendix,
    companion_math_reply,
    companion_time_reply,
    format_local_now,
    is_simple_math_question,
    needs_clock_context,
    needs_friend_notes_context,
    resolve_clock,
)
from human_speech import polish_for_speech
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


class TtsRequest(BaseModel):
    text: str
    style: str = "default"
    voice_gender: Optional[str] = None  # female | male — app voice-tone picker
    express_style: Optional[str] = None  # Azure mstts:express-as (cheerful, friendly, …)
    emotion_hint: Optional[str] = None  # warm | sympathetic | excited | gentle | neutral


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
        web_block = web_search.lookup_for_message(user_message)
    name = companion.get_companion_name()
    msg = user_message.strip()
    return (
        f"{build_personality_system_prompt(name)}\n\n"
        f"{build_context_appendix(web_block, clock, include_clock=needs_clock_context(msg), include_notes=needs_friend_notes_context(msg))}"
    )


def _turn_emotion(
    trimmed: str,
    *,
    factual: bool = False,
    memory_recall: bool = False,
) -> tuple[str, Optional[str]]:
    """LLM mood hint + Azure express style for this turn (None = no express-as)."""
    if factual or memory_recall:
        return "neutral", None
    hint = emotion.detect_emotion_hint(trimmed, memory.get_history())
    return hint, emotion.express_style_for_hint(hint)


def build_chat_context(
    latest_user_message: str,
    web_block: Optional[str] = None,
    hits: Optional[list] = None,
    *,
    clock=None,
) -> ChatContext:
    trimmed = latest_user_message.strip()
    if len(trimmed) > memory.MAX_MESSAGE_CHARS:
        trimmed = trimmed[: memory.MAX_MESSAGE_CHARS] + "…"

    if web_block is None or hits is None:
        web_block, hits = web_search.lookup_with_hits(trimmed)
    math_turn = is_simple_math_question(trimmed)
    factual = math_turn or (
        web_search.is_factual_question(trimmed) and web_search.has_usable_hits(hits)
    )
    profile_turn = profile.is_user_profile_turn(trimmed)
    memory_recall = profile_turn
    emotion_hint, _express = _turn_emotion(
        trimmed, factual=factual, memory_recall=memory_recall
    )

    # Factual / profile turns: no chat history (avoids wrong or invented context).
    if factual or profile_turn:
        history = []
    else:
        history = memory.to_ollama_messages(trimmed)

    user_content = trimmed
    if math_turn:
        user_content = f"{trimmed}\n\n{DIRECT_MATH_INSTRUCTIONS}"
    elif factual and web_block:
        user_content = (
            f"{web_block}\n\n"
            f"They asked: {trimmed}\n\n"
            "Answer using only the live web lookup above.\n\n"
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
        f"({build_turn_hints(trimmed, math_turn=math_turn, memory_recall=memory_recall, factual=factual, emotion_hint=emotion_hint)})"
    )

    return ChatContext(
        system={"role": "system", "content": build_system_prompt(trimmed, web_block, clock=clock)},
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
) -> ChatContext:
    """Companion voice pass after sources-only grounding."""
    system = build_system_prompt(trimmed, web_block, clock=clock)
    user_content = (
        f"They asked: {trimmed}\n\n"
        f"Accurate answer (keep these facts correct):\n{grounded_fact}\n\n"
        f"{COMPANION_REPLY_INSTRUCTIONS}\n\n"
        f"({build_turn_hints(trimmed, factual=True)})"
    )
    return ChatContext(
        system={"role": "system", "content": system},
        history=[],
        latest_user={"role": "user", "content": user_content},
        trimmed_latest=trimmed,
        factual_reply=True,
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


def _stream_canned_reply(trimmed: str, reply: str) -> Generator[str, None, None]:
    companion.try_learn_name_from_user(trimmed)
    profile.learn_from_user_message(trimmed)
    memory.append_exchange(trimmed, reply)
    emotion_hint, express_style = _turn_emotion(trimmed)
    for piece in _stream_text_chunks(reply):
        yield _ndjson_line({"text": piece})
    done_payload: dict = {"done": True, "reply": reply, "emotion_hint": emotion_hint}
    if express_style:
        done_payload["express_style"] = express_style
    yield _ndjson_line(done_payload)


def stream_chat_events(
    user_message: str,
    client_timezone: Optional[str] = None,
) -> Generator[str, None, None]:
    trimmed = user_message.strip()
    clock = resolve_clock(client_timezone)
    yield _ndjson_line(
        {
            "start": True,
            "timezone": clock.iana,
            "timezone_from_device": clock.from_device,
        }
    )

    try:
        time_reply = companion_time_reply(trimmed, clock)
        if time_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(time_reply))
            return

        math_reply = companion_math_reply(trimmed)
        if math_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(math_reply))
            return

        birth_reply = companion.try_companion_birth_reply(trimmed)
        if birth_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(birth_reply))
            return

        age_reply = companion.try_companion_age_reply(trimmed)
        if age_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(age_reply))
            return

        voice_reply = companion.try_companion_voice_reply(trimmed)
        if voice_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(voice_reply))
            return

        identity_reply = companion.try_companion_identity_reply(trimmed)
        if identity_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(identity_reply))
            return

        family_reply = companion.try_companion_family_reply(trimmed)
        if family_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(family_reply))
            return

        name_reply = companion.try_name_recall_reply(trimmed)
        if name_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(name_reply))
            return

        rename_reply = companion.try_name_change_reply(trimmed)
        if rename_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(rename_reply))
            return

        conflict_reply = profile.try_memory_conflict_reply(trimmed)
        if conflict_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(conflict_reply))
            return

        age_learn_reply = profile.try_user_age_learn_reply(trimmed)
        if age_learn_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(age_learn_reply))
            return

        calendar_year = int(format_local_now_parts(clock)["year"])
        recall_reply = profile.try_memory_recall_reply(
            trimmed, calendar_year=calendar_year
        )
        if recall_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(recall_reply))
            return

        president_reply = current_facts.try_us_president_reply(trimmed)
        if president_reply:
            yield from _stream_canned_reply(trimmed, polish_for_speech(president_reply))
            return

        web_block, hits = web_search.lookup_with_hits(trimmed)
        use_grounding = web_search.is_factual_question(trimmed) and web_search.has_usable_hits(hits)

        if use_grounding:
            grounded = grounding.answer_from_sources(trimmed, hits)
            if grounded:
                context = build_grounded_chat_context(
                    trimmed, grounded, web_block, clock=clock
                )
            else:
                context = build_chat_context(trimmed, web_block, hits, clock=clock)
        else:
            context = build_chat_context(trimmed, web_block, hits, clock=clock)

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
        raw_reply = companion.finalize_family_reply(trimmed, raw_reply)
        reply = polish_for_speech(raw_reply)
        if not reply:
            reply = "I don't have a reply right now. Please try again."

        # Facts: user turn only — never learn from assistant reply text.
        companion.try_learn_name_from_user(context.trimmed_latest)
        profile.learn_from_user_message(context.trimmed_latest)
        memory.append_exchange(context.trimmed_latest, reply)
        emotion_hint, express_style = _turn_emotion(
            context.trimmed_latest,
            factual=context.factual_reply,
            memory_recall=profile.is_user_profile_turn(context.trimmed_latest),
        )
        done_payload: dict = {"done": True, "reply": reply, "emotion_hint": emotion_hint}
        if express_style:
            done_payload["express_style"] = express_style
        yield _ndjson_line(done_payload)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        yield _ndjson_line({"error": detail})
    except Exception as exc:
        yield _ndjson_line({"error": str(exc)})


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
    return {
        "status": "ok" if model_ready else "degraded",
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
        "hint": hint,
        "azure_tts": tts.tts_status(voice_gender),
        "azure_stt": stt.stt_status(),
        "web_search": web_search.status(),
    }


@app.post("/chat")
def chat(body: ChatRequest):
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message cannot be empty")

    return StreamingResponse(
        stream_chat_events(message, body.timezone),
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
    return Response(content=audio, media_type="audio/mpeg")


@app.post("/stt")
async def transcribe(file: UploadFile = File(...)):
    """Speech-to-text via Azure (upload recording from the app)."""
    audio_bytes = await file.read()
    text = stt.transcribe_audio(
        audio_bytes,
        filename=file.filename or "recording.wav",
        content_type=file.content_type,
    )
    return {"text": text}


@app.post("/chat/reset")
def reset_conversation():
    memory.clear()
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
