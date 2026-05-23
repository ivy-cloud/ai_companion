#!/usr/bin/env bash
# Laptop dev sim — unit tests + API smoke (no phone, no Groq/Azure if mocks enabled).
#
# Usage:
#   ./dev/sim.sh              # tests only
#   ./dev/sim.sh --live       # also hit /health and /chat (backend must be running)
#   ./dev/sim.sh --start      # start backend with mocks, then smoke
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/ai-backend"
BASE="${SIM_BASE:-http://127.0.0.1:8000}"
RUN_LIVE=0
START_MOCK=0

for arg in "$@"; do
  case "$arg" in
    --live) RUN_LIVE=1 ;;
    --start) START_MOCK=1; RUN_LIVE=1 ;;
    -h | --help)
      echo "Usage: ./dev/sim.sh [--live] [--start]"
      echo "  --live   curl health + local_smoke_test.sh (backend on $BASE)"
      echo "  --start  DEV_MOCK_*=1 ./start.sh in background, then --live"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$BACKEND"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck source=/dev/null
  source .venv/bin/activate
fi

echo "=== unittest (ai-backend) ==="
python3 -m unittest discover -s . -p 'test_*.py' -q

if [[ "$START_MOCK" -eq 1 ]]; then
  echo "=== starting mock backend on :8000 ==="
  export DEV_MOCK_LLM=1 DEV_MOCK_TTS=1 DEV_MOCK_STT=1 DEV_LOCAL_FRONTEND=1
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
  (cd "$BACKEND" && ./start.sh) &
  BACK_PID=$!
  trap 'kill "$BACK_PID" 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do
    if curl -sf "$BASE/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

if [[ "$RUN_LIVE" -eq 1 ]]; then
  echo "=== health ==="
  curl -sf "$BASE/health" | python3 -m json.tool | head -50
  echo
  echo "=== chat smoke ==="
  "$BACKEND/local_smoke_test.sh" "$BASE"
fi

echo "Done."
