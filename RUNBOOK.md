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
