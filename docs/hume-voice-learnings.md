# Hume AI voice learnings — adoption log

Research from [Hume EVI docs](https://dev.hume.ai/docs/speech-to-speech-evi/overview), [turn detection](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/turn-detection), [interruption](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption), and [EVI 3 blog](https://www.hume.ai/blog/introducing-evi-3), mapped to the Jessica phone stack (Expo + Azure STT/TTS + Groq stream).

## What Hume does (summary)

| Layer | Hume EVI |
|-------|----------|
| **Architecture** | Single **speech-language model (SLM)** — same intelligence handles transcription, language, and speech in one autoregressive stream (T + V tokens). |
| **Transport** | Client WebSocket `wss://api.hume.ai/v0/evi` — `audio_input` up, `user_message` + `audio_output` + `assistant_end` down. |
| **Prosody / emotion** | Streaming **expression measures** (tune, rhythm, timbre) on user speech; SLM “acts out” replies with empathic tone — not word-by-word TTS. |
| **Turn-taking** | Prosody-aware end-of-turn; tunable `end_of_turn_silence_ms` (default **800ms**), `speech_detection_threshold`, `prefix_padding_ms` (**300ms**). |
| **Interruption** | Always interruptible; `min_interruption_ms` default **800ms** before yielding floor. |
| **Latency target** | ~**300ms** voice-to-voice; TTFT is the key metric. SLM can answer first, then merge supplemental LLM (Groq/Kimi pattern). |
| **UX** | EVI Playground / app — continuous orb, live expression labels, queued audio playback, `user_interruption` stops TTS immediately. No “session paused” dead air. |
| **Hybrid pattern** | Supplemental LLM text → EVI SLM voices it with full conversational context (their [Groq + Kimi case study](https://www.hume.ai/blog/case-study-hume-groq)). |

## Jessica vs Hume

| Dimension | Jessica (today) | Hume EVI |
|-----------|-----------------|----------|
| **Speech path** | Azure STT → Groq LLM stream → Azure TTS (`mstts:express-as` + SSML prosody) | End-to-end speech-to-speech SLM |
| **User emotion** | Text heuristics on transcript (`emotion.py`) | Vocal prosody model + language |
| **Assistant voice** | Per-turn `emotion_hint` + `express_style`; preset Sara/Guy | SLM-generated voice matched to user “vibe” |
| **Turn end** | Meter silence **1000ms** (+ semantic extension, patient **1600ms** when distress detected in partial STT) | Default **800ms** silence; patient config **2000ms** |
| **Barge-in** | Half-duplex + monitor at **-42 dBFS**, **750ms** sustained speech | Full-duplex interrupt, **800ms** default |
| **Latency** | Typical `voice_to_voice_ms` **1.5–4s** (STT + LLM + TTS hops) | Sub-**300ms** target on their stack |
| **Live feel** | Opening mic…, partial STT caption, mute/unmute, Done speaking | Always-streaming WebSocket session |
| **Expression UI** | Phase label + wave + live transcript | Orb + expression score chips |

**Core gap:** Jessica cannot hear *how* you said something — only *what*. Closing that without Hume requires either vocal prosody STT sidecar or full EVI/Realtime migration (Phase 5).

## Adopted (Jun 2026)

| Learning | Implementation |
|----------|----------------|
| **Patient turn-taking for low mood** | `resolveSilenceEndMs` / `SILENCE_END_PATIENT_MS` (1600ms) when rolling partial STT matches distress cues (`conversationMode.ts`, `index.tsx`). |
| **Interruption resilience** | `BARGE_IN_MIN_SPEECH_MS` **580 → 750** (~Hume `min_interruption_ms` 800) — fewer false cuts from backchannels/noise. |
| **Reply-aware TTS emotion** | `_turn_emotion(..., reply_text=reply)` so `detect_emotion_hint` can refine mood from Jessica’s actual words (`main.py`, canned + stream done). |
| **Prosody vibe match** | `prosody_rate_for_hint` — slower for sympathetic/gentle, faster for excited (`emotion.py`, `tts.py`). |
| **Text prosody proxy** | `prosody_vibe_turn_hint` — frustration → apologetic tone; caps/exclamation → energy match; curt replies → brief (`emotion.py`, `personality.py`). |
| **Frustration → sympathetic** | Frustration regex in `detect_emotion_hint` → `sympathetic` + friendly express-as. |
| **Empathic listen copy** | “pause when ready” listening hint (`voiceFlow.ts`). |

## Partially adopted

| Learning | Status |
|----------|--------|
| **Expression-aware LLM** | User prosody scores are not available; text `emotion_hint` + turn hints approximate empathic routing. |
| **Prefix padding** | `RECORDING_TAIL_MS` (180ms) + `prefix_padding_ms`-style lead-in — shorter than Hume 300ms default. |
| **Sub-300ms voice-to-voice** | Fast ack + incremental TTS help; architecture still multi-hop. |
| **Queued streaming TTS** | Incremental TTS queue exists; not same-chunk SLM co-generation. |

## Deferred (Phase 5 — full EVI / speech-to-speech)

| Learning | Reason |
|----------|--------|
| **Hume EVI WebSocket** | New API keys, billing, session protocol; `realtime_voice.py` stub only. |
| **Vocal prosody on input** | No Hume Expression Measurement or equivalent on device mic today. |
| **SLM single-model speech** | Would replace Groq + Azure TTS orchestration entirely. |
| **Client EVI orb / expression chips** | Product UX pass; not required for core phone companion. |

## Phone testing checklist

1. Say *“I'm really sad and…”* → pause mid-thought → mic should stay open longer (~1.6s silence) before auto-send vs normal ~1s.
2. Normal chat (*“what's up”*) → still commits at ~1s silence.
3. Distress turn → Jessica reply with sympathetic content should use slightly slower TTS (listen for unhurried pace).
4. Excited reply (*“That's amazing!”*) → slightly brighter/faster express + prosody when backend sets `excited`.
5. Interrupt during TTS with sustained speech ~0.75s — should still barge-in; brief “uh huh” less likely to cut off.
6. After TTS, **Opening mic…** → **Listening…** with “pause when ready” hint (no Listening paused).
7. `turn_summary` / `voice_to_voice_ms` still logged — expect higher than Hume’s 300ms target until Phase 5.

```bash
tail -f ai-backend/data/session_log.jsonl | grep turn_summary
```

## References

- [EVI overview](https://dev.hume.ai/docs/speech-to-speech-evi/overview)
- [Turn detection](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/turn-detection)
- [Interruption](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption)
- [EVI FAQ](https://dev.hume.ai/docs/speech-to-speech-evi/faq)
- [EVI 3 introduction](https://www.hume.ai/blog/introducing-evi-3)
- [Hume + Groq case study](https://www.hume.ai/blog/case-study-hume-groq)
