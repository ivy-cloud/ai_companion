#!/usr/bin/env bash
# One improvement-sprint cycle — safe for launchd (no long sleep).
# Skips quietly when no active sprint (ends_at in the past or missing).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/docs/.improvement-sprint.json"
LOG="$ROOT/docs/improvement-sprint.log"
CYCLE="$ROOT/scripts/improvement_sprint_cycle.py"
PYTHON="${ROOT}/ai-backend/.venv/bin/python"

export VOICE_LEARNING_SPRINT=1

mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

if [[ ! -x "$PYTHON" ]]; then
  log "tick skip: missing $PYTHON"
  exit 1
fi

if [[ ! -f "$STATE" ]]; then
  log "tick skip: no sprint state ($STATE)"
  exit 0
fi

active="$("$PYTHON" - <<'PY' "$STATE"
import json, sys
from datetime import datetime, timezone
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text())
    ends = datetime.fromisoformat(data["ends_at"].replace("Z", "+00:00"))
    if ends.tzinfo is None:
        ends = ends.replace(tzinfo=timezone.utc)
    print("yes" if ends > datetime.now(timezone.utc) else "no")
except Exception:
    print("no")
PY
)"

if [[ "$active" != "yes" ]]; then
  log "tick skip: sprint ended or invalid state"
  exit 0
fi

cycles="$("$PYTHON" - <<'PY' "$STATE"
import json, sys
from pathlib import Path
print(int(json.loads(Path(sys.argv[1]).read_text()).get("cycles_run", 0)))
PY
)"
next=$((cycles + 1))
log "tick cycle $next begin"

if "$PYTHON" "$CYCLE" >>"$LOG" 2>&1; then
  log "tick cycle $next done (ok)"
else
  log "tick cycle $next done (failed — see journal)"
fi

"$PYTHON" - <<PY
import json
from pathlib import Path
p = Path("$STATE")
data = json.loads(p.read_text())
data["cycles_run"] = $next
p.write_text(json.dumps(data, indent=2) + "\n")
PY
