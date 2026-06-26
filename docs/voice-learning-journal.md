# Jessica voice learning journal

Auto-appended by `scripts/daily_voice_learning.py`. Review before editing `human_speech.py`.


## 2026-06-18

**Scan:** 0 chat turn(s) in `session_log.jsonl` at run time (log held voice/STT events only; prior phone-test turns were trimmed). Cross-checked against failure table in `docs/natural-human-chat.md`.

**5 finding(s)** from documented Jun 2026 phone sessions:

1. **assistant_opener**
   - User: "Hello, Jessica King."
   - Reply: "I'm glad we connected - how's your day going so far?"
2. **hollow_praise**
   - User: "And I want to tell you that I'm boring. January."
   - Reply: "You're born in January, nineteen seventy nine. That's really cool!"
3. **therapist_probe**
   - User: "OK."
   - Reply: "You're being a bit hard on yourself… What's making you feel that way today?"
4. **robotic_callback**
   - User: "Hello."
   - Reply: "You said you were born in nineteen seventy nine, right?"
5. **cheerleader_platitude**
   - User: "Jessica, I feel like it's too late for."
   - Reply: "It's never too late for anything! What's on your mind…"

6. **fix_it_list**
   - User: "What should I do now?"
   - Reply: "It's super late, so maybe wind down a bit? You could grab a drink, listen to some calm music, or just chill for a bit."

**Auto-applied to `human_speech.py` BANNED_PHRASES:**
- `grab a drink`
- `listen to some calm music`
- `listen to calm music`
- `wind down a bit`

**Rule changes applied this pass (code, not journal-only):**
- Platitude bans + `_tame_enthusiasm` (`never too late`, `you've got this`, `everything happens for a reason`)
- Advice-list suppression in `FRIEND_VOICE_RULES`, `CASUAL_VOICE_HINT`, vent/advice routing in `companion_moments.py`
- Stronger `acknowledgment_turn_hint` ("do not interpret their ack as distress")
- Session openers → curious tails (`What's on your mind tonight?`) — no "glad we connected"
- Vent fragments → `vent_turn_hint` + `think_through_turn_hint`; fix-it lists unless `is_advice_seeking`

**Suggested rule additions (review first):**
- Re-run phone test checklist in `docs/natural-human-chat.md` after next live session

## 2026-06-23

**Scan:** 0 chat turn(s) in `session_log.jsonl` (500 voice/STT events only; no `user`/`reply` pairs). Deep pass reviewed `natural-human-chat.md`.

**Code applied this pass:**
- `_cleanup_polish_artifacts()` — fixes broken TTS after banned-phrase stripping (orphan `for anything`, dossier `born in … right?`, `-?` junk)
- `polish_for_speech` no longer falls back to raw toxic text when strip empties the reply
- Longer `never too late for anything` ban ordered before shorter `it's never too late` match
- `is_greeting()` + greeting turn hint — curious friend hello, no dossier callback on bare hello
- Re-ran `daily_voice_learning.py --hours 0 --deep` — no new session-log findings

**Next:** Re-run phone test checklist in `natural-human-chat.md` after next live session.

## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_

## 2026-06-23 (overnight autonomous pass)

**Idle learning:** `install_idle_learning.sh` → `com.ivy.jessica-voice-learning` launchd (20 min idle, 6h lookback).

**Deep scan:** 0 chat turns in `session_log.jsonl` (voice telemetry only). Cross-checked all voice docs vs code.

**Shipped in `74573f0`:**
- Cooperative interrupt: 12s @ 15+ words; `Hold on—` / `Right—` acks
- Incomplete vents → think-through always (no roll); boredom vent routing
- Active listening from 8 words; greeting hint blocks dossier on hello
- Web synthesis friend tone; polish artifact cleanup for session-log failures
- Partial-STT roll guard + `isOnlyOneRecordingStorm` mic recovery

**Tests:** backend 97 passed, frontend 22 passed.

