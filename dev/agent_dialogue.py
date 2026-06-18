#!/usr/bin/env python3
"""Alternate user/companion chat turns against a running backend (regression / smoke).

Usage:
  cd ai-backend && ./start.sh
  python3 dev/agent_dialogue.py --turns 4
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

USER_LINES = [
    "Hey, how are you?",
    "What is 2+2?",
    "Thanks — can you keep it brief?",
    "What time is it?",
]

COMPANION_PROBE = "Reply in one short friendly sentence."


def chat(base: str, message: str, timezone: str = "America/Los_Angeles") -> str:
    body = json.dumps({"message": message, "timezone": timezone}).encode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}/chat",
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
                reply = event.get("reply", reply)
            if "error" in event:
                raise RuntimeError(event["error"])
    print()
    return reply.strip()


def tts_smoke(base: str, text: str) -> int:
    body = json.dumps({"text": text, "style": "default", "voice_gender": "female"}).encode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}/tts",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    return len(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="Two-agent style chat smoke against /chat + /tts")
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--turns", type=int, default=4)
    args = parser.parse_args()

    print(f"=== health {args.base} ===")
    with urllib.request.urlopen(f"{args.base.rstrip('/')}/health", timeout=10) as h:
        health = json.loads(h.read())
    print(json.dumps({k: health.get(k) for k in ("llm_provider", "model_ready", "azure_tts")}, indent=2))

    turns = min(args.turns, len(USER_LINES))
    for i in range(turns):
        user = USER_LINES[i]
        print(f"\n--- user {i + 1}: {user}")
        reply = chat(args.base, user)
        print(f"REPLY: {reply[:200]}{'…' if len(reply) > 200 else ''}")
        if reply:
            nbytes = tts_smoke(args.base, reply[:280])
            print(f"TTS bytes: {nbytes}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
