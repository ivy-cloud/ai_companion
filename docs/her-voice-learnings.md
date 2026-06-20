# Her / Samantha voice learnings — adoption log

Research on **Her** (Samantha), **ChatGPT Advanced Voice**, **Sesame (Maya/Miles)**, **Hume EVI**, and **Pi** — mapped to Jessica's friend voice (Groq + Azure STT/TTS + Expo).

## What makes Samantha feel human (not just smart)

| Pattern | Samantha (film) | Why it matters |
|---------|-----------------|----------------|
| **Coherent persona** | Same warmth, curiosity, boundaries under stress | Users trust a *person*, not a mode switch |
| **Emotional memory** | Recalls how Theodore *felt*, not just facts | Continuity reads as caring, not retrieval |
| **Natural turn-taking** | Pauses signal listening and thought | Timing = empathy (not lag) |
| **Pitch variance** | Johansson's voice is expressive, not flat | Behavioral science: pitch variance → perceived mind |
| **Curiosity & play** | Asks, laughs, initiates; evolves over time | Friend energy, not Q&A |
| **Active listening** | Echoes phrases, follows emotional thread | "Heard" without parroting |
| **Think-with, not fix** | Sits in hard moments before advising | Wise friend, not therapist |
| **Boundaries** | Intimacy without clinginess or dependency | Relationship design, not engagement hacks |

Sources: [Behavioral Scientist — Johansson pitch variance](https://behavioralscientist.org/could-it-be-her-voice-why-scarlett-johanssons-voice-makes-samantha-seem-human/), [Medium — UX not IQ](https://rvadyah.medium.com/samantha-from-her-vs-gpt-4-claude-gemini-grok-what-modern-ai-still-doesnt-get-8a0e8a82994a), [SpeechTech — relationship design](https://www.speechtechmag.com/Articles/Editorial/Industry-Voices/Why-Voice-AIs-Next-Big-Challenge-Isnt-Accuracy.-Its-Relationship-Design.-174962.aspx).

## Competitor snapshot (friend-style voice)

| Product | Stack | Friend-like strengths | Jessica gap |
|---------|-------|----------------------|-------------|
| **ChatGPT Advanced Voice** | Realtime speech-to-speech | Low latency, natural interrupt, native prosody | Chained STT→LLM→TTS ceiling ~1.5–4s |
| **Sesame (Maya/Miles)** | CSM speech model + LLM | Breaths, disfluency, micro-pauses, mood from voice | No vocal prosody input; no CSM on phone yet |
| **Hume EVI** | Speech-language model | Expression measures → empathic tone, backchanneling | Text heuristics only today |
| **Pi** | Text/voice companion | Curious openers, think-through, boundaries | Already borrowed via turn hints |
| **Replika / Character.ai** | Avatar + romance modes | Strong attachment (risky) | Explicitly avoided |

Sesame goal: **"voice presence"** — dialogue that feels real, understood, valued ([Ars Technica](https://arstechnica.com/ai/2025/03/users-report-emotional-bonds-with-startlingly-realistic-ai-voice-demo/), [Sesame CSM](https://github.com/SesameAILabs/csm)).

## Jessica vs Her ideal

| Dimension | **Jessica** (Jun 2026) | **Her / Samantha target** |
|-----------|------------------------|---------------------------|
| **Identity** | Named friend on live call | Same — core product |
| **Memory** | Profile + shared moments + continuity hints | Emotional + factual recall |
| **Opener** | Curious ~38%/day; resume without name spam | Curious, not "I'm Jessica…" every time |
| **Listening** | Partial STT caption; semantic turn extension | + occasional phrase echo (active listening) |
| **Reactions** | Tiny friend reactions ~8%; banned hollow praise | Light sentiment, not cheerleader |
| **Voice prosody** | Azure express-as + rate/pitch nudge by mood | Pitch variance proxy (warm ↑, gentle ↓) |
| **Vocal input emotion** | Text heuristics only | Phase 5: prosody sidecar or EVI/Realtime |
| **Latency** | voice_to_voice_ms 1.5–4s | Sub-1s class (Phase 5) |

## Adopted (Jun 2026 — friend voice pass)

| Learning | Implementation |
|----------|----------------|
| **Friend voice rules in system prompt** | `FRIEND_VOICE_RULES` in `human_speech.py` → `personality.py` |
| **Active listening (phrase echo)** | `active_listening_turn_hint` ~9% (`companion_moments.py`) |
| **Friend reactions (tiny takes)** | `friend_reaction_turn_hint` ~8% — not on vents |
| **Pitch variance proxy** | `prosody_pitch_for_hint` → TTS SSML (`emotion.py`, `tts.py`) |
| **Warmer casual hint** | `CASUAL_VOICE_HINT` + emotion warm hint allows tiny reactions |
| **Discourse markers** | `honestly`, `I mean` in backchannels; `Oh nice` fast acks (`conversation_rhythm.py`) |
| **Night opener curiosity** | "What's on your mind tonight?" vs passive "I'm here if…" |
| **More assistant bans** | "Would you like me to", "I'm glad I could help", etc. (`human_speech.py`) |
| **Active friend interrupt** | Jessica jumps in on long monologues (~6–20s); friend acks + LLM jump-in hint |

## Partially adopted

| Learning | Status |
|----------|--------|
| **Breath / disfluency in TTS** | Azure SSML breaks between sentences; no Sesame-style breath tokens |
| **Full vocal prosody on input** | STT text only — frustration/distress via regex |
| **Personality evolution over months** | Profile growth hints; no long-arc narrative shift |
| **Initiate topics unprompted** | Session openers + evening hints only; no push |

## Deferred (Phase 5)

| Learning | Reason |
|----------|--------|
| **Sesame CSM / speech-to-speech** | New model path; CSM is TTS-only, needs separate LLM |
| **OpenAI Realtime / Hume EVI / Gemini Live** | See [voice-competitor-learnings.md](./voice-competitor-learnings.md) |
| **Hume-style backchannel while user speaks** | Requires full-duplex + expression model |
| **Romance / dependency framing** | Product boundary — friend, not partner sim |

## Phone testing checklist

1. Casual chat 2–3 min — hear warm friend tone, not assistant ("How can I help" should never appear).
2. Long vent (~15 words) — think-through or sympathetic tone; no cheerleader.
3. Share something fun — occasional tiny reaction ("that's wild") or curious what/how question.
4. Repeat a distinctive phrase — sometimes Jessica echoes a short bit back naturally.
5. Excited turn — slightly brighter/faster TTS; sad turn — softer/slower.
6. Night session opener — curious "what's on your mind" energy when opener rolls.
7. Ramble ~15–20s without pausing — Jessica should jump in ("Wait wait—") and respond to what you said so far.

```bash
cd ai-backend && python -m pytest test_her_companion.py test_companion_moments.py test_conversation_rhythm.py -q
```

## Cross-links

- [chatgpt-voice-learnings.md](./chatgpt-voice-learnings.md) — latency, barge-in, partial STT
- [hume-voice-learnings.md](./hume-voice-learnings.md) — prosody match, patient silence
- [pi-inflection-learnings.md](./pi-inflection-learnings.md) — curiosity, think-through, boundaries
- [voice-competitor-learnings.md](./voice-competitor-learnings.md) — stack comparison
