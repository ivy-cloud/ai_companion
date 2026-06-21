#!/usr/bin/env python3
"""
Daily Jessica voice learning — scan recent session_log turns for AI-like replies.

Appends findings to docs/voice-learning-journal.md and prints suggested rule additions.
Optional --auto-apply adds high-confidence missing phrases to human_speech.py BANNED_PHRASES.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "ai-backend"
SESSION_LOG = BACKEND / "data" / "session_log.jsonl"
JOURNAL = ROOT / "docs" / "voice-learning-journal.md"

# Patterns that read assistant/therapist/cheerleader (not already perfect bans).
_AI_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("cheerleader_platitude", re.compile(r"\b(?:never too late|you(?:'ve| have) got this|everything happens for a reason|that's (?:really |so )?(?:cool|amazing|awesome))\b", re.I)),
    ("therapist_probe", re.compile(r"\b(?:what(?:'s| is) making you feel|being (?:a bit )?hard on yourself|i hear that you|it sounds like you(?:'re| are)|that must be)\b", re.I)),
    ("assistant_opener", re.compile(r"\b(?:how can i help|glad we connected|thank you for (?:sharing|reaching out)|is there anything else|i(?:'m| am) here to help)\b", re.I)),
    ("fix_it_list", re.compile(r"\b(?:you could try|maybe you could|here are some|you might want to|have you considered|grab a drink|listen to (?:some )?calm music)\b", re.I)),
    ("robotic_callback", re.compile(r"\byou said you (?:were|are)\b", re.I)),
    ("hollow_praise", re.compile(r"\b(?:i(?:'m| am) so glad you shared|great question|good question)\b", re.I)),
]

_NEAR_MISS = re.compile(
    r"\b(?:too late for anything|being hard on|making you feel|really cool|glad we)\b",
    re.I,
)

_MAX_REPLY_WORDS = 45

# High-confidence session-log patterns → BANNED_PHRASES entries (lowercase).
_AUTO_BAN_PHRASES: dict[str, list[str]] = {
    "fix_it_list": [
        "grab a drink",
        "listen to some calm music",
        "listen to calm music",
        "wind down a bit",
    ],
    "cheerleader_platitude": [
        "you've got this",
        "everything happens for a reason",
        "it's never too late",
    ],
    "therapist_probe": [
        "what's making you feel",
        "being hard on yourself",
    ],
    "assistant_opener": [
        "i'm glad we connected",
        "how's your day going so far",
    ],
    "robotic_callback": [
        "you said you were",
    ],
}


def _parse_ts(raw: str) -> datetime | None:
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_turns(*, hours: float = 24.0, limit: int = 200) -> list[dict]:
    if not SESSION_LOG.is_file():
        return []
    cutoff: datetime | None = None
    if hours > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    turns: list[dict] = []
    lines = SESSION_LOG.read_text(encoding="utf-8").splitlines()
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "user" not in entry or "reply" not in entry:
            continue
        ts = _parse_ts(str(entry.get("ts", "")))
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts and ts < cutoff:
            continue
        turns.append(entry)
        if len(turns) >= limit:
            break
    turns.reverse()
    return turns


def analyze_turn(entry: dict) -> list[dict]:
    user = str(entry.get("user", "")).strip()
    reply = str(entry.get("reply", "")).strip()
    if not user or not reply:
        return []

    findings: list[dict] = []
    lower = reply.lower()
    word_count = len(reply.split())

    for label, pattern in _AI_PATTERNS:
        if pattern.search(reply):
            findings.append({"kind": label, "user": user, "reply": reply})

    if word_count > _MAX_REPLY_WORDS:
        findings.append(
            {
                "kind": "long_reply",
                "user": user,
                "reply": reply,
                "detail": f"{word_count} words (cap {_MAX_REPLY_WORDS})",
            }
        )

    if _NEAR_MISS.search(reply):
        findings.append({"kind": "banned_near_miss", "user": user, "reply": reply})

    advice_ask = re.search(
        r"\b(?:what should i|what do i do|any ideas|how should i)\b", user, re.I
    )
    if not advice_ask and re.search(
        r"\b(?:you could try|maybe you could|here are some)\b", reply, re.I
    ):
        findings.append({"kind": "unsolicited_advice_list", "user": user, "reply": reply})

    return findings


def suggest_rules(findings: list[dict]) -> list[str]:
    kinds = {f["kind"] for f in findings}
    suggestions: list[str] = []
    if "cheerleader_platitude" in kinds or "banned_near_miss" in kinds:
        suggestions.append(
            "Add platitude/cheerleader phrase to BANNED_PHRASES + _tame_enthusiasm in human_speech.py"
        )
    if "therapist_probe" in kinds:
        suggestions.append(
            "Strengthen acknowledgment_turn_hint or add therapist phrase to BANNED_PHRASES"
        )
    if "fix_it_list" in kinds or "unsolicited_advice_list" in kinds:
        suggestions.append(
            "Extend vent_turn_hint / think_through_turn_hint — no fix-it unless is_advice_seeking"
        )
    if "assistant_opener" in kinds:
        suggestions.append("Review session_opening_line templates in companion_moments.py")
    if "robotic_callback" in kinds:
        suggestions.append("Ban 'you said you were' callbacks on greeting turns")
    if "long_reply" in kinds:
        suggestions.append("Check MAX_REPLY_WORDS enforcement in trim_for_voice / turn hints")
    if "hollow_praise" in kinds:
        suggestions.append("Add hollow praise variants to BANNED_PHRASES")
    return suggestions


def auto_apply_bans(findings: list[dict]) -> list[str]:
    """Append missing high-confidence phrases to human_speech.py BANNED_PHRASES."""
    human_speech = BACKEND / "human_speech.py"
    if not human_speech.is_file():
        return []

    text = human_speech.read_text(encoding="utf-8")
    kinds = {f["kind"] for f in findings}
    to_add: list[str] = []
    for kind in kinds:
        for phrase in _AUTO_BAN_PHRASES.get(kind, []):
            if phrase.lower() not in text.lower():
                to_add.append(phrase)

    if not to_add:
        return []

    marker = ")\n\nMAX_REPLY_WORDS"
    if marker not in text:
        return []

    insert = "".join(f'    "{p}",\n' for p in to_add)
    updated = text.replace(marker, f"{insert})\n\nMAX_REPLY_WORDS", 1)
    human_speech.write_text(updated, encoding="utf-8")
    return to_add


def pick_learning_doc(*, hour: int) -> Path | None:
    """Rotate through competitor / natural-chat docs for deep idle sessions."""
    docs = sorted((ROOT / "docs").glob("*-learnings.md"))
    natural = ROOT / "docs" / "natural-human-chat.md"
    pool = [natural] + [d for d in docs if d != natural]
    if not pool:
        return None
    return pool[hour % len(pool)]


def deep_learning_note(doc_path: Path) -> str:
    """One doc per run — prompt human/agent to cross-check rules vs doc."""
    name = doc_path.name
    try:
        text = doc_path.read_text(encoding="utf-8")
    except OSError:
        return f"_Could not read {name}_\n"
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    sample = "\n".join(f"- {ln.lstrip('- ')}" for ln in lines[:8] if not ln.startswith("#"))
    return (
        f"**Deep pass — review `{name}`** against `human_speech.py` / turn hints.\n"
        f"Sample bullets from doc:\n{sample}\n"
        f"_Full file: docs/{name}_\n"
    )


def append_journal(
    date_str: str,
    findings: list[dict],
    suggestions: list[str],
    *,
    deep_note: str = "",
    applied: list[str] | None = None,
) -> None:
    JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    if not JOURNAL.is_file():
        JOURNAL.write_text(
            "# Jessica voice learning journal\n\n"
            "Auto-appended by `scripts/daily_voice_learning.py`. "
            "Review before editing `human_speech.py`.\n\n",
            encoding="utf-8",
        )

    lines = [f"\n## {date_str}\n"]
    if not findings:
        lines.append("_No AI-like patterns in recent session_log turns._\n")
    else:
        lines.append(f"**{len(findings)} finding(s)** from recent phone sessions:\n")
        for i, f in enumerate(findings, 1):
            kind = f["kind"]
            user = f["user"][:120]
            reply = f["reply"][:200]
            detail = f.get("detail", "")
            extra = f" ({detail})" if detail else ""
            lines.append(f"{i}. **{kind}**{extra}\n")
            lines.append(f"   - User: \"{user}\"\n")
            lines.append(f"   - Reply: \"{reply}\"\n")

    if applied:
        lines.append("\n**Auto-applied to `human_speech.py` BANNED_PHRASES:**\n")
        for p in applied:
            lines.append(f"- `{p}`\n")

    if suggestions:
        lines.append("\n**Suggested rule additions (review first):**\n")
        for s in suggestions:
            lines.append(f"- {s}\n")

    if deep_note:
        lines.append(f"\n{deep_note}\n")

    with JOURNAL.open("a", encoding="utf-8") as fh:
        fh.writelines(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan session_log for AI-like Jessica replies")
    parser.add_argument("--hours", type=float, default=24.0, help="Look back N hours (default 24)")
    parser.add_argument("--limit", type=int, default=200, help="Max turns to scan")
    parser.add_argument("--dry-run", action="store_true", help="Print only; do not append journal")
    parser.add_argument(
        "--deep",
        action="store_true",
        help="Also append one rotated doc review note (competitor / natural-human-chat)",
    )
    parser.add_argument("--date", type=str, default="", help="Journal date YYYY-MM-DD (default today)")
    parser.add_argument(
        "--auto-apply",
        action="store_true",
        help="Add high-confidence missing phrases to human_speech.py BANNED_PHRASES",
    )
    args = parser.parse_args()

    turns = load_turns(hours=args.hours, limit=args.limit)
    all_findings: list[dict] = []
    for entry in turns:
        all_findings.extend(analyze_turn(entry))

    suggestions = suggest_rules(all_findings)
    now = datetime.now()
    date_str = args.date.strip() or now.strftime("%Y-%m-%d")
    applied: list[str] = []
    if args.auto_apply and not args.dry_run:
        applied = auto_apply_bans(all_findings)
        if applied:
            print(f"\nAuto-applied {len(applied)} phrase(s) to human_speech.py")
    deep_note = ""
    if args.deep:
        doc = pick_learning_doc(hour=now.hour)
        if doc:
            deep_note = deep_learning_note(doc)
            print(f"\nDeep pass doc: {doc.name}")

    print(f"Scanned {len(turns)} turn(s) from {SESSION_LOG}")
    print(f"Found {len(all_findings)} AI-like pattern(s)")
    for f in all_findings:
        print(f"  [{f['kind']}] user={f['user'][:60]!r} → {f['reply'][:80]!r}")
    if suggestions:
        print("\nSuggested rule additions:")
        for s in suggestions:
            print(f"  - {s}")
    else:
        print("\nNo new rule suggestions.")

    if not args.dry_run:
        append_journal(
            date_str,
            all_findings,
            suggestions,
            deep_note=deep_note,
            applied=applied or None,
        )
        print(f"\nAppended to {JOURNAL}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
