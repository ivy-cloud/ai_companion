#!/usr/bin/env bash
# Start (or extend) a 20-hour improvement sprint and arm launchd ticks.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/docs/.improvement-sprint.json"
PYTHON="${ROOT}/ai-backend/.venv/bin/python"
SPRINT_HOURS="${IMPROVEMENT_SPRINT_HOURS:-20}"

if [[ ! -x "$PYTHON" ]]; then
  echo "missing $PYTHON — create ai-backend venv first" >&2
  exit 1
fi

started_iso="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ends_epoch="$(($(date +%s) + SPRINT_HOURS * 3600))"
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

export VOICE_LEARNING_MIN_IDLE_SEC=300
"$ROOT/scripts/install_idle_learning.sh"
"$ROOT/scripts/install_improvement_sprint_launchd.sh"

echo ""
echo "Sprint active until $ends_iso (UTC)"
echo "First tick runs immediately via launchd."
