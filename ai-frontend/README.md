# AI Companion Frontend

Expo SDK 54 chat app that talks to the FastAPI backend and speaks replies with Azure Neural TTS (`expo-av`).

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

The app calls your Mac’s backend at `EXPO_PUBLIC_API_BASE` (default `http://192.168.0.178:8000`). Azure TTS audio is written to a short-lived cache file before playback — **iOS often will not play `data:` MP3 URLs** in Expo AV, which caused silent playback before this change.

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE` when your LAN IP changes (`ipconfig getifaddr en0`), then restart `expo start`.
