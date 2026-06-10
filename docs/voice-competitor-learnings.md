# Voice competitor learnings — Jessica vs ChatGPT / Hume / Gemini Live / Pi

Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:

- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)

## Stack comparison

| Dimension | **Jessica** (shipped) | **ChatGPT Voice** | **Hume EVI** | **Gemini Live** |
|-----------|----------------------|-------------------|--------------|-----------------|
| **Architecture** | STT → Groq LLM → Azure TTS (chained) | OpenAI Realtime API (speech-to-speech) | Speech-language model (unified) | Native audio model (unified WSS) |
| **Transport** | REST + NDJSON + TTS clips | WebRTC / WSS Realtime | WebSocket EVI | WebSocket (WebRTC via partners) |
| **Push-to-talk** | No — conversation mode always listens | No | No | No |
| **Turn detection** | Client VAD + semantic extension | Server VAD + semantic | **Prosody-based** EOT | **Server VAD** (auto or manual) |
| **Barge-in** | Half-duplex + monitor during TTS | Full interrupt + server cancel | Always interruptible | VAD cancel + queue clear |
| **Emotion / prosody** | Text heuristics → LLM hint + Azure express-as | Native in Realtime model | **Audio prosody model** | Affective dialog (2.5, v1alpha) |
| **Partial user feedback** | Rolling partial STT caption | Server transcripts streaming | `user_message` + expression measures | Input transcription events |
| **Proactive speech** | Text beats in turn hints | Server-side | Model-initiated | Proactive audio (2.5, v1alpha) |
| **Multimodal** | Text + voice | Voice (+ vision in app) | Voice (+ optional CLM tools) | Audio + video + text |
| **Typical voice-to-voice** | **1.5–4s** (good ≤1.5s) | **~0.3–1.5s** class | Sub-second target | Sub-second target (native audio) |
| **Phone echo strategy** | Half-duplex, 150ms cooldown, barge-in monitor | Server echo modeling | Partner/SDK dependent | Continuous stream + client AEC |

## Companion tone — Pi vs realtime voice vendors

Pi is **not** a speech-to-speech stack; it competes on **companion feel** (curiosity, think-through empathy, boundaries). Jessica borrows Pi patterns via turn hints, not Inflection API.

| Dimension | **Jessica** | **Pi (Inflection)** | ChatGPT / Hume / Gemini |
|-----------|-------------|---------------------|-------------------------|
| **Positioning** | Named friend on live call (Her) | Personal intelligence companion | Assistant → voice mode |
| **Opener** | Curious session open ~38%/day | Casual-life question every chat | Sessionless / model greeting |
| **Emotional support** | Silence comfort + think-through hints | Question-led think-through | Model-native empathy / prosody |
| **Curiosity** | ~10% what/how hints | Frequent follow-ups; avoids "why" | Varies |
| **Memory** | Persistent profile + shared moments | Session-strong | Vendor-dependent |
| **Cling / romance** | Explicitly avoided | No romance modes; boundary training | N/A |
| **Compliments** | Banned hollow praise | Frequent — known insincerity risk | Varies |

## UX patterns — adopted across competitors

| Pattern | ChatGPT | Hume | Gemini | Jessica status |
|---------|---------|------|--------|----------------|
| Always feels live (no "dead" mic) | ✓ | ✓ | ✓ | ✓ Opening mic… |
| Escape hatches (Done / Mute) | ✓ | ✓ | — | ✓ VoiceHero |
| Live partial transcript | ✓ | ✓ | ✓ | ✓ streamingStt |
| Interrupt anytime | ✓ | ✓ | ✓ | ✓ barge-in monitor |
| Match emotional tone | ✓ | ✓✓ (core) | ✓ affective | ✓ emotion_hint + express-as + prosody_rate |
| Semantic turn extension | ✓ | ✓ (prosody) | ✓ (VAD tuning) | ✓ incomplete-thought |
| Fast ack while thinking | — | ✓ | — | ✓ fast_ack (~22%) |
| Latency telemetry | — | — | — | ✓ voice_to_voice_ms + good/acceptable/slow tiers |
| Curious session opener | — | — | — | ✓ Pi-style openers |
| Think-through on vents | — | — | — | ✓ think_through_turn_hint |
| Avoid hollow compliments | — | — | — | ✓ BANNED_PHRASES |

## Latency targets (Jessica)

Derived from competitor class + our `turn_summary` baselines (`voiceLatencyMath.ts`):

| Metric | Good | Acceptable | Slow |
|--------|------|------------|------|
| `voice_to_voice_ms` (speech end → first audio) | ≤ 1500 ms | ≤ 4000 ms | > 4000 ms |
| `first_token_ms` (speech end → first LLM token) | ≤ 800 ms | ≤ 2000 ms | > 2000 ms |
| `play_settle` → `listen_ready` | ≤ 300 ms | ≤ 800 ms | > 800 ms |

Realtime APIs (ChatGPT, Hume, Gemini) aim for **sub-1s voice-to-voice**; Jessica's chained pipeline targets **≤1.5s good** via incremental TTS and fast acks until Phase 5 migration.

## Phase 5 migration options

| Option | Pros | Cons |
|--------|------|------|
| **OpenAI Realtime** | Best documented; ChatGPT parity | New session protocol; echo on phone |
| **Gemini Live WSS** | Native audio + affective (2.5); multimodal | ~10 min sessions; 3.1 drops affective/proactive |
| **Hume EVI** | Best empathic prosody | Vendor lock-in; Groq becomes supplemental CLM |
| **Keep chained + optimize** | Full control; memory/profile intact | Ceiling ~1.5s voice-to-voice |

**Current stance:** Stubs in `realtime_voice.py` / `realtimeVoice.ts`; optimize chained pipeline with competitor UX patterns until phone voice stable 2+ weeks.

## Implemented vs deferred (Jun 2026)

### Implemented (no new API keys)

- Emotion/prosody text proxies: `prosody_vibe_turn_hint`, `prosody_rate_for_hint`, frustration → sympathetic
- `emotion_hint` + `express_style` wired STT→LLM→TTS (`ttsEmotionHintRef`, stream `done`)
- Latency targets + tier logging (`voice_to_voice_tier`, `listen_ready_tier` in `turn_summary`)
- ChatGPT UX pass (partial STT, barge-in, Opening mic…, voice_to_voice_ms)
- Pi companion tone (curious openers, think-through vents, what/how curiosity, compliment bans)
- Hume-inspired: patient silence (1600ms distress), barge-in 750ms, reply-aware emotion, empathic listen copy — see [hume-voice-learnings.md](./hume-voice-learnings.md)

### Deferred

- Full Gemini Live WSS / Hume EVI WebSocket / OpenAI Realtime sessions
- Audio prosody analysis (Hume Expression Measurement)
- Gemini affective dialog & proactive audio API flags
- Full-duplex without echo guards
- Speculative LLM on partial STT
