# Companion roadmap

Phased path toward a **Her**-style voice companion: warm, intimate, remembers you, natural speech, grows over time — never clingy or creepy.

## Phase 1 — Conversation quality (shipped)

- Saved friend notes in system prompt on normal turns
- Voice length caps (~2 sentences / ~16 words)
- Mic echo suppression and clearer error copy

## Phase 2 — Latency (shipped)

- Single-clip TTS prefetch where possible
- `turn_summary` timing in session log
- Post-TTS listen cooldown (700ms) for echo safety

## Phase 3 — Polish (shipped)

- End conversation control
- Health preflight before voice sessions
- Speaking-phase recovery watchdog
- Louder TTS failure hints

## Growth & attunement (shipped — Jun 2026 overnight)

- `profile_growth.py`: structured prefs, remember/correct, **reflection memories** (`user_shared_moment`), usage **skill hints** in casual turn hints
- `companion_moments.py`: optional session opener (~38%/day), time-of-day bands, evening check-in turn hints; openers prefer shared moments when present
- `GET /companion/session-open` + frontend `speakSessionOpening` (no double mic-open race)
- Emotional hints + rhythm tuned for friend tone (not assistant / therapist)
- Frontend `conversationState.ts`: speaking-phase blockers + watchdog recovery when TTS refs clear but phase stuck

## Her attunement (Jun 2026 — continued)

- **Continuity** — `emotional_continuity_turn_hint` weaves prior `user_shared_moment` (~11% casual turns)
- **Curiosity** — `curiosity_turn_hint` for gentle Her-style question back (~10%)
- **Silence comfort** — `silence_comfort_turn_hint` when brief or low mood
- **Session goodbye** — `GET /companion/session-goodbye` + spoken farewell on End conversation
- **Skill hints UI** — unlocked labels from `/health` in app header
- **Journal echo** — `journal_reflection_hint` for optional shared-moment callback

## Hume AI voice learnings (Jun 2026)

Empathic speech-to-speech research — see [docs/hume-voice-learnings.md](docs/hume-voice-learnings.md):

- **Patient turn-taking** — longer end-of-silence (1.6s) when partial STT matches distress/low-mood cues
- **Barge-in resilience** — 750ms sustained interrupt threshold (~Hume default)
- **Reply-aware TTS emotion** — `emotion_hint` / `express_style` refined from assistant reply text
- **Prosody vibe match** — slower rate for sympathetic/gentle, faster for excited
- **Empathic listen copy** — “pause when ready” vs rigid pause timer

**Deferred:** full Hume EVI WebSocket / vocal prosody on mic — Phase 5 alongside OpenAI Realtime (no Hume API keys in project today).

## ChatGPT voice learnings (Jun 2026)

Phone voice UX/latency pass — see [docs/chatgpt-voice-learnings.md](docs/chatgpt-voice-learnings.md):

- Opening mic… live feel during cooldown
- Mute during TTS + Done speaking escape hatches
- Semantic turn extension (incomplete-thought STT)
- `voice_to_voice_ms` in `turn_summary`
- Barge-in monitor wired during TTS playback
- **Streaming partial STT** — rolling ~900ms recording chunks → `POST /stt?partial=1` live caption while listening
- **Always-on interrupt monitor** — barge-in meter hot during thinking / streaming / speaking (not full listen during TTS)

## Voice competitor learnings (Jun 2026)

Cross-vendor comparison (ChatGPT / Hume EVI / Gemini Live vs Jessica): [docs/voice-competitor-learnings.md](docs/voice-competitor-learnings.md). Per-vendor adoption logs:

- [docs/chatgpt-voice-learnings.md](docs/chatgpt-voice-learnings.md)
- [docs/hume-voice-learnings.md](docs/hume-voice-learnings.md)
- [docs/gemini-live-learnings.md](docs/gemini-live-learnings.md)
- [docs/pi-inflection-learnings.md](docs/pi-inflection-learnings.md) — companion tone/UX (not voice stack)

**Latency targets:** `voice_to_voice_ms` good ≤1.5s, acceptable ≤4s; tiers logged in `turn_summary`.

## Pi (Inflection) learnings (Jun 2026)

Companion-design pass from Pi — see [docs/pi-inflection-learnings.md](docs/pi-inflection-learnings.md):

- Curious session openers ("How's your morning?" vs "What's on your mind?")
- `think_through_turn_hint` on substantive vents — one what/how question, no therapize
- `curiosity_turn_hint` prefers what/how over why (Pi avoids accusatory why)
- Ban hollow compliments (`good question`, `insightful point`) in `human_speech.py`

## Phase 4 — Smart glasses (foundation started)

**Recommendation: treat smart glasses as Phase 4, only after phone voice is stable for 2+ weeks** (low echo rate, predictable `turn_summary`, rare watchdog recovery).

Foundation (no hardware required):

- [docs/meta-glasses.md](docs/meta-glasses.md) — architecture, latency/privacy/echo notes
- `ai-frontend/lib/wearablesAdapter.ts` — `phone` default, `meta-stub` placeholder
- `EXPO_PUBLIC_WEARABLES_MODE=phone|meta-stub`
- `X-Audio-Source` header on `/chat` → `session_log` `extra.audio_source`

| Risk | Why wait |
|------|----------|
| Mic / speaker placement | On-head audio causes echo and weak STT unless tuned per device |
| Latency | Round-trip voice must stay conversational; glasses add radio + SDK hops |
| Privacy | Always-on mics need explicit UX; phone already sets user expectations |
| APIs | No single standard for companion apps across Meta / Ray-Ban / others yet |

**Interim options**

1. **Bluetooth glasses + phone as compute** — glasses as remote mic/speaker; keep STT/TTS/LLM on the phone app you have today.
2. **Vendor SDK when ready** — integrate when a platform exposes stable audio streaming + user consent flows (document device-specific echo tuning).

Until then, optimize **physical phone** sessions: speaker distance, `session_log` `echo_suppressed` rate, and `listen_ready` after TTS.

## Phase 5 — Realtime speech-to-speech (deferred)

**Goal:** OpenAI Realtime API (or Gemini Live / Hume EVI equivalent) for sub-second voice-to-voice with server-side turn detection and echo modeling. See [docs/voice-competitor-learnings.md](docs/voice-competitor-learnings.md) for migration tradeoffs.

**Prerequisites (Phase 4.5 — shipped Jun 2026):**

| Prerequisite | Why |
|--------------|-----|
| Rolling partial STT + live caption | User sees speech land before silence commit; trains UX for continuous talk |
| Always-on barge-in monitor | Mic path stays hot at `BARGE_IN_SPEECH_LEVEL_DB` during assistant phases without opening full listen (echo-safe) |
| Stable `echo_suppressed` / `turn_summary` on phone | Baseline before swapping transport |
| Session turn protocol | Memory, profile growth, proactive beats must survive event-stream migration |

**Stubs (interface only):** `ai-backend/realtime_voice.py`, `ai-frontend/lib/realtimeVoice.ts` — `/health` reports `realtime_voice.ready: false`.

**Not in scope until Phase 5:** speculative LLM on partial STT, full-duplex without echo guards, Azure continuous-recognition WebSocket proxy (incremental REST chunks are the interim).

## What to test on phone

See [DEV.md](DEV.md) session log section and [RUNBOOK.md](RUNBOOK.md) voice checklist.
