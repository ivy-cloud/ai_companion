# AI Companion Backend

FastAPI server for the voice companion. Chat brain is **Ollama (local)** or **Groq (cloud)** — set `LLM_PROVIDER` in `.env`.

## 1. Install Ollama

Download and install from [https://ollama.com](https://ollama.com) (macOS, Linux, or Windows).

On macOS you can also use Homebrew:

```bash
brew install ollama
```

## 2. Pull the model

```bash
ollama pull qwen2.5:3b
```

## 3. Run Ollama

Ollama usually runs in the background after install. If not:

```bash
ollama serve
```

Default API: `http://localhost:11434`

Verify:

```bash
curl http://localhost:11434/api/tags
```

Quick test:

```bash
ollama run qwen2.5:3b
```

## 4. Python backend setup

```bash
cd ai-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Optional `.env` (copy from `.env.example`):

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
# Alternatives: qwen2.5:7b (smarter, slower), llama3.1:8b, llama3.2:3b
```

## Groq setup (fast cloud LLM — good for voice)

1. **Sign up:** https://console.groq.com  
2. **Create API key:** left menu → **API Keys** → **Create API Key** → copy `gsk_…`  
3. **Add to** `ai-backend/.env`:

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.1-8b-instant
```

4. Restart `./start.sh` and check health:

```bash
curl -sS http://127.0.0.1:8000/health | python3 -m json.tool
# expect "llm_provider": "groq", "model_ready": true
```

### Which Groq model for this voice app?

| Model | Best for |
|--------|----------|
| **`llama-3.1-8b-instant`** (default) | **Push-to-talk voice** — very fast, short obedient replies |
| **`llama-3.3-70b-versatile`** | Richer answers when you want quality over minimum latency |
| `llama3-70b-8192` | Older; use 3.3 70B instead if you need a large model |

Azure STT/TTS is unchanged — Groq only replaces the text brain (Ollama).

**President / facts:** US president is answered from **live Wikipedia** (canned), not model memory — works the same with Groq or Ollama.

## 5. Run the API

```bash
./start.sh
```

`start.sh` detects your Mac Wi‑Fi IP (`ipconfig getifaddr en0`), writes `EXPO_PUBLIC_API_BASE` to `ai-frontend/.env`, then runs:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Or without the script:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

Stream chat (NDJSON):

```bash
curl -N -X POST http://127.0.0.1:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

## API

| Endpoint | Description |
|----------|-------------|
| `POST /chat` | Stream reply (`application/x-ndjson`) |
| `POST /chat/reset` | Clear in-memory conversation |
| `GET /chat/history` | Debug: view stored turns |
| `GET /health` | API + Ollama reachability |

## Architecture

- **Personality** — `personality.py` → Ollama `system` message
- **Memory** — `memory.py` → last 10 exchanges as `user` / `assistant` messages
- **Latest message** — appended as final `user` turn
- **Streaming** — Ollama `/api/chat` with `stream: true` → forwarded to the Expo app unchanged

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot reach Ollama` | Run `ollama serve`; check `curl localhost:11434/api/tags` |
| `model not found` | Run `ollama pull qwen2.5:3b` (or your `OLLAMA_MODEL` from `.env`) |
| Slow first reply | First run loads the model into RAM; later requests are faster |
| iPhone can't reach API | Backend must bind `0.0.0.0`; phone uses Mac LAN IP in the app |
