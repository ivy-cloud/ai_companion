#!/usr/bin/env bash
# CI-ready: backend unittest + frontend unit tests. Exits non-zero on any failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/ai-backend"
FRONTEND="$ROOT/ai-frontend"
FAILED=0

cd "$BACKEND"
if [[ -f .venv/bin/activate ]]; then
  # shellcheck source=/dev/null
  source .venv/bin/activate
fi

echo "=== backend unittest (ai-backend) ==="
if ! python3 -m unittest discover -s . -p 'test_*.py' -q; then
  FAILED=1
fi

echo "=== frontend unit tests (ai-frontend) ==="
if [[ -d "$FRONTEND/lib" ]]; then
  shopt -s nullglob
  FRONT_TESTS=("$FRONTEND"/lib/*.test.ts)
  shopt -u nullglob
  if [[ ${#FRONT_TESTS[@]} -eq 0 ]]; then
    echo "No *.test.ts files in ai-frontend/lib"
    FAILED=1
  else
    for test_file in "${FRONT_TESTS[@]}"; do
      echo "--- $(basename "$test_file") ---"
      if ! (
        cd "$FRONTEND"
        npx tsx "$test_file"
      ); then
        FAILED=1
      fi
    done
  fi
else
  echo "Missing ai-frontend/lib"
  FAILED=1
fi

if [[ "$FAILED" -ne 0 ]]; then
  echo "test-all: FAILED" >&2
  exit 1
fi

echo "test-all: OK"
