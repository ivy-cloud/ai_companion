#!/usr/bin/env bash
# Run Jessica voice learning when this Mac has been idle long enough.
# Safe to invoke hourly via launchd — skips if you're actively using the laptop.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/ai-backend"
LOG="$ROOT/docs/voice-learning-idle.log"
PYTHON="${BACKEND}/.venv/bin/python"
SCRIPT="$ROOT/scripts/daily_voice_learning.py"

# Minimum idle time before learning (seconds). Default 20 minutes.
MIN_IDLE_SEC="${VOICE_LEARNING_MIN_IDLE_SEC:-1200}"

# How far back to scan session_log per hourly run.
LOOKBACK_HOURS="${VOICE_LEARNING_LOOKBACK_HOURS:-6}"

mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
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

idle="$(idle_seconds)"
if (( idle < MIN_IDLE_SEC )); then
  log "skip: active (idle ${idle}s < ${MIN_IDLE_SEC}s min)"
  exit 0
fi

if [[ ! -x "$PYTHON" ]]; then
  log "skip: missing venv at $PYTHON"
  exit 1
fi

log "start: idle ${idle}s — scan last ${LOOKBACK_HOURS}h + deep doc pass"
cd "$BACKEND"
if "$PYTHON" "$SCRIPT" --hours "$LOOKBACK_HOURS" --deep >>"$LOG" 2>&1; then
  log "done"
else
  log "error: script failed (see log)"
  exit 1
fi
