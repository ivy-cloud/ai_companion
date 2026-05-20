import json
import os
from pathlib import Path
from typing import Generator, Iterator, List, NamedTuple

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

# Load ai-backend/.env regardless of cwd (uvicorn is often started from repo root).
_BACKEND_DIR = Path(__file__).resolve().parent
# Local .env should win over mistaken empty exports (e.g. export AZURE_SPEECH_KEY=)
load_dotenv(_BACKEND_DIR / ".env", override=True)

import memory
import tts
from personality import PERSONALITY_SYSTEM_PROMPT

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"

# NDJSON stream events (no WebSockets):
#   {"start": true}           — stream opened
#   {"text": "..."}           — partial token/chunk
#   {"done": true, "reply": "..."} — finished; memory saved
#   {"error": "..."}          — failure

app = FastAPI(title="AI Companion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class TtsRequest(BaseModel):
    text: str
    style: str = "default"


class ChatContext(NamedTuple):
    system: dict
    history: List[dict]
    latest_user: dict
    trimmed_latest: str

    def to_ollama_messages(self) -> List[dict]:
        return [self.system, *self.history, self.latest_user]


def build_chat_context(latest_user_message: str) -> ChatContext:
    trimmed = latest_user_message.strip()
    if len(trimmed) > memory.MAX_MESSAGE_CHARS:
        trimmed = trimmed[: memory.MAX_MESSAGE_CHARS] + "…"

    return ChatContext(
        system={"role": "system", "content": PERSONALITY_SYSTEM_PROMPT},
        history=memory.to_ollama_messages(),
        latest_user={"role": "user", "content": trimmed},
        trimmed_latest=trimmed,
    )


def _ndjson_line(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


def _list_ollama_models() -> List[str]:
    try:
        response = httpx.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5.0)
        response.raise_for_status()
        data = response.json()
        return [item.get("name", "") for item in data.get("models", []) if item.get("name")]
    except Exception:
        return []


def _model_is_available(model_name: str, installed: List[str]) -> bool:
    if not installed:
        return False
    if model_name in installed:
        return True
    return any(
        name == model_name or name.startswith(f"{model_name}:") or name.split(":")[0] == model_name
        for name in installed
    )


def _model_missing_message(installed: List[str]) -> str:
    installed_text = ", ".join(installed) if installed else "(none — run ollama pull)"
    return (
        f"Ollama model '{OLLAMA_MODEL}' is not installed. "
        f"Run: ollama pull {OLLAMA_MODEL}\n"
        f"Installed models: {installed_text}"
    )


def _stream_ollama_text(messages: List[dict]) -> Iterator[str]:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": 0.85,
            "top_p": 0.92,
        },
    }

    try:
        with httpx.Client(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            with client.stream("POST", OLLAMA_CHAT_URL, json=payload) as response:
                if response.status_code >= 400:
                    body = response.read().decode("utf-8", errors="replace")
                    if response.status_code == 404:
                        installed = _list_ollama_models()
                        raise HTTPException(
                            status_code=503,
                            detail=_model_missing_message(installed),
                        )
                    raise HTTPException(
                        status_code=502,
                        detail=f"Ollama error ({response.status_code}): {body}",
                    )

                for line in response.iter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if data.get("error"):
                        raise HTTPException(status_code=502, detail=data["error"])

                    piece = data.get("message", {}).get("content", "")
                    if piece:
                        yield piece

                    if data.get("done"):
                        return
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Cannot reach Ollama at {OLLAMA_BASE_URL}. "
                "Install Ollama, run `ollama pull llama3.2:3b`, and ensure `ollama serve` is running."
            ),
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="Ollama request timed out. Try a shorter message or check model load.",
        ) from exc


def stream_chat_events(user_message: str) -> Generator[str, None, None]:
    context = build_chat_context(user_message)
    collected: List[str] = []

    yield _ndjson_line({"start": True})

    try:
        for piece in _stream_ollama_text(context.to_ollama_messages()):
            collected.append(piece)
            yield _ndjson_line({"text": piece})

        reply = "".join(collected).strip()
        if not reply:
            reply = "I don't have a reply right now. Please try again."

        memory.append_exchange(context.trimmed_latest, reply)
        yield _ndjson_line({"done": True, "reply": reply})
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        yield _ndjson_line({"error": detail})
    except Exception as exc:
        yield _ndjson_line({"error": str(exc)})


@app.get("/health")
def health():
    try:
        installed = _list_ollama_models()
        model_ready = _model_is_available(OLLAMA_MODEL, installed)
        return {
            "status": "ok" if model_ready else "degraded",
            "ollama": "reachable",
            "base_url": OLLAMA_BASE_URL,
            "model": OLLAMA_MODEL,
            "model_ready": model_ready,
            "installed_models": installed,
            "memory_exchanges": memory.exchange_count(),
            "streaming": "ndjson",
            "hint": None
            if model_ready
            else f"Run: ollama pull {OLLAMA_MODEL}",
            "azure_tts": tts.tts_status(),
        }
    except Exception as exc:
        return {
            "status": "degraded",
            "ollama": "unreachable",
            "base_url": OLLAMA_BASE_URL,
            "model": OLLAMA_MODEL,
            "model_ready": False,
            "memory_exchanges": memory.exchange_count(),
            "detail": str(exc),
            "hint": "Start Ollama: ollama serve",
            "azure_tts": tts.tts_status(),
        }


@app.post("/chat")
def chat(body: ChatRequest):
    """Progressive stream over HTTP (application/x-ndjson)."""
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message cannot be empty")

    return StreamingResponse(
        stream_chat_events(message),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/tts")
def synthesize(body: TtsRequest):
    """Return MP3 audio for Azure Neural TTS."""
    style = body.style if body.style in ("default", "filler") else "default"
    audio = tts.synthesize_speech(body.text, style)
    return Response(content=audio, media_type="audio/mpeg")


@app.post("/chat/reset")
def reset_conversation():
    memory.clear()
    return {"status": "ok"}


@app.get("/chat/history")
def get_conversation_history():
    return {
        "exchanges_max": memory.MAX_EXCHANGES,
        "exchanges_stored": memory.exchange_count(),
        "messages": memory.get_history(),
    }
