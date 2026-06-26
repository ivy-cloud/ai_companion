#!/usr/bin/env bash
# Run Jessica voice learning when this Mac has been idle long enough.
# Safe to invoke hourly via launchd — skips if you're actively using the laptop.
# During improvement sprint: runs with --auto-apply and shorter lookback (no idle gate).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/ai-backend"
LOG="$ROOT/docs/voice-learning-idle.log"
PYTHON="${BACKEND}/.venv/bin/python"
SCRIPT="$ROOT/scripts/daily_voice_learning.py"
SPRINT_STATE="$ROOT/docs/.improvement-sprint.json"

# Minimum idle time before learning (seconds). Default 20 minutes.
MIN_IDLE_SEC="${VOICE_LEARNING_MIN_IDLE_SEC:-1200}"

# How far back to scan session_log per hourly run.
LOOKBACK_HOURS="${VOICE_LEARNING_LOOKBACK_HOURS:-6}"

mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

sprint_active() {
  if [[ "${VOICE_LEARNING_SPRINT:-0}" == "1" ]]; then
    return 0
  fi
  if [[ ! -f "$SPRINT_STATE" || ! -x "$PYTHON" ]]; then
    return 1
  fi
  "$PYTHON" - <<'PY' "$SPRINT_STATE"
import json, sys
from datetime import datetime, timezone
from pathlib import Path
p = Path(sys.argv[1])
try:
    data = json.loads(p.read_text())
    ends = datetime.fromisoformat(data["ends_at"].replace("Z", "+00:00"))
    if ends.tzinfo is None:
        ends = ends.replace(tzinfo=timezone.utc)
    sys.exit(0 if ends > datetime.now(timezone.utc) else 1)
except Exception:
    sys.exit(1)
PY
}

idle_seconds() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo 999999
    return
  fi
  local nanos
  nanos="$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print $NF; exit}' | tr -d ',')"
  if [[ -z "$nanos" || ! "$nanos" =~ ^[0-9]+$ ]]; then
    echo 0
    return
  fi
  echo $((nanos / 1000000000))
}

SPRINT_MODE=0
if sprint_active; then
  SPRINT_MODE=1
  LOOKBACK_HOURS="${VOICE_LEARNING_LOOKBACK_HOURS:-3}"
  log "sprint mode: skip idle check, lookback ${LOOKBACK_HOURS}h + auto-apply"
else
  idle="$(idle_seconds)"
  if (( idle < MIN_IDLE_SEC )); then
    log "skip: active (idle ${idle}s < ${MIN_IDLE_SEC}s min)"
    exit 0
  fi
  log "start: idle ${idle}s — scan last ${LOOKBACK_HOURS}h + deep doc pass"
fi

if [[ ! -x "$PYTHON" ]]; then
  log "skip: missing venv at $PYTHON"
  exit 1
fi

cd "$BACKEND"
if (( SPRINT_MODE == 1 )); then
  run_args=(--hours "$LOOKBACK_HOURS" --deep --auto-apply)
else
  run_args=(--hours "$LOOKBACK_HOURS" --deep)
fi
if "$PYTHON" "$SCRIPT" "${run_args[@]}" >>"$LOG" 2>&1; then
  log "done"
else
  log "error: script failed (see log)"
  exit 1
fi
