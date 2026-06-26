#!/usr/bin/env bash
# Install 45-minute improvement sprint ticks (macOS launchd).
# Usage: ./scripts/install_improvement_sprint_launchd.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT/scripts/com.ivy.jessica-improvement-sprint.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.ivy.jessica-improvement-sprint.plist"
TICK="$ROOT/scripts/improvement_sprint_tick.sh"

chmod +x "$TICK" "$ROOT/scripts/improvement_sprint_cycle.py"

sed "s|REPO_ROOT|$ROOT|g" "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)/com.ivy.jessica-improvement-sprint" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/com.ivy.jessica-improvement-sprint"
launchctl kickstart -k "gui/$(id -u)/com.ivy.jessica-improvement-sprint" 2>/dev/null || true

echo "Installed improvement sprint ticks (every 45 min while sprint active)."
echo "  Plist: $PLIST_DST"
echo "  Log:   $ROOT/docs/improvement-sprint.log"
echo ""
echo "Start a new 20h window:"
echo "  ./scripts/start_improvement_sprint.sh"
