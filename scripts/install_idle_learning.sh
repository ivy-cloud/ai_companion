#!/usr/bin/env bash
# Install hourly idle voice learning (macOS launchd).
# Usage: ./scripts/install_idle_learning.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT/scripts/com.ivy.jessica-voice-learning.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.ivy.jessica-voice-learning.plist"
RUNNER="$ROOT/scripts/idle_voice_learning.sh"

chmod +x "$RUNNER"

sed "s|REPO_ROOT|$ROOT|g" "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)/com.ivy.jessica-voice-learning" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/com.ivy.jessica-voice-learning"
launchctl kickstart -k "gui/$(id -u)/com.ivy.jessica-voice-learning" 2>/dev/null || true

echo "Installed hourly idle learning."
echo "  Plist: $PLIST_DST"
echo "  Log:   $ROOT/docs/voice-learning-idle.log"
echo ""
echo "Tweak idle threshold (default 20 min):"
echo "  export VOICE_LEARNING_MIN_IDLE_SEC=900   # 15 min"
echo "  ./scripts/install_idle_learning.sh"
echo ""
echo "Uninstall:"
echo "  launchctl bootout gui/$(id -u)/com.ivy.jessica-voice-learning"
echo "  rm $PLIST_DST"
