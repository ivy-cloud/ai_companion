# AI Companion Frontend

Expo SDK 57 chat app that talks to the FastAPI backend: **hold Mic to talk** (Azure STT) and hear replies with Azure Neural TTS (`expo-audio`).

## Setup

```bash
cd ai-frontend
npm install
```

## Run

```bash
npm start
```

Scan the QR code with Expo Go on a physical device (recommended for microphone, speech, and LAN API access).

### Voice chat

1. Enable **voice** in the app header (Azure TTS for replies).
2. **Hold the Mic button**, speak, then release — your speech is sent to `POST /stt` on the backend (same Azure Speech key as TTS).
3. She replies in text and speaks aloud when voice is on.

First time on iOS, allow **microphone** access when prompted.

The app calls your Mac’s backend at `EXPO_PUBLIC_API_BASE` (default `http://192.168.0.178:8000`). Azure TTS audio is written to a short-lived cache file before playback — **iOS often will not play `data:` MP3 URLs** in Expo AV, which caused silent playback before this change.

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE` when your LAN IP changes (`ipconfig getifaddr en0`), then restart `expo start`.
