#!/usr/bin/env bash
# Run with backend up: ./start.sh  (or uvicorn on :8000)
# Usage: ./local_smoke_test.sh [base_url] [timezone]
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"
TZ="${2:-America/Los_Angeles}"

echo "=== health ==="
curl -sS "$BASE/health" | python3 -m json.tool | head -40
echo

chat() {
  local label="$1"
  local message="$2"
  echo "=== chat: $label ==="
  python3 - "$BASE" "$TZ" "$message" <<'PY'
import json, sys, urllib.request

base, tz, message = sys.argv[1:4]
body = json.dumps({"message": message, "timezone": tz}).encode()
req = urllib.request.Request(
    f"{base}/chat",
    data=body,
    headers={"Content-Type": "application/json", "Accept": "application/x-ndjson"},
    method="POST",
)
reply = ""
with urllib.request.urlopen(req, timeout=180) as resp:
    for raw in resp:
        line = raw.decode().strip()
        if not line:
            continue
        event = json.loads(line)
        if "text" in event:
            print(event["text"], end="", flush=True)
        if event.get("done"):
            reply = event.get("reply", "")
        if "error" in event:
            print(f"\nERROR: {event['error']}", file=sys.stderr)
            sys.exit(1)
print()
print(f"REPLY: {reply}")
meta = {}
with urllib.request.urlopen(f"{base}/health", timeout=10) as h:
    meta = json.loads(h.read())
print(
    f"(health: ollama model={meta.get('model')}, "
    f"web_search={meta.get('web_search', {}).get('enabled')})"
)
print()
PY
}

chat "voice test (math)" "What is 2+2?"
chat "time" "What time is it?"
chat "year" "Which year is it?"
chat "president" "Who is the president of the United States?"
chat "casual" "Hey, how are you?"

echo "Done. For phone UI: cd ../ai-frontend && npx expo start --clear"
