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

LAN_IP="$(detect_lan_ip || true)"
if [[ -z "$LAN_IP" ]]; then
  echo "⚠ Could not read LAN IP from en0/en1 (ipconfig getifaddr)."
  echo "  Set EXPO_PUBLIC_API_BASE manually in ai-frontend/.env"
else
  write_frontend_env "$LAN_IP"
fi

cd "$SCRIPT_DIR"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck source=/dev/null
  source .venv/bin/activate
fi

echo "→ Backend http://0.0.0.0:${PORT} (LAN: http://${LAN_IP:-?}:${PORT})"
exec uvicorn main:app --reload --host 0.0.0.0 --port "$PORT"
