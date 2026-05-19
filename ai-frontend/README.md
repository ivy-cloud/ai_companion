# AI Companion Frontend

Expo SDK 54 chat app that talks to the FastAPI backend and speaks replies with `expo-speech`.

## Setup

```bash
cd ai-frontend
npm install
```

## Run

```bash
npm start
```

Scan the QR code with Expo Go on a physical device (recommended for speech and LAN API access).

The app calls `http://192.168.0.178:8000/chat`. Update `API_URL` in `app/index.tsx` if your machine IP changes.
