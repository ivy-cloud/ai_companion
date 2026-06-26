#!/usr/bin/env python3
"""One improvement sprint cycle: voice learning, test gate, journal."""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "ai-backend"
PYTHON = BACKEND / ".venv" / "bin" / "python"
LEARNING = ROOT / "scripts" / "daily_voice_learning.py"
HUMAN_SPEECH = BACKEND / "human_speech.py"
SPRINT_JOURNAL = ROOT / "docs" / "improvement-sprint-journal.md"


def _git_human_speech_hash() -> str:
    r = subprocess.run(
        ["git", "rev-parse", "HEAD:ai-backend/human_speech.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return r.stdout.strip() if r.returncode == 0 else ""


def _file_hash() -> str:
    if not HUMAN_SPEECH.is_file():
        return ""
    import hashlib

    return hashlib.sha256(HUMAN_SPEECH.read_bytes()).hexdigest()


def _run_learning() -> tuple[int, str]:
    if not PYTHON.is_file():
        return 1, "missing venv python"
    proc = subprocess.run(
        [str(PYTHON), str(LEARNING), "--hours", "8", "--deep", "--auto-apply"],
        cwd=BACKEND,
        capture_output=True,
        text=True,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out.strip()


def _run_tests() -> tuple[int, str]:
    proc = subprocess.run(
        [str(PYTHON), "-m", "unittest", "discover", "-q"],
        cwd=BACKEND,
        capture_output=True,
        text=True,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out.strip()


def _revert_human_speech() -> None:
    subprocess.run(
        ["git", "checkout", "--", "ai-backend/human_speech.py"],
        cwd=ROOT,
        check=False,
    )


def _append_journal(
    *,
    ok: bool,
    learning_rc: int,
    applied_changed: bool,
    tests_rc: int | None,
    reverted: bool,
    excerpt: str,
) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    status = "ok" if ok else "failed"
    lines = [
        f"\n## Cycle {now}\n\n",
        f"- **Status:** {status}\n",
        f"- **Voice learning exit:** {learning_rc}\n",
        f"- **human_speech.py changed:** {applied_changed}\n",
    ]
    if applied_changed:
        lines.append(f"- **Tests exit:** {tests_rc}\n")
        lines.append(f"- **Reverted on test failure:** {reverted}\n")
    if excerpt:
        lines.append("\n```\n")
        lines.append(excerpt[-4000:] if len(excerpt) > 4000 else excerpt)
        if not excerpt.endswith("\n"):
            lines.append("\n")
        lines.append("```\n")

    SPRINT_JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    if not SPRINT_JOURNAL.is_file():
        SPRINT_JOURNAL.write_text(
            "# Improvement sprint journal\n\nAutonomous voice-learning cycles during 20h sprints.\n",
            encoding="utf-8",
        )
    with SPRINT_JOURNAL.open("a", encoding="utf-8") as fh:
        fh.writelines(lines)


def main() -> int:
    before = _file_hash()
    learning_rc, learning_out = _run_learning()
    after = _file_hash()
    changed = before != after and before != ""

    ok = learning_rc == 0
    tests_rc: int | None = None
    reverted = False
    test_out = ""

    if learning_rc != 0:
        ok = False
    elif changed:
        tests_rc, test_out = _run_tests()
        if tests_rc != 0:
            _revert_human_speech()
            reverted = True
            ok = False

    excerpt = learning_out
    if test_out:
        excerpt = f"{learning_out}\n\n--- tests ---\n{test_out}"

    _append_journal(
        ok=ok,
        learning_rc=learning_rc,
        applied_changed=changed,
        tests_rc=tests_rc,
        reverted=reverted,
        excerpt=excerpt,
    )

    if ok:
        print("Cycle OK")
        if changed and not reverted:
            print("human_speech.py updated and tests passed")
        return 0
    print("Cycle FAILED", file=sys.stderr)
    if reverted:
        print("Reverted human_speech.py after test failure", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
