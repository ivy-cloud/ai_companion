# AI Companion — Test Environment Runbook

Use this guide to start the app on your Mac and test it from an iPhone with **Expo Go**.

## Test environment (current setup)

| Item | Value |
|------|--------|
| Project root | `/Users/ivyzan/ai-companion` |
| Backend | FastAPI on port **8000** (`0.0.0.0` — reachable on LAN) |
| Frontend | Expo SDK 54, **Expo Go** on iPhone |
| Phone → backend URL | `http://192.168.0.178:8000/chat` (set in `ai-frontend/app/index.tsx`) |
| Gemini key | Env var `GEMINI_API_KEY` (never commit `.env`) |
| Models (backend) | `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.5-pro` |

You need **two terminals**: one for the backend, one for Expo.

---

## Before you start (one-time / occasional)

### 1. Gemini API key

Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
# Optional: store in ai-backend/.env (gitignored)
cd /Users/ivyzan/ai-companion/ai-backend
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=...
```

Or export in the shell each session:

```bash
export GEMINI_API_KEY="your_key_here"
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

### 4. Mac LAN IP (when Wi‑Fi changes)

The iPhone must reach your Mac on the **same Wi‑Fi**. Find your IP:

```bash
ipconfig getifaddr en0
```

If it is **not** `192.168.0.178`, update `API_URL` in:

`ai-frontend/app/index.tsx`

```ts
const API_URL = 'http://YOUR_MAC_IP:8000/chat';
```

Reload the Expo app after changing this.

---

## Launch checklist (every test session)

### Terminal 1 — Backend

```bash
cd /Users/ivyzan/ai-companion/ai-backend
source .venv/bin/activate
export GEMINI_API_KEY="your_key_here"   # skip if using .env + you load it manually
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

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
