# Google Gemini Live — adoption log

Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).

## What Gemini Live is

Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.

| Aspect | Gemini Live | Jessica (today) |
|--------|-------------|-----------------|
| Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
| Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
| Interruption | VAD cancels generation; client clears playback queue | Barge-in monitor during thinking/streaming/speaking; half-duplex during TTS |
| Latency shape | Single model, audio-in → audio-out | `voice_to_voice_ms`: STT commit → LLM token → TTS fetch → play (~1.5–4s) |
| Emotion / tone | **Affective dialog** (2.5 only, `v1alpha`) adapts style to input expression | Heuristic `emotion_hint` + Azure `mstts:express-as` |
| Proactive speech | **Proactive audio** (2.5 only) — model may stay silent if input not directed at device | Proactive beats via `companion_thread` text hints only |
| Multimodal | Audio + JPEG video ≤1 FPS + text in one session | Voice + text chat; no camera stream |
| Session limits | ~10 min connection; 15 min audio-only / 2 min A+V without compression | No hard session cap; phone echo guards dominate |

## Architecture highlights

### Streaming & full-duplex

- Client streams mic PCM continuously; model streams audio chunks back as `inlineData`.
- **No push-to-talk** in the product UX — always-on mic with server-side VAD is the default.
- True full-duplex: user can barge-in anytime; server sends `interrupted: true` and discards pending generation.
- Jessica approximates this with **always-on barge-in monitor** at `BARGE_IN_SPEECH_LEVEL_DB` while blocking full listen during TTS (echo-safe half-duplex).

### Server VAD

Automatic VAD knobs (when not disabled):

- `start_of_speech_sensitivity`, `end_of_speech_sensitivity`
- `prefix_padding_ms`, `silence_duration_ms`
- Default activity handling: `START_OF_ACTIVITY_INTERRUPTS` (barge-in)

Manual VAD (`automaticActivityDetection.disabled: true`) is used in production interview apps for precise turn boundaries — but requires reliable `activityEnd` and has known edge cases (post-barge-in offset detection, WebRTC silent-frame gaps).

Jessica's client-side silence meter + **Done speaking** escape hatch + semantic turn extension cover similar UX without server VAD.

### Affective dialog & proactive audio

- **Affective dialog**: model adapts response **style and tone** to input expression (Gemini 2.5 Live + `v1alpha` only; not in 3.1 Flash Live yet).
- **Proactive audio**: model may **choose not to respond** when speech isn't directed at the device (ambient conversation filter).

Jessica adoption (no API key):

- Text-based **prosody vibe matching** in `emotion.prosody_vibe_turn_hint` (match energy, soften on frustration).
- `emotion_hint` + `express_style` on stream `done` → TTS request (see [hume-voice-learnings.md](./hume-voice-learnings.md) for empathic parallel).

## What makes Gemini feel natural vs our pipeline

| Naturalness factor | Gemini Live | Jessica gap / mitigation |
|--------------------|-------------|--------------------------|
| **No perceptible pipeline** | One model; audio starts while "thinking" | Fast ack + incremental TTS chunks (`conversation_rhythm.py`) |
| **Instant interrupt** | Server cancels + client clears queue | Barge-in monitor + playback stop (`speechPlayback.ts`) |
| **Tone follows user** | Native affective dialog | Heuristic emotion + Azure express-as + LLM turn hints |
| **Turn ends feel human** | Prosody-aware server VAD | Silence meter + incomplete-thought STT + Done speaking |
| **Always listening** | Continuous PCM stream | Opening mic… UX; 150ms post-TTS cooldown |
| **Sub-second voice-to-voice** | Target ~300–800ms class (native audio) | Target good ≤1.5s, acceptable ≤4s (`voiceLatencyMath.ts`) |

## Adopted (Jun 2026)

| Learning | Implementation |
|----------|----------------|
| **Latency targets** | `VOICE_LATENCY_TARGETS` + tier classification in `voiceLatencyMath.ts`; logged in `turn_summary` |
| **Match input vibe (affective proxy)** | `prosody_vibe_turn_hint` + `prosody_rate_for_hint` — see also [hume-voice-learnings.md](./hume-voice-learnings.md) |
| **Frustration → softer tone** | Frustration regex in `conversation_tone_llm_hint`; sympathetic express-as |
| **Clear playback on interrupt** | Already shipped (ChatGPT pass) — aligns with Gemini `interrupted` handling |
| **Server VAD concepts → client** | Documented; manual `activityEnd` pattern informs Done speaking + semantic extension |

## Partially adopted

| Learning | Status |
|----------|--------|
| **Continuous PCM streaming** | Rolling partial STT (~900ms REST chunks); not true PCM WSS |
| **Proactive silence** | Text proactive beats only; no ambient-audio filter |
| **Multimodal (camera)** | Deferred — phone voice first |

## Deferred (Phase 5)

| Learning | Reason |
|----------|--------|
| **Gemini Live WSS session** | Requires Google API key, new transport, session resumption (~10 min), echo model rework |
| **Affective dialog API flag** | Needs native audio model; replicate via heuristics until migration |
| **Proactive audio** | Needs always-on mic + relevance classifier; risky on phone speaker |
| **WebRTC bridge (LiveKit/Pipecat)** | Partner integration; evaluate alongside OpenAI Realtime |
| **Manual VAD (`activityStart`/`activityEnd`)** | Only if we move to server VAD; client meter sufficient for now |

## References

- [Live API overview](https://ai.google.dev/gemini-api/docs/live-api)
- [Live API capabilities (VAD, affective, proactive)](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Gemini Live examples (GitHub)](https://github.com/google-gemini/gemini-live-api-examples)
