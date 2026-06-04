#!/usr/bin/env bash
# Start FastAPI on LAN and sync EXPO_PUBLIC_API_BASE to this Mac's Wi‑Fi IP.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_ENV="$ROOT/ai-frontend/.env"
PORT="${PORT:-8000}"

detect_lan_ip() {
  local iface ip
  for iface in en0 en1; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  done
  return 1
}

write_frontend_env() {
  local api_base="http://${1}:${PORT}"
  mkdir -p "$(dirname "$FRONTEND_ENV")"

  if [[ -f "$FRONTEND_ENV" ]] && grep -q '^EXPO_PUBLIC_API_BASE=' "$FRONTEND_ENV"; then
    if [[ "$(uname)" == Darwin ]]; then
      sed -i '' "s|^EXPO_PUBLIC_API_BASE=.*|EXPO_PUBLIC_API_BASE=${api_base}|" "$FRONTEND_ENV"
    else
      sed -i "s|^EXPO_PUBLIC_API_BASE=.*|EXPO_PUBLIC_API_BASE=${api_base}|" "$FRONTEND_ENV"
    fi
  else
    printf 'EXPO_PUBLIC_API_BASE=%s\n' "$api_base" >"$FRONTEND_ENV"
  fi

  echo "→ EXPO_PUBLIC_API_BASE=${api_base}"
  echo "  (ai-frontend/.env — reload Expo with: npx expo start --clear)"
}

if [[ "${DEV_LOCAL_FRONTEND:-}" == "1" ]]; then
  write_frontend_env "127.0.0.1"
  echo "→ Dev mode: frontend uses localhost (phone Expo Go needs LAN IP instead)"
elif LAN_IP="$(detect_lan_ip || true)"; [[ -n "$LAN_IP" ]]; then
  write_frontend_env "$LAN_IP"
else
  echo "⚠ Could not read LAN IP from en0/en1 (ipconfig getifaddr)."
  echo "  Set EXPO_PUBLIC_API_BASE manually in ai-frontend/.env"
  echo "  Or: DEV_LOCAL_FRONTEND=1 ./start.sh for http://127.0.0.1:8000"
fi

if [[ "${DEV_MOCK_LLM:-}" == "1" || "${DEV_MOCK_TTS:-}" == "1" || "${DEV_MOCK_STT:-}" == "1" ]]; then
  echo "→ ⚠ DEV MOCKS ON (not real AI/voice): LLM=${DEV_MOCK_LLM:-0} TTS=${DEV_MOCK_TTS:-0} STT=${DEV_MOCK_STT:-0}"
  echo "  Chat replies are canned test text. unset DEV_MOCK_* for normal use."
fi

if [[ "${SESSION_LOG_VOICE_HTTP:-1}" == "0" ]]; then
  echo "→ Voice HTTP logging off (SESSION_LOG_VOICE_HTTP=0); POST /debug/voice-log still returns 200"
fi

cd "$SCRIPT_DIR"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck source=/dev/null
  source .venv/bin/activate
fi

echo "→ Backend http://0.0.0.0:${PORT} (LAN: http://${LAN_IP:-127.0.0.1}:${PORT})"
exec uvicorn main:app --reload --host 0.0.0.0 --port "$PORT"
