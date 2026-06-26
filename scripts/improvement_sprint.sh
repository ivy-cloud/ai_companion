#!/usr/bin/env bash
# 20-hour autonomous improvement sprint — voice learning every 45 minutes.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/docs/.improvement-sprint.json"
PIDFILE="$ROOT/docs/.improvement-sprint.pid"
LOG="$ROOT/docs/improvement-sprint.log"
CYCLE="$ROOT/scripts/improvement_sprint_cycle.py"
PYTHON="${ROOT}/ai-backend/.venv/bin/python"
SPRINT_HOURS=20
CYCLE_INTERVAL_SEC=$((45 * 60))

export VOICE_LEARNING_SPRINT=1

if [[ ! -x "$PYTHON" ]]; then
  echo "missing $PYTHON" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

sprint_active_in_state() {
  if [[ ! -f "$STATE" ]]; then
    return 1
  fi
  "$PYTHON" - <<'PY' "$STATE"
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

if [[ -f "$PIDFILE" ]]; then
  old_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "$old_pid" && "$old_pid" != "$$" ]] && kill -0 "$old_pid" 2>/dev/null; then
    log "skip: sprint already running (pid $old_pid)"
    exit 0
  fi
fi

echo $$ > "$PIDFILE"

if sprint_active_in_state; then
  ends_iso="$("$PYTHON" - <<'PY' "$STATE"
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
print(data["ends_at"])
PY
)"
  cycles="$("$PYTHON" - <<'PY' "$STATE"
import json, sys
from pathlib import Path
data = json.loads(Path(sys.argv[1]).read_text())
print(int(data.get("cycles_run", 0)))
PY
)"
  ends_epoch="$("$PYTHON" - <<'PY' "$ends_iso"
import sys
from datetime import datetime, timezone
ends = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
print(int(ends.timestamp()))
PY
)"
  log "sprint resume: ends_at=$ends_iso cycles_done=$cycles (pid $$)"
else
  started_epoch="$(date +%s)"
  ends_epoch=$((started_epoch + SPRINT_HOURS * 3600))
  started_iso="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  ends_iso="$(date -u -r "$ends_epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d "@$ends_epoch" '+%Y-%m-%dT%H:%M:%SZ')"

  "$PYTHON" - <<PY
import json
from pathlib import Path
Path("$STATE").write_text(json.dumps({
    "started_at": "$started_iso",
    "ends_at": "$ends_iso",
    "cycles_run": 0,
}, indent=2) + "\n")
PY

  cycles=0
  log "sprint start: ends_at=$ends_iso (pid $$)"
  VOICE_LEARNING_MIN_IDLE_SEC=300 "$ROOT/scripts/install_idle_learning.sh" >>"$LOG" 2>&1 || log "warn: install_idle_learning failed"
fi

while true; do
  now_epoch="$(date +%s)"
  if (( now_epoch >= ends_epoch )); then
    log "sprint complete after ${cycles} cycle(s)"
    break
  fi

  cycles=$((cycles + 1))
  log "cycle $cycles begin"
  if "$PYTHON" "$CYCLE" >>"$LOG" 2>&1; then
    log "cycle $cycles done (ok)"
  else
    log "cycle $cycles done (failed — see journal)"
  fi

  "$PYTHON" - <<PY
import json
from pathlib import Path
p = Path("$STATE")
data = json.loads(p.read_text())
data["cycles_run"] = $cycles
p.write_text(json.dumps(data, indent=2) + "\n")
PY

  now_epoch="$(date +%s)"
  if (( now_epoch >= ends_epoch )); then
    break
  fi
  sleep_for=$((CYCLE_INTERVAL_SEC))
  remaining=$((ends_epoch - now_epoch))
  if (( sleep_for > remaining )); then
    sleep_for=$remaining
  fi
  log "sleep ${sleep_for}s until next cycle"
  sleep "$sleep_for"
done

rm -f "$PIDFILE"
log "sprint runner exited"
