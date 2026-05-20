# AI Companion Starter

A minimal two-part AI chat companion: FastAPI + Gemini backend and Expo React Native frontend.

## Project structure

```
ai-companion/
├── README.md
├── ai-backend/
│   ├── .env.example
│   ├── .gitignore
│   ├── main.py
│   ├── requirements.txt
│   └── README.md
└── ai-frontend/
    ├── app/
    │   ├── _layout.tsx
    │   └── index.tsx
    ├── assets/
    ├── app.json
    ├── babel.config.js
    ├── package.json
    ├── tsconfig.json
    └── README.md
```

## Quick start

### 1. Backend

```bash
cd ai-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=your_key_here
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend

```bash
cd ai-frontend
npm install
npm start
```

Use Expo Go on a phone on the same Wi‑Fi as your computer. Set `EXPO_PUBLIC_API_BASE` in `ai-frontend/.env` (see `ai-frontend/.env.example`) to your Mac’s LAN IP; default is `192.168.0.178`.

## API

- `POST /chat` — body: `{ "message": "Hello" }`, response: `{ "reply": "..." }`
- `GET /health` — health check
