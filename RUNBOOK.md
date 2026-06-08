# AI Companion — Test Environment Runbook

Use this guide to start the app on your Mac and test it from an iPhone with **Expo Go**.

## Test environment (current setup)

| Item | Value |
|------|--------|
| Project root | `/Users/ivyzan/ai-companion` |
| Backend | FastAPI on port **8000** (`0.0.0.0` — reachable on LAN) |
| Frontend | Expo SDK 54, **Expo Go** on iPhone |
| Phone → backend URL | `EXPO_PUBLIC_API_BASE` in `ai-frontend/.env` — **auto-set** by `./start.sh` from `ipconfig getifaddr en0` |
| Gemini key | Env var `GEMINI_API_KEY` (never commit `.env`) |
| Models (backend) | `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.5-pro` |

You need **two terminals**: one for the backend, one for Expo.

---

## Before you start (one-time / occasional)

### 1. Azure Speech (TTS + voice input STT)

Create a **Speech** resource in [Azure Portal](https://portal.azure.com) (free tier: ~500k characters/month).

```bash
cd /Users/ivyzan/ai-companion/ai-backend
cp .env.example .env
# Set AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (e.g. eastus), optional AZURE_SPEECH_VOICE
pip install -r requirements.txt
```

`uvicorn` loads `.env` automatically. Check:

```bash
curl http://127.0.0.1:8000/health
# "azure_tts": {"ready": true, ...}, "azure_stt": {"ready": true, ...}
```

### 2. Backend Python deps

```bash
cd /Users/ivyzan/ai-companion/ai-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Frontend Node deps

```bash
cd /Users/ivyzan/ai-companion/ai-frontend
npm install
```

### 4. Mac LAN IP (automatic)

`ai-backend/start.sh` runs `ipconfig getifaddr en0` (then `en1`) and writes `ai-frontend/.env`:

```env
EXPO_PUBLIC_API_BASE=http://192.168.0.177:8000
```

Restart Expo after the IP changes (`npx expo start --clear`).

---

## Launch checklist (every test session)

### Terminal 1 — Backend

```bash
cd /Users/ivyzan/ai-companion/ai-backend
source .venv/bin/activate   # first time only
./start.sh
```

`start.sh` updates `ai-frontend/.env` with your current Wi‑Fi IP, then starts Uvicorn.

Leave this running. You should see Uvicorn listening on `0.0.0.0:8000`.

**Quick check (Mac or same network):**

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok"}

curl -X POST http://127.0.0.1:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
# {"reply":"..."}
```

### Terminal 2 — Frontend (Expo)

```bash
cd /Users/ivyzan/ai-companion/ai-frontend
npm start
```

Then on **iPhone**:

1. Install **Expo Go** from the App Store (if needed).
2. Same Wi‑Fi as the Mac.
3. Scan the QR code from the terminal (or Expo Dev Tools in the browser).
4. Open the **AI Companion** project in Expo Go.

---

## Session log (track what you tried on the phone)

While the backend runs, each message is logged to `ai-backend/data/session_log.jsonl` with the **route** used (memory recall, companion birthday, LLM, etc.).

```bash
# Live tail on your Mac
tail -f ai-backend/data/session_log.jsonl

# Last 40 turns, easy to read
curl -s 'http://127.0.0.1:8000/debug/session-log?limit=40&format=text'
```

Clear before a new test session: `curl -X POST http://127.0.0.1:8000/debug/session-log/clear`

See [DEV.md](DEV.md) for details.

Conversation mode listen-debug checklist (phone):

1. `schedule_listen` appears after assistant TTS finishes.
2. `schedule_listen_open` appears once blockers clear.
3. `mic_open` then `listen_ready` appear within the same reopen cycle.
4. If reopening is delayed, inspect `schedule_listen_blocked` and `listen_blocked` reasons.
5. If session idles unexpectedly, check for `watchdog_idle_reopen_listen` or `watchdog_listening_stuck`.
6. After each turn, `turn_summary` should show `play_settle_ms` then `listen_ready_ms` (see [DEV.md](DEV.md#reading-turn_summary)).

Voice error copy on device: **Microphone busy**, **That was my voice**, **Didn't catch that**, **No audio heard — raise volume, silent switch off, tap above to hear**.

### Quiet speech not heard (phone)

If the app stays on **Listening…** but never responds:

1. **Speak closer** to the phone mic (bottom edge on iPhone) — arm's-length quiet speech may sit below the meter threshold.
2. **Quiet room** — fan/HVAC noise can steal headroom; a quieter room helps more than lowering thresholds further.
3. In Metro / `[voice]` logs, look for:
   - `quiet_voice_timeout` — listening 5s with no meter speech (try louder or closer).
   - `end_silence` — meter saw speech and sent a chunk (STT may still fail if too quiet).
   - `quiet_listen_retry` — one automatic re-listen after quiet speech + empty STT.
4. Current tuning: `SPEECH_LEVEL_DB` **-56**, `MIN_SPEECH_MS` **400**, `MIN_RECORDING_MS` **400** (`lib/conversationMode.ts`, `lib/voiceInput.ts`).
5. While **Listening…** or holding **Mic** (PTT), a subtle coral wave under the phase label should move with your voice (`components/VoiceInputWave.tsx`).

On load, the app calls **`GET /health`** and shows an orange banner if the backend is unreachable, Azure speech is missing, or **`DEV_MOCK_*`** is on when you expected real AI/voice.

While **Conversation** mode is active, tap **End conversation** (header) or **Stop** on the mic to tear down: stop recording, clear listen timers, abort in-flight TTS/chat, return to idle.

---

## Phone validation checklist (manual)

Clear the session log before a run: `curl -X POST http://127.0.0.1:8000/debug/session-log/clear`

| # | Step | Pass criteria |
|---|------|----------------|
| 1 | **Health** | App opens without orange backend banner; `curl http://127.0.0.1:8000/health` shows `"status":"ok"`, `dev_mode.mock_llm` false for real AI |
| 2 | **Multi-turn** | Conversation mode: 3+ back-and-forth turns; after each reply, mic reopens (`listen_ready` in log / Metro `[voice]`) |
| 3 | **Memory** | Say name + preference; ask “what’s my name?” / “what do I like?” — canned recall, no hallucination |
| 4 | **Growth** | Say “Remember that I love tea” — later casual chat may nod briefly; optional “sing me a lullaby” twice → skill hints in `/health` `companion.skill_hints` |
| 5 | **Sing** | Ask for a short song — original lyrics vibe, TTS plays, `route` contains sing in session log |
| 6 | **Audio** | Hear assistant voice; if silent, banner/hint mentions volume; tap-to-hear replays last line |
| 7 | **End session** | Tap **End conversation** — recording stops, phase idle, no stuck “Listening…” |

Watchdog events (`watchdog_*`) should be **rare** in a healthy session — see [DEV.md](DEV.md#watchdog-safety-only).

---

## Local API smoke test (Mac only, no phone)

With `./start.sh` running in another terminal:

```bash
cd /Users/ivyzan/ai-companion/ai-backend
source .venv/bin/activate
./local_smoke_test.sh
# optional: ./local_smoke_test.sh http://127.0.0.1:8000 America/New_York
```

This hits the same cases we use to verify behavior:

| Test | What to expect |
|------|----------------|
| `What is 2+2?` | Direct answer, e.g. "2+2 is 4." — no hmm/oh filler |
| `What time is it?` | Spoken-style time from **Right now** / phone timezone |
| `Which year is it?` | Current year only — not time + random old year |
| `Who is the president…` | Name from **live web lookup** (needs internet + Ollama) |
| `Hey, how are you?` | Short casual reply |

**Corresponding code (uncommitted local work):**

| Area | Files |
|------|--------|
| System prompt (factual first) | `ai-backend/personality.py`, `identity.py`, `human_speech.py` |
| Time / year / timezone | `ai-backend/context.py`, `ChatRequest.timezone` in `main.py` |
| Web facts | `ai-backend/web_search.py`, `grounding.py` |
| Voice PTT + state machine | `ai-frontend/app/index.tsx`, `lib/voiceFlow.ts`, `lib/voiceInput.ts` |
| Phone timezone | `ai-frontend/lib/deviceTimezone.ts`, `lib/chatStream.ts` |
| Text = speech when casual | `ai-frontend/lib/speechPlayback.ts` |
| Auto LAN IP | `ai-backend/start.sh` → `ai-frontend/.env` |

One-off curl (streaming reply):

```bash
curl -sN -X POST http://127.0.0.1:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What is 2+2?","timezone":"America/Los_Angeles"}'
```

---

## In-app smoke test

1. **Enable voice** — toggle ON (default).
2. Tap **“Tap here to test voice”** — you should hear: *“Hello. Voice is working.”*
   - Raise volume; turn **silent switch OFF** if no sound.
   - Fully quit and reopen Expo Go after dependency changes.
3. Send a chat message — text reply should appear; voice should speak the AI reply after a successful response.

---

## Troubleshooting

### iPhone shows text but “network” / fetch errors

- Backend terminal still running?
- Mac IP in `app/index.tsx` matches `ipconfig getifaddr en0`?
- iPhone and Mac on the same Wi‑Fi (not guest network)?
- macOS firewall: allow incoming connections for Python/Terminal if prompted.

### Backend: `GEMINI_API_KEY environment variable is not set`

```bash
export GEMINI_API_KEY="your_key_here"
```

Then restart `uvicorn`.

### Backend / app: quota or 429 errors

Free-tier Gemini limits are per Google Cloud **project**. See [AI Studio rate limits](https://aistudio.google.com/rate-limit). Wait or enable billing.

### Voice shows “Speaking…” but no sound (iPhone + Expo Go)

- Physical iPhone (not Simulator).
- Silent switch **off**, volume up.
- Tap **test voice** under the toggle.
- Check Control Center — audio not routed to unused AirPods.

### AI voice too quiet (iPhone + Expo Go)

Even at **100%** in Settings → Playback volume, loudness is limited by three layers:

1. **iPhone system volume** (side buttons) — this is the main control; in-app gain cannot exceed **1.0** (expo-av has no 110% boost).
2. **Audio route** — Bluetooth / AirPods / CarPlay cap perceived volume; use **iPhone Speaker** in Control Center and disconnect unused Bluetooth devices.
3. **Azure SSML** — backend defaults to `AZURE_SPEECH_VOLUME=+25%`; set `loud` or `x-loud` in `ai-backend/.env` for more.

**Why it can still sound quiet:** During conversation mode, mic prewarm used to switch iOS to **PlayAndRecord** (earpiece) while TTS played. The app now keeps **Playback** category during speaking. If audio is still faint, raise side-button volume and confirm speaker routing — Expo Go cannot override `defaultToSpeaker` on PlayAndRecord.

In `[voice]` logs, confirm `ios_speaker_prime_done` and `tts_play_volume` with `volume: 1` at play time.

### `npm install` errors in `ai-frontend`

```bash
cd ai-frontend
npx expo install react react-dom
npm install
```

---

## Stop the app

| Component | How to stop |
|-----------|-------------|
| Backend | `Ctrl+C` in Terminal 1 |
| Expo | `Ctrl+C` in Terminal 2 |

---

## Useful paths

| What | Path |
|------|------|
| Backend entry | `ai-backend/main.py` |
| Chat API URL (phone) | `ai-frontend/app/index.tsx` → `API_URL` |
| API key example | `ai-backend/.env.example` |
| Voice / chat UI | `ai-frontend/app/index.tsx` |

---

## Optional: load `.env` in backend shell

If you use `ai-backend/.env`, activate the venv then:

```bash
set -a && source .env && set +a
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

(Do not commit `.env`.)