**Morning briefing:** `docs/OVERNIGHT_BRIEFING.md`


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `her-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Her** (Samantha), **ChatGPT Advanced Voice**, **Sesame (Maya/Miles)**, **Hume EVI**, and **Pi** — mapped to Jessica's friend voice (Groq + Azure STT/TTS + Expo).
- | Pattern | Samantha (film) | Why it matters |
- |---------|-----------------|----------------|
- | **Coherent persona** | Same warmth, curiosity, boundaries under stress | Users trust a *person*, not a mode switch |
- | **Emotional memory** | Recalls how Theodore *felt*, not just facts | Continuity reads as caring, not retrieval |
- | **Natural turn-taking** | Pauses signal listening and thought | Timing = empathy (not lag) |
_Full file: docs/her-voice-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `hume-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research from [Hume EVI docs](https://dev.hume.ai/docs/speech-to-speech-evi/overview), [turn detection](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/turn-detection), [interruption](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption), and [EVI 3 blog](https://www.hume.ai/blog/introducing-evi-3), mapped to the Jessica phone stack (Expo + Azure STT/TTS + Groq stream).
- | Layer | Hume EVI |
- |-------|----------|
- | **Architecture** | Single **speech-language model (SLM)** — same intelligence handles transcription, language, and speech in one autoregressive stream (T + V tokens). |
- | **Transport** | Client WebSocket `wss://api.hume.ai/v0/evi` — `audio_input` up, `user_message` + `audio_output` + `assistant_end` down. |
- | **Prosody / emotion** | Streaming **expression measures** (tune, rhythm, timbre) on user speech; SLM “acts out” replies with empathic tone — not word-by-word TTS. |
_Full file: docs/hume-voice-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `pi-inflection-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).
- | Layer | Pi (Inflection) |
- |-------|-----------------|
- | **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
- | **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
- | **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
_Full file: docs/pi-inflection-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `voice-competitor-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:
- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)
- [her-voice-learnings.md](./her-voice-learnings.md) — Samantha / Sesame friend voice patterns
_Full file: docs/voice-competitor-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-23
_No AI-like patterns in recent session_log turns._

**Deep pass — review `voice-competitor-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:
- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)
- [her-voice-learnings.md](./her-voice-learnings.md) — Samantha / Sesame friend voice patterns
_Full file: docs/voice-competitor-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-24 (autonomous pass — iOS mic + setback voice)

**Scan:** 0 chat turn(s) in `session_log.jsonl`. `daily_voice_learning.py --hours 0 --deep` — no new patterns.

**iOS mic recovery (`listen_open_failed` storm):**
- `ONLY_ONE_STORM_COOLDOWN_MS` 5s → 12s; `recordingStormBackoffDelayMs` + `shouldBlockWatchdogDuringRecordingStorm`
- Watchdog idle/listening/opening-mic paths skip during storm backoff
- `ensureConversationListening` defers when storm + mic open in flight; `schedule_listen` honors backoff
- Discard stale `recordingRef` before prepare; `startConversationRecording({ slotSettleMs })` for iOS slot settle
- Partial-STT roll blocked during storm; failure path schedules backoff instead of immediate reopen
- Fixed inline only-one retry using fresh `retryGen` (was invalidated by gen bump)

**Friend voice:**
- Setback news (`failed interview`, `didn't get`, `rejected`) → always-on think-through hint (Damn / one what-how)

**Hygiene:** `docs/voice-learning*.log` in `.gitignore`

**Tests:** backend 98 passed, frontend 22 passed.

