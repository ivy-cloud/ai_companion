"""
Append-only session log for phone / Expo testing — one JSON object per line.

File: data/session_log.jsonl (gitignored via data/)

View on Mac:
  tail -f ai-backend/data/session_log.jsonl
  curl 'http://127.0.0.1:8000/debug/session-log?limit=30&format=text'
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional

_BACKEND_DIR = Path(__file__).resolve().parent
_LOG_PATH = _BACKEND_DIR / "data" / "session_log.jsonl"
_MAX_LINES = 500


def _enabled() -> bool:
    return os.environ.get("SESSION_LOG", "1").strip().lower() not in (
        "0",
        "false",
        "off",
        "no",
    )


def voice_http_enabled() -> bool:
    """Whether POST /debug/voice-log appends to session_log (backend log_voice is unaffected)."""
    return os.environ.get("SESSION_LOG_VOICE_HTTP", "1").strip().lower() not in (
        "0",
        "false",
        "off",
        "no",
    )


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log_path() -> Path:
    return _LOG_PATH


def _trim(text: str, limit: int = 2000) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


def log_turn(
    user_message: str,
    assistant_reply: str,
    *,
    route: str,
    duration_ms: Optional[int] = None,
    timezone_iana: Optional[str] = None,
    learn_updated: Optional[List[str]] = None,
    learn_conflicts: Optional[int] = None,
    profile_facts: Optional[dict[str, str]] = None,
    error: Optional[str] = None,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    if not _enabled():
        return

    entry: dict[str, Any] = {
        "ts": _utc_now(),
        "user": _trim(user_message),
        "reply": _trim(assistant_reply),
        "route": route,
    }
    if duration_ms is not None:
        entry["duration_ms"] = duration_ms
    if timezone_iana:
        entry["timezone"] = timezone_iana
    if learn_updated:
        entry["learn_updated"] = learn_updated
    if learn_conflicts:
        entry["learn_conflicts"] = learn_conflicts
    if profile_facts is not None:
        entry["profile_facts"] = profile_facts
    if error:
        entry["error"] = _trim(error, 500)
    if extra:
        entry["extra"] = extra

    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _trim_file()


def log_voice(
    event: str,
    *,
    detail: Optional[dict[str, Any]] = None,
    platform: Optional[str] = None,
) -> None:
    """Frontend voice/TTS events (playback, enqueue, echo)."""
    if not _enabled():
        return
    entry: dict[str, Any] = {
        "ts": _utc_now(),
        "type": "voice",
        "event": _trim(event, 120),
    }
    if detail:
        entry["detail"] = detail
    if platform:
        entry["platform"] = platform
    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _trim_file()


def log_stt(
    transcript: str,
    *,
    filename: str = "",
    error: Optional[str] = None,
) -> None:
    if not _enabled():
        return
    entry: dict[str, Any] = {
        "ts": _utc_now(),
        "type": "stt",
        "transcript": _trim(transcript, 800),
        "filename": filename or None,
    }
    if error:
        entry["error"] = _trim(error, 500)
    _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _trim_file()


def _trim_file() -> None:
    if not _LOG_PATH.is_file():
        return
    try:
        lines = _LOG_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    if len(lines) <= _MAX_LINES:
        return
    keep = lines[-_MAX_LINES:]
    _LOG_PATH.write_text("\n".join(keep) + "\n", encoding="utf-8")


def read_entries(limit: int = 50, entry_type: Optional[str] = None) -> List[dict[str, Any]]:
    if not _LOG_PATH.is_file() or limit <= 0:
        return []
    try:
        lines = _LOG_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: List[dict[str, Any]] = []
    scan = lines[-max(limit * 20, limit) :] if entry_type else lines[-limit:]
    for line in reversed(scan):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry_type and entry.get("type") != entry_type:
            continue
        out.append(entry)
        if len(out) >= limit:
            break
    out.reverse()
    return out


def format_entries_text(entries: List[dict[str, Any]]) -> str:
    if not entries:
        return "(empty session log)\n"
    blocks: List[str] = []
    for i, e in enumerate(entries, 1):
        ts = e.get("ts", "?")
        if e.get("type") == "stt":
            blocks.append(
                f"--- {i} [{ts}] STT ---\n"
                f"  transcript: {e.get('transcript', '')}\n"
                f"  error: {e.get('error') or '-'}\n"
            )
            continue
        if e.get("type") == "voice":
            detail = e.get("detail") or {}
            parts = ", ".join(f"{k}={v}" for k, v in detail.items())
            blocks.append(f"--- {i} [{ts}] VOICE {e.get('event', '?')} ---")
            if parts:
                blocks.append(f"  {parts}")
            blocks.append("")
            continue
        route = e.get("route", "?")
        dur = e.get("duration_ms")
        dur_s = f" ({dur} ms)" if dur is not None else ""
        blocks.append(f"--- {i} [{ts}] route={route}{dur_s} ---")
        blocks.append(f"YOU: {e.get('user', '')}")
        blocks.append(f"AI:  {e.get('reply', '')}")
        if e.get("learn_updated"):
            blocks.append(f"  learned: {e.get('learn_updated')}")
        if e.get("learn_conflicts"):
            blocks.append(f"  conflicts: {e.get('learn_conflicts')}")
        if e.get("profile_facts"):
            blocks.append(f"  profile: {e.get('profile_facts')}")
        if e.get("error"):
            blocks.append(f"  error: {e.get('error')}")
        blocks.append("")
    return "\n".join(blocks)


def clear() -> None:
    if _LOG_PATH.is_file():
        _LOG_PATH.unlink()


def status() -> dict[str, Any]:
    count = 0
    if _LOG_PATH.is_file():
        try:
            count = sum(1 for _ in _LOG_PATH.open(encoding="utf-8"))
        except OSError:
            count = 0
    return {
        "enabled": _enabled(),
        "voice_http": voice_http_enabled(),
        "path": str(_LOG_PATH),
        "exists": _LOG_PATH.is_file(),
        "lines": count,
        "max_lines": _MAX_LINES,
    }
