# Voice competitor learnings — Jessica vs ChatGPT / Hume / Gemini Live / Pi

Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:

- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)
- [replika-companion-learnings.md](./replika-companion-learnings.md) — companion-first memory + voice/text parity
- [siri-voice-learnings.md](./siri-voice-learnings.md) — Siri AI 2026 conversational UX
- [her-voice-learnings.md](./her-voice-learnings.md) — Samantha / Sesame friend voice patterns
- [elevenlabs-voice-learnings.md](./elevenlabs-voice-learnings.md) — TTS realism + ElevenAgents
- [voice-platform-learnings.md](./voice-platform-learnings.md) — Vapi, Retell, PolyAI builder patterns
- [nomi-companion-voice-learnings.md](./nomi-companion-voice-learnings.md) — Nomi / Kindroid / Candy voice calls

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

**Sesame (Maya/Miles)** — CSM contextual speech ([her-voice-learnings.md](./her-voice-learnings.md)): breaths, disfluency; Jessica uses Azure TTS + text emotion proxies until Phase 5.

## Tonight's research sweep (Jun 2026)

Full market pass — consumer voice assistants + companion apps + dev stacks.

### Tier 1 — conversational voice (copy UX, not stack)

| Product | Standout strength | Jessica action |
|---------|-------------------|----------------|
| **ChatGPT Voice** | Lowest latency feel; emotion + interrupt; deep reasoning | ✓ barge-in, partial STT, express-as; Phase 5 Realtime |
| **Gemini Live** | Free voice tier; Search freshness; proactive audio (2.5) | ✓ web_search + links; proactive beats |
| **Hume EVI 3** | Prosody-based end-of-turn; empathic tone match | ✓ TRP interrupts, emotion_hint, silence comfort |
| **Pi** | Curious companion; think-through; voice for walks | ✓ openers, vent/think-through, curiosity hints |
| **Sesame (Maya)** | Breaths, disfluency, contextual speech | Partial — SSML prosody; CSM deferred |
| **Siri AI** | Cross-device history; pace/expressiveness sliders | ✓ resume openers; env prosody |
| **Replika** | Long-term companion; hear good + hard | ✓ `good_news_turn_hint`; unified voice/chat memory |

### Tier 2 — avoid their weaknesses

| Product | Weakness | Jessica guard |
|---------|----------|---------------|
| **Replika voice** | Weaker than text; split memory | Single LLM + session_log for both channels |
| **Alexa / Siri** | Command-and-control residue | Friend voice bans assistant openers |
| **Generic TTS** | Flat karaoke lyrics | Replicate singing + singing SSML |

### Tier 3 — builder stack (Phase 5 options)

| Stack | Latency class | Notes |
|-------|---------------|-------|
| OpenAI Realtime | ~300ms–1.5s | ChatGPT parity |
| Gemini Live WSS | Sub-second native audio | Affective dialog 2.5 |
| Hume EVI WebSocket | ~300ms | Best empathic prosody |
| Vapi + Deepgram + Cartesia | ~100–200ms TTS | Startup modular stack |
| ElevenLabs Conv AI | ~75ms Flash | TTS-only layer |
| Sesame CSM-1B | Contextual speech gen | Apache 2.0; needs separate LLM |

### New docs this sweep

- [replika-companion-learnings.md](./replika-companion-learnings.md)
- [siri-voice-learnings.md](./siri-voice-learnings.md)

### Code applied tonight

- `good_news_turn_hint` — celebrate wins (Replika/Pi)
- Session goodbye copy — removed "glad we talked" assistant phrasing

### Code applied (Jul 2026 sweep)

- `heardReplyOnInterrupt` — ChatGPT Realtime truncate on barge-in
- `maybe_lookup_ack` — spoken filler on factual/web turns (Vapi/Realtime tool pattern)

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
- Her / friend voice pass (active listening, friend reactions, pitch variance, FRIEND_VOICE_RULES) — see [her-voice-learnings.md](./her-voice-learnings.md)
- Hume-inspired: patient silence (1600ms distress), barge-in 750ms, reply-aware emotion, empathic listen copy — see [hume-voice-learnings.md](./hume-voice-learnings.md)

### Deferred

- Full Gemini Live WSS / Hume EVI WebSocket / OpenAI Realtime sessions
- Audio prosody analysis (Hume Expression Measurement)
- Gemini affective dialog & proactive audio API flags
- Full-duplex without echo guards
- Speculative LLM on partial STT
