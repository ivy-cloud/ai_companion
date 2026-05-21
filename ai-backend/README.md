# AI Companion Backend

FastAPI server that streams chat through a **local [Ollama](https://ollama.com)** model (`qwen2.5:3b` by default).

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
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
# Alternatives: qwen2.5:7b (smarter, slower), llama3.1:8b, llama3.2:3b
```

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