**Phone retest:** Hello opener + incomplete vent after a multi-turn session (mic storm target).


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `her-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Her** (Samantha), **ChatGPT Advanced Voice**, **Sesame (Maya/Miles)**, **Hume EVI**, and **Pi** — mapped to Jessica's friend voice (Groq + Azure STT/TTS + Expo).
- | Pattern | Samantha (film) | Why it matters |
- |---------|-----------------|----------------|
- | **Coherent persona** | Same warmth, curiosity, boundaries under stress | Users trust a *person*, not a mode switch |
- | **Emotional memory** | Recalls how Theodore *felt*, not just facts | Continuity reads as caring, not retrieval |
- | **Natural turn-taking** | Pauses signal listening and thought | Timing = empathy (not lag) |
_Full file: docs/her-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `hume-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research from [Hume EVI docs](https://dev.hume.ai/docs/speech-to-speech-evi/overview), [turn detection](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/turn-detection), [interruption](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption), and [EVI 3 blog](https://www.hume.ai/blog/introducing-evi-3), mapped to the Jessica phone stack (Expo + Azure STT/TTS + Groq stream).
- | Layer | Hume EVI |
- |-------|----------|
- | **Architecture** | Single **speech-language model (SLM)** — same intelligence handles transcription, language, and speech in one autoregressive stream (T + V tokens). |
- | **Transport** | Client WebSocket `wss://api.hume.ai/v0/evi` — `audio_input` up, `user_message` + `audio_output` + `assistant_end` down. |
- | **Prosody / emotion** | Streaming **expression measures** (tune, rhythm, timbre) on user speech; SLM “acts out” replies with empathic tone — not word-by-word TTS. |
_Full file: docs/hume-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `pi-inflection-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).
- | Layer | Pi (Inflection) |
- |-------|-----------------|
- | **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
- | **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
- | **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
_Full file: docs/pi-inflection-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `voice-competitor-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:
- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)
- [her-voice-learnings.md](./her-voice-learnings.md) — Samantha / Sesame friend voice patterns
_Full file: docs/voice-competitor-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `her-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Her** (Samantha), **ChatGPT Advanced Voice**, **Sesame (Maya/Miles)**, **Hume EVI**, and **Pi** — mapped to Jessica's friend voice (Groq + Azure STT/TTS + Expo).
- | Pattern | Samantha (film) | Why it matters |
- |---------|-----------------|----------------|
- | **Coherent persona** | Same warmth, curiosity, boundaries under stress | Users trust a *person*, not a mode switch |
- | **Emotional memory** | Recalls how Theodore *felt*, not just facts | Continuity reads as caring, not retrieval |
- | **Natural turn-taking** | Pauses signal listening and thought | Timing = empathy (not lag) |
_Full file: docs/her-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `hume-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research from [Hume EVI docs](https://dev.hume.ai/docs/speech-to-speech-evi/overview), [turn detection](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/turn-detection), [interruption](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption), and [EVI 3 blog](https://www.hume.ai/blog/introducing-evi-3), mapped to the Jessica phone stack (Expo + Azure STT/TTS + Groq stream).
- | Layer | Hume EVI |
- |-------|----------|
- | **Architecture** | Single **speech-language model (SLM)** — same intelligence handles transcription, language, and speech in one autoregressive stream (T + V tokens). |
- | **Transport** | Client WebSocket `wss://api.hume.ai/v0/evi` — `audio_input` up, `user_message` + `audio_output` + `assistant_end` down. |
- | **Prosody / emotion** | Streaming **expression measures** (tune, rhythm, timbre) on user speech; SLM “acts out” replies with empathic tone — not word-by-word TTS. |
_Full file: docs/hume-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `pi-inflection-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).
- | Layer | Pi (Inflection) |
- |-------|-----------------|
- | **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
- | **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
- | **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
_Full file: docs/pi-inflection-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `voice-competitor-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:
- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)
- [her-voice-learnings.md](./her-voice-learnings.md) — Samantha / Sesame friend voice patterns
_Full file: docs/voice-competitor-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `her-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Her** (Samantha), **ChatGPT Advanced Voice**, **Sesame (Maya/Miles)**, **Hume EVI**, and **Pi** — mapped to Jessica's friend voice (Groq + Azure STT/TTS + Expo).
- | Pattern | Samantha (film) | Why it matters |
- |---------|-----------------|----------------|
- | **Coherent persona** | Same warmth, curiosity, boundaries under stress | Users trust a *person*, not a mode switch |
- | **Emotional memory** | Recalls how Theodore *felt*, not just facts | Continuity reads as caring, not retrieval |
- | **Natural turn-taking** | Pauses signal listening and thought | Timing = empathy (not lag) |
_Full file: docs/her-voice-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `pi-inflection-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).
- | Layer | Pi (Inflection) |
- |-------|-----------------|
- | **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
- | **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
- | **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
_Full file: docs/pi-inflection-learnings.md_


## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-24 (voice memory + TRP interrupt)

**Phone bugs:** Jessica only heard the last few words of a turn; cooperative interrupt fired mid-clause.

**Root causes:**
- Semantic turn extension buffered partial STT, then `partialUtteranceBufferRef` was cleared on mic reopen — only the tail was sent.
- Companion interrupt fired on sustained speech with no micro-pause or clause boundary (not at TRPs).

**Fixes:**
- Preserve utterance buffer across semantic-extension listen reopen (`preserveUtteranceBufferRef`).
- Gate cooperative interrupt on 250–920ms clause pause + sentence/clause punctuation (or meter-only pause when partial STT off); never mid-word.
- Chat history window 8 → 12 exchanges; short factual voice clauses keep thread.

**Tests:** `conversationMode.test.ts` TRP gating; `test_memory.py` short factual history keep.

