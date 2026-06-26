#!/usr/bin/env bash
# Install hourly idle voice learning (macOS launchd).
# Usage: ./scripts/install_idle_learning.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$ROOT/scripts/com.ivy.jessica-voice-learning.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.ivy.jessica-voice-learning.plist"
RUNNER="$ROOT/scripts/idle_voice_learning.sh"
MIN_IDLE_SEC="${VOICE_LEARNING_MIN_IDLE_SEC:-1200}"
LOOKBACK_HOURS="${VOICE_LEARNING_LOOKBACK_HOURS:-6}"

chmod +x "$RUNNER"

sed -e "s|REPO_ROOT|$ROOT|g" \
    -e "s|REPO_MIN_IDLE_SEC|$MIN_IDLE_SEC|g" \
    "$PLIST_SRC" > "$PLIST_DST"

# Inject lookback into plist EnvironmentVariables (rewrite whole dict block is fragile; use PlistBuddy)
/usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:VOICE_LEARNING_LOOKBACK_HOURS $LOOKBACK_HOURS" "$PLIST_DST" 2>/dev/null || true

launchctl bootout "gui/$(id -u)/com.ivy.jessica-voice-learning" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/com.ivy.jessica-voice-learning"
launchctl kickstart -k "gui/$(id -u)/com.ivy.jessica-voice-learning" 2>/dev/null || true

echo "Installed hourly idle learning."
echo "  Plist: $PLIST_DST"
echo "  Log:   $ROOT/docs/voice-learning-idle.log"
echo "  MIN_IDLE_SEC=$MIN_IDLE_SEC LOOKBACK_HOURS=$LOOKBACK_HOURS"
echo ""
echo "Tweak idle threshold (default 20 min):"
echo "  export VOICE_LEARNING_MIN_IDLE_SEC=900   # 15 min"
echo "  ./scripts/install_idle_learning.sh"
echo ""
echo "Uninstall:"
echo "  launchctl bootout gui/$(id -u)/com.ivy.jessica-voice-learning"
echo "  rm $PLIST_DST"
