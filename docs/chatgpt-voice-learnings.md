# ChatGPT voice learnings — adoption log

Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).

## Adopted (Jun 2026)

| Learning | Implementation |
|----------|----------------|
| **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
| **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
| **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
| **voice_to_voice_ms** | `turn_summary` field: `user_speech_end` → `first_audio_play` (`voiceLatency.ts`). |
| **Softer half-duplex / barge-in** | Barge-in monitor at `BARGE_IN_SPEECH_LEVEL_DB` during **thinking**, **streaming**, and **speaking** — full listen stays blocked during TTS; monitor path stays hot for interrupt. |
| **Streaming partial STT** | Rolling ~900ms recording snapshots → `POST /stt?partial=1` → live italic caption under **Listening…** (`streamingStt.ts`, `VoiceHero.tsx`). Final turn still commits on end-of-silence / Done speaking (no double-send). |

## Partially adopted

| Learning | Status |
|----------|--------|
| **Earlier LLM on partial STT** | Thinking phase starts after silence commit; partial caption is display-only today. Speculative LLM on partials deferred to Phase 5 (echo / wrong-turn risk). |
| **Azure continuous recognition WebSocket** | Interim: incremental REST chunks. Full SDK/WebSocket proxy is Phase 5 optional upgrade. |

## Deferred (Phase 5)

| Learning | Reason |
|----------|--------|
| **OpenAI Realtime API** (speech-to-speech) | New backend session, turn protocol, echo model — see [COMPANION_ROADMAP.md](../COMPANION_ROADMAP.md) Phase 5. |
| **Full-duplex conversation** | Phone speaker + mic echo; half-duplex + barge-in monitor is the safe default. |

## Phone testing checklist

1. After assistant speaks, UI should briefly show **Opening mic…** then **Listening…** (not Listening paused).
2. Tap **Mute** during TTS — audio stops, **Unmute** restores.
3. Say *"I want to go and"* → pause → mic reopens once; continue *"then get coffee"* → single combined message.
4. While speaking a longer sentence, italic **live transcript** should update every ~1s under **Listening…**.
5. Interrupt during **Thinking…** or **Speaking** by talking loudly ~0.6s — assistant stops, mic captures your interrupt.
6. `turn_summary` in session log should include `voice_to_voice_ms` (typical 1.5–4s depending on LLM/TTS).

```bash
tail -f ai-backend/data/session_log.jsonl | grep turn_summary
```
