"""
LLM backends: local Ollama or Groq (OpenAI-compatible, fast cloud).

Set LLM_PROVIDER=groq|ollama in ai-backend/.env
"""

from __future__ import annotations

import json
import os
from typing import Iterator, List, Optional

import httpx
from fastapi import HTTPException

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"

GROQ_API_BASE = os.environ.get("GROQ_API_BASE", "https://api.groq.com/openai/v1").rstrip("/")
GROQ_CHAT_URL = f"{GROQ_API_BASE}/chat/completions"
# Fast + good short replies for voice. Alternative: llama-3.3-70b-versatile
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")


def llm_provider() -> str:
    return os.environ.get("LLM_PROVIDER", "ollama").strip().lower()


def active_model() -> str:
    import dev_mode

    if dev_mode.mock_llm_enabled():
        return "dev-mock-llm"
    return GROQ_MODEL if llm_provider() == "groq" else OLLAMA_MODEL


def groq_configured() -> bool:
    key = os.environ.get("GROQ_API_KEY", "").strip()
    return bool(key) and key not in ("", "your_groq_api_key", "changeme")


def _chat_options(*, factual: bool) -> dict:
    if llm_provider() == "groq":
        return {
            "temperature": 0.5 if factual else 0.88,
            "max_tokens": 64 if factual else 120,
            "top_p": 0.92,
        }
    return {
        "temperature": 0.7 if factual else 0.84,
        "top_p": 0.9,
        "repeat_penalty": 1.08,
        "num_predict": 64 if factual else 120,
    }


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


def model_missing_message(installed: List[str]) -> str:
    if llm_provider() == "groq":
        if not groq_configured():
            return (
                "Groq is selected but GROQ_API_KEY is missing. "
                "Get a key at https://console.groq.com/keys and set it in ai-backend/.env"
            )
        return f"Groq model '{GROQ_MODEL}' — check https://console.groq.com/docs/models"
    installed_text = ", ".join(installed) if installed else "(none — run ollama pull)"
    return (
        f"Ollama model '{OLLAMA_MODEL}' is not installed. "
        f"Run: ollama pull {OLLAMA_MODEL}\n"
        f"Installed models: {installed_text}"
    )


def check_model_ready() -> tuple[bool, Optional[str], List[str]]:
    """Returns (ready, hint, installed_models_for_ollama)."""
    import dev_mode

    if dev_mode.mock_llm_enabled():
        return True, "DEV_MOCK_LLM=1 (no Groq/Ollama)", []
    if llm_provider() == "groq":
        if not groq_configured():
            return False, model_missing_message([]), []
        return True, None, []
    installed = _list_ollama_models()
    ready = _model_is_available(OLLAMA_MODEL, installed)
    hint = None if ready else model_missing_message(installed)
    return ready, hint, installed


def _stream_ollama(messages: List[dict], *, factual: bool) -> Iterator[str]:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "options": _chat_options(factual=factual),
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(180.0, connect=10.0)) as client:
            with client.stream("POST", OLLAMA_CHAT_URL, json=payload) as response:
                if response.status_code >= 400:
                    body = response.read().decode("utf-8", errors="replace")
                    if response.status_code == 404:
                        installed = _list_ollama_models()
                        raise HTTPException(
                            status_code=503,
                            detail=model_missing_message(installed),
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
                f"Run `ollama serve` or set LLM_PROVIDER=groq in .env."
            ),
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail="Ollama request timed out. Try LLM_PROVIDER=groq or a smaller model.",
        ) from exc


def _stream_groq(messages: List[dict], *, factual: bool) -> Iterator[str]:
    if not groq_configured():
        raise HTTPException(status_code=503, detail=model_missing_message([]))

    opts = _chat_options(factual=factual)
    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "stream": True,
        "temperature": opts["temperature"],
        "max_tokens": opts["max_tokens"],
        "top_p": opts["top_p"],
    }
    headers = {
        "Authorization": f"Bearer {os.environ['GROQ_API_KEY'].strip()}",
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            with client.stream("POST", GROQ_CHAT_URL, json=payload, headers=headers) as response:
                if response.status_code >= 400:
                    body = response.read().decode("utf-8", errors="replace")
                    raise HTTPException(
                        status_code=502,
                        detail=f"Groq error ({response.status_code}): {body[:500]}",
                    )
                for line in response.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    chunk = line[6:].strip()
                    if chunk == "[DONE]":
                        return
                    try:
                        data = json.loads(chunk)
                    except json.JSONDecodeError:
                        continue
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    piece = delta.get("content", "")
                    if piece:
                        yield piece
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail="Cannot reach Groq API. Check network or LLM_PROVIDER=ollama.",
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Groq request timed out.") from exc


def stream_chat_text(messages: List[dict], *, factual: bool = False) -> Iterator[str]:
    import dev_mode

    if dev_mode.mock_llm_enabled():
        yield from dev_mode.mock_stream_chat_text(messages, factual=factual)
        return
    if llm_provider() == "groq":
        yield from _stream_groq(messages, factual=factual)
    else:
        yield from _stream_ollama(messages, factual=factual)


def complete_chat(messages: List[dict], *, temperature: float = 0.1, max_tokens: int = 80) -> Optional[str]:
    """Non-streaming completion (grounding pass)."""
    import dev_mode

    if dev_mode.mock_llm_enabled():
        return dev_mode.mock_complete_chat(messages, factual=temperature < 0.6)
    if llm_provider() == "groq":
        if not groq_configured():
            return None
        payload = {
            "model": GROQ_MODEL,
            "messages": messages,
            "stream": False,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": 0.85,
        }
        headers = {
            "Authorization": f"Bearer {os.environ['GROQ_API_KEY'].strip()}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=httpx.Timeout(45.0, connect=10.0)) as client:
                response = client.post(GROQ_CHAT_URL, json=payload, headers=headers)
                if response.status_code >= 400:
                    return None
                data = response.json()
                return str(data.get("choices", [{}])[0].get("message", {}).get("content", "")).strip()
        except Exception:
            return None

    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature, "top_p": 0.85},
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
            response = client.post(OLLAMA_CHAT_URL, json=payload)
            if response.status_code >= 400:
                return None
            data = response.json()
            return str(data.get("message", {}).get("content", "")).strip()
    except Exception:
        return None
