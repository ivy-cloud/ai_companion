# AI Companion Backend

FastAPI server that proxies chat messages to Google Gemini (`gemini-2.5-flash`).

## Setup

```bash
cd ai-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here
```

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API: `POST http://localhost:8000/chat` with body `{ "message": "Hello" }`.

## Quota / "exceeded your current quota"

Gemini limits apply to your **Google Cloud project**, not per model name. On the free tier, `gemini-2.5-flash` still has caps (e.g. requests per minute and per day). Hitting the limit returns HTTP 429 even though the model is "flash."

- View limits: [AI Studio rate limits](https://aistudio.google.com/rate-limit)
- Enable billing in AI Studio for higher tiers
- Wait until the daily limit resets (midnight Pacific)
- `gemini-2.5-pro` on free tier has **lower** limits than flash — the backend only tries it after flash/lite fail for non-quota reasons
