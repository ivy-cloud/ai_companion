# Laptop dev sim (mock APIs)

Fast debugging on your Mac without Groq, Ollama, or Azure. **This is not an iOS Simulator** — we do not use or ship Simulator setup here.

If Jessica says *"Backend test mode"* or *"you said «…»"* with no real conversation, **`DEV_MOCK_LLM=1` is on** — see "Use real AI again" below.

## Use real AI again (disable mocks)

Do **not** set `DEV_MOCK_*` when talking to Jessica normally. Restart the backend:

```bash
cd ai-backend
unset DEV_MOCK_LLM DEV_MOCK_TTS DEV_MOCK_STT DEV_LOCAL_FRONTEND
./start.sh
```

Check: `curl -s http://127.0.0.1:8000/health | grep dev_mode` should show `"mock_llm": false`.

---

## Quick start (mock everything)

**Terminal A — backend**

```bash
cd ai-backend
source .venv/bin/activate   # once
export DEV_MOCK_LLM=1 DEV_MOCK_TTS=1 DEV_MOCK_STT=1 DEV_LOCAL_FRONTEND=1
./start.sh
```

**Terminal B — tests + smoke**

```bash
./dev/sim.sh --live
```

Or one shot (starts mock backend, runs smoke, then stops when the script exits):

```bash
./dev/sim.sh --start
```

## What each flag does

| Env var | Effect |
|---------|--------|
| `DEV_MOCK_LLM=1` | Canned streaming `/chat` — no Groq/Ollama |
| `DEV_MOCK_TTS=1` | Silent WAV from `/tts` — no Azure |
| `DEV_MOCK_STT=1` | Fixed transcript from `/stt` — no Azure |
| `DEV_MOCK_STT_TEXT=...` | Text returned by mock STT (default: "Hello from mock microphone.") |
| `DEV_LOCAL_FRONTEND=1` | `start.sh` sets `EXPO_PUBLIC_API_BASE=http://127.0.0.1:8000` |

`/health` includes a `dev_mode` object so you can confirm mocks are on.

## What sim is good for

- Profile memory, canned replies, web-search routing
- Singing intent routing with safe original-lyrics fallback
- NDJSON stream shape and errors
- Backend unit tests (`./dev/sim.sh` without `--live`)

## What still needs a phone

- Speaker ↔ mic echo, conversation barge-in, real Azure voice quality
- Expo Go on LAN (use normal `./start.sh` **without** `DEV_LOCAL_FRONTEND`)

## Mix mocks and real services

Example: real LLM, mock voice (no Azure bill):

```bash
export DEV_MOCK_TTS=1 DEV_MOCK_STT=1
./start.sh
```

## Frontend on laptop (optional)

Point Expo at localhost when using a Mac client later; for now phone testing stays on the RUNBOOK LAN IP flow.

```bash
cd ai-frontend
EXPO_PUBLIC_API_BASE=http://127.0.0.1:8000 npx expo start
```

## Session log (phone testing)

Every chat and voice transcript from the app is appended to:

`ai-backend/data/session_log.jsonl`

Each line includes: time, **your message**, **AI reply**, **route** (how it was answered), memory learned, profile facts, and errors.

**Watch live while testing on the phone:**

```bash
tail -f ai-backend/data/session_log.jsonl
```

**Voice / TTS debug only** (enqueue, playback, phase, echo suppression — from `voiceTurnLog.ts`):

```bash
# Metro (Mac terminal running Expo): lines prefixed [voice]
# Backend file (works when testing on a physical phone):
curl -s 'http://127.0.0.1:8000/debug/session-log?limit=120&type=voice&format=text'
```

Look for: `stream_on_done`, `run_tts_single_clip`, `snapshot_play_start`, `skip_duplicate_play`, `echo_suppressed`, `stt_ignored_during_tts`, `turn_summary` (latency ms).

### Reading `turn_summary`

Each voice turn logs one `turn_summary` event (Metro `[voice]` and session log). Timestamps are **ms from `send_start`** (0):

| Field | Meaning |
|-------|---------|
| `first_token_ms` | First streamed LLM token |
| `stream_done_ms` | Full reply received |
| `first_tts_fetch_ms` | First Azure TTS response written to cache |
| `first_audio_play_ms` | First clip started playing |
| `play_settle_ms` | Natural playback finished (or last clip) |
| `mic_open_ms` | Conversation recorder opened after TTS |
| `listen_ready_ms` | Meter running — safe to speak |

Typical healthy conversation turn: `first_token` → `stream_done` → `first_tts_fetch` → `play_settle` → `mic_open` → `listen_ready`. Large gaps between `play_settle` and `listen_ready` usually mean post-TTS cooldown or `schedule_listen_blocked`.

**Phase 1 (conversation quality):** saved friend notes are in the system prompt on normal turns (not only explicit recall questions); canned recall routes unchanged. Voice replies target ~2 short sentences / ~16 words; clearer mic/echo/STT error copy.

**Phase 2 (latency):** single-clip TTS prefetch, slightly faster playback-idle detection; `turn_summary` includes post-TTS mic timing. Post-TTS listen cooldown stays **700ms** for echo safety.

For conversation-listen recovery and next-turn timing, also watch:

- `schedule_listen` - a delayed reopen was scheduled (normal after TTS).
- `schedule_listen_blocked` - reopen was deferred (`tts_blocked`, `chat_in_flight`, etc).
- `schedule_listen_open` - blocked conditions cleared, listen reopen attempted.
- `mic_open` - recorder started; includes `dtSinceScheduleMs`.
- `listen_ready` - listen meter running; includes `dtSinceMicOpenMs`.
- `listen_blocked` - immediate ensure/recovery path detected a blocker and rescheduled.
- `watchdog_listening_stuck` / `watchdog_idle_reopen_listen` - watchdog intervened.

Quick diagnosis:

1. `schedule_listen` but no `mic_open`: check repeated `schedule_listen_blocked` reasons.
2. `mic_open` but no `listen_ready`: recorder start issue on device; check mic permission / one-recorder errors.
3. frequent `echo_suppressed`: increase distance from speaker and verify cooldown behavior on physical phone.

**Readable summary (last 40 turns):**

```bash
curl -s 'http://127.0.0.1:8000/debug/session-log?limit=40&format=text'
```

**JSON for scripts:**

```bash
curl -s 'http://127.0.0.1:8000/debug/session-log?limit=40'
```

**Clear log before a fresh test run:**

```bash
curl -X POST http://127.0.0.1:8000/debug/session-log/clear
```

Logging is on by default. Disable with `SESSION_LOG=0` in the environment before `./start.sh`.

Stop writing Expo voice events to `session_log.jsonl` (frontend POST still succeeds) with `SESSION_LOG_VOICE_HTTP=0` before `./start.sh`. Uvicorn access lines for `POST /debug/voice-log` are always filtered from the terminal.

`GET /health` includes `session_log` status (path, line count).

---

## Reset conversation during sim

```bash
curl -X POST http://127.0.0.1:8000/chat/reset
```

See also: [RUNBOOK.md](RUNBOOK.md) for full phone + Azure setup.