## 2026-06-24
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `her-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Her** (Samantha), **ChatGPT Advanced Voice**, **Sesame (Maya/Miles)**, **Hume EVI**, and **Pi** — mapped to Jessica's friend voice (Groq + Azure STT/TTS + Expo).
- | Pattern | Samantha (film) | Why it matters |
- |---------|-----------------|----------------|
- | **Coherent persona** | Same warmth, curiosity, boundaries under stress | Users trust a *person*, not a mode switch |
- | **Emotional memory** | Recalls how Theodore *felt*, not just facts | Continuity reads as caring, not retrieval |
- | **Natural turn-taking** | Pauses signal listening and thought | Timing = empathy (not lag) |
_Full file: docs/her-voice-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `hume-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research from [Hume EVI docs](https://dev.hume.ai/docs/speech-to-speech-evi/overview), [turn detection](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/turn-detection), [interruption](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/interruption), and [EVI 3 blog](https://www.hume.ai/blog/introducing-evi-3), mapped to the Jessica phone stack (Expo + Azure STT/TTS + Groq stream).
- | Layer | Hume EVI |
- |-------|----------|
- | **Architecture** | Single **speech-language model (SLM)** — same intelligence handles transcription, language, and speech in one autoregressive stream (T + V tokens). |
- | **Transport** | Client WebSocket `wss://api.hume.ai/v0/evi` — `audio_input` up, `user_message` + `audio_output` + `assistant_end` down. |
- | **Prosody / emotion** | Streaming **expression measures** (tune, rhythm, timbre) on user speech; SLM “acts out” replies with empathic tone — not word-by-word TTS. |
_Full file: docs/hume-voice-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `pi-inflection-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).
- | Layer | Pi (Inflection) |
- |-------|-----------------|
- | **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
- | **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
- | **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
_Full file: docs/pi-inflection-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `voice-competitor-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Consolidated comparison for phone conversation mode (Jun 2026). Detail per vendor:
- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md)
- [hume-voice-learnings.md](./hume-voice-learnings.md)
- [gemini-live-learnings.md](./gemini-live-learnings.md)
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — companion tone/UX (not voice stack)
- [her-voice-learnings.md](./her-voice-learnings.md) — Samantha / Sesame friend voice patterns
_Full file: docs/voice-competitor-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `gemini-live-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed patterns from [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api) docs (Jun 2026), mapped to Jessica (Expo + Azure STT/TTS + Groq stream).
- Gemini Live is a **stateful WebSocket (WSS)** speech-to-speech stack — not a chain of STT → LLM → TTS. A **native audio model** (`gemini-live-2.5-flash-native-audio`, migrating to `gemini-3.1-flash-live-preview`) consumes continuous **16 kHz PCM** input and streams **24 kHz PCM** output in one session.
- | Aspect | Gemini Live | Jessica (today) |
- |--------|-------------|-----------------|
- | Transport | WSS (WebRTC via partners: LiveKit, Pipecat, Fishjam) | REST + NDJSON stream + Azure TTS clips |
- | Turn detection | **Server VAD** (configurable) or manual `activityStart`/`activityEnd` | Client silence meter + semantic incomplete-thought extension |
_Full file: docs/gemini-live-learnings.md_


## 2026-06-25
_No AI-like patterns in recent session_log turns._

**Deep pass — review `natural-human-chat.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.
- **Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).
- 
- | Source | What it actually tells us |
- |--------|---------------------------|
- | **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
_Full file: docs/natural-human-chat.md_


## 2026-06-26
_No AI-like patterns in recent session_log turns._

**Deep pass — review `chatgpt-voice-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research-backed UX and latency patterns from ChatGPT Advanced Voice / Realtime API docs, mapped to the Jessica phone voice stack (Expo + Azure STT/TTS + Groq stream).
- | Learning | Implementation |
- |----------|----------------|
- | **Always feel live** | Idle during post-TTS cooldown shows **Opening mic…** instead of Listening paused (`voiceFlow.ts`, `micOpeningHint` in `index.tsx`). |
- | **Escape hatches** | **Done speaking** always visible while listening in conversation mode; **Mute / Unmute** during assistant TTS (`VoiceHero.tsx`). |
- | **Semantic turn extension** | STT ending on trailing conjunctions/fillers (EN + ZH) reopens mic once and buffers partial text (`hasIncompleteThoughtEnding`, `processVoiceUtterance`). |
_Full file: docs/chatgpt-voice-learnings.md_


## 2026-06-26
_No AI-like patterns in recent session_log turns._

**Deep pass — review `pi-inflection-learnings.md`** against `human_speech.py` / turn hints.
Sample bullets from doc:
- Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).
- | Layer | Pi (Inflection) |
- |-------|-----------------|
- | **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
- | **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
- | **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
_Full file: docs/pi-inflection-learnings.md_

