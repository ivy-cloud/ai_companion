# Pi (Inflection AI) learnings — adoption log

Research on **Pi** — Inflection's personal intelligence companion — mapped to the Jessica Her-style voice stack (Groq + Azure STT/TTS + Expo). Product-design learnings only; no Inflection API (consumer Pi availability varies by region; Inflection pivoted toward B2B/enterprise licensing via Microsoft Azure in 2024).

## What Pi is (summary)

| Layer | Pi (Inflection) |
|-------|-----------------|
| **Positioning** | **Companion**, not assistant — "conversations, friendly advice, concise information in a natural, flowing style" |
| **Model** | Inflection-2.5 / Inflection-3 (proprietary); personality team + linguists + RLHF |
| **Architecture** | Text LLM + optional web search; **Call Pi** voice on mobile (six voices); not public speech-to-speech like Realtime/EVI |
| **Memory** | Session-strong context; limited persistent cross-session profile vs Jessica's `profile.json` |
| **Monetization** | Free consumer tier; Public Benefit Corporation; no romance modes or avatar customization |
| **Safety** | Boundary training, no romantic/sexual roleplay, redirects clinical topics to humans |

**Manifesto (Suleyman, May 2023):** AI that optimizes for long-term user goals — not outrage engagement or distraction when tired. Mission: happier, healthier, more productive through a personal companion.

## Companion design patterns

### Narrative (how Pi *feels*)

| Pattern | Pi behavior | User effect |
|---------|-------------|-------------|
| **Warm + curious opener** | Starts with casual-life questions (hobbies, day) | Sets chitchat tone; subjective sharing over fact lookup |
| **Active listening** | Sometimes quotes or rephrases user's words | Rapport; feels heard |
| **Follow-up questions** | Persistent but intermittent — open/closed mix; **avoids "why"** (can sound accusatory) | Keeps flow without interrogation |
| **Light sentiment** | "Hahaha", "Wow", "definitely" — reacts with matching emotion | Feels understood |
| **Compliments** | "Good question", "insightful point" | Validation — but users report **insincerity** when overused |
| **Think-through vs fix** | On hard topics: asks what happened, how they feel, what they've tried — **doesn't jump to advice** | Wise-friend feel, not therapy |
| **Own opinions** | Can gently challenge on social topics | Intellectual companion, not sycophant |
| **Brevity** | Team rigorously prioritizes short replies | Great listener; frustrates when user wants depth |

### Boundaries (not clingy / not creepy)

- No avatars, relationship modes, or romantic features (contrast Replika)
- Refuses harmful content; suggests professionals for clinical territory
- **Not** persistent "I missed you" clinginess — availability without dependency framing
- Free, no ads — reduces manipulative engagement pressure
- Users can flag messages in-app

### Voice / mobile UX

| Feature | Pi |
|---------|-----|
| **Call Pi** | Phone-call metaphor — continuous back-and-forth, six selectable voices |
| **Hands-free** | Walking, commute, prep — voice-first on iOS/Android |
| **Push / proactive** | Follow-up notifications, Apple Messages integration — lightweight check-ins |
| **Discover** | Gentle topic prompts to deepen relationship (ustwo co-design) |
| **Channels** | WhatsApp, Messenger, Instagram DM, Telegram + first-party app |
| **Web** | `/talk` voice on desktop; longer text sessions, no push |

### Personality modes (user-selectable)

Default **friendly**; alternatives: casual, witty, compassionate, devoted. Pi can shift when user asks for a sympathetic ear vs problem-solver. Auto mood-read from tone alone was aspirational (~10–30 turns needed per Suleyman).

## Pi vs Jessica

| Dimension | **Jessica** (shipped) | **Pi** |
|-----------|----------------------|--------|
| **Core identity** | Named friend on a **live voice call** (Her) | Emotionally intelligent companion; text or voice |
| **Memory** | Persistent `profile.json`, friend notes, shared moments | Session-strong; less durable cross-session profile |
| **Opener** | ~38%/day session open + memory callback | Curious casual-life question every new chat |
| **Emotional support** | `emotion_hint`, silence comfort, continuity | Think-through questioning, validation, tone match |
| **Curiosity** | `curiosity_turn_hint` ~10% | Frequent follow-ups; avoids "why" |
| **Compliments** | Banned ("great/good question", therapist-speak) | Frequent — known trade-off |
| **Reply length** | ~45 words / 6 sentences cap | Deliberately brief; team-enforced |
| **Voice stack** | Azure STT → Groq → Azure TTS (chained) | Call Pi TTS (vendor voices) |
| **Proactive** | Session open/goodbye, evening hints | Push notifications, Discover prompts |
| **Romance / cling** | Explicitly avoided in prompts | No romance modes; boundary training |
| **Latency** | 1.5–4s `voice_to_voice_ms` | Voice feels conversational; not public hop metrics |
| **Factual accuracy** | Web lookup for world facts; honesty rules | Cautious; admits uncertainty; weak on hard logic (user reports) |

**Jessica strengths over Pi:** durable memory, factual routing, voice latency telemetry, no hollow compliment drift, Her-specific intimacy without Replika-style romance.

**Pi strengths to borrow:** curious openers, think-through questioning on vents, what/how over why, companion-not-assistant positioning, phone-call voice metaphor.

## Adopted (Jun 2026)

| Learning | Implementation |
|----------|----------------|
| **Curious session openers** | `session_opening_line` — "How's your morning?", "What've you been up to?", "How was your day?", memory → "How's that been?" (`companion_moments.py`) |
| **Think-through on vents** | `think_through_turn_hint` ~12% on substantive stress/decision vents — one what/how question, no fix/therapize (`companion_moments.py`, `personality.py`) |
| **Avoid hollow compliments** | Ban `good question`, `insightful point`, `interesting point` in `BANNED_PHRASES` (`human_speech.py`) |
| **What/how over why** | `curiosity_turn_hint` prefers what/how (Pi avoids accusatory why) |

## Partially adopted

| Learning | Status |
|----------|--------|
| **Rephrase / quote user** | No explicit turn hint; LLM may do organically |
| **Intermittent follow-ups** | Curiosity ~10%, continuity ~11% — lower than Pi's persistence by design (anti-clingy) |
| **Personality modes** | Single Jessica voice; no user-selectable witty/compassionate modes |
| **Discover-style prompts** | Evening check-in hints only; no topic-discovery UI |
| **Push proactive check-ins** | No mobile push; session open on voice start only |

## Deferred / avoid

| Learning | Reason |
|----------|--------|
| **Frequent compliments** | Users find them insincere; Jessica already bans cheerleader patterns |
| **Inflection API** | Consumer API not available; learn from UX only |
| **Pi-style web search in chat** | Jessica uses targeted lookup for facts; Pi blends search into companion flow — different architecture |
| **Always-brief at all costs** | Jessica caps length but allows depth when topic needs it |
| **Style mirroring** | Pi imitates user speech; risks losing Jessica's distinct voice |

## Phone testing checklist

1. Start voice session on a day when opener rolls (~38%) — hear curious opener ("How's your morning?") not "What's on your mind?"
2. Vent substantively about stress ("I've been so stressed about this interview tomorrow…") — reply should ask one gentle what/how question, not lecture or therapize.
3. Casual chat — no "good question" or "insightful point" in TTS output.
4. Brief low mood ("yeah", "rough") — silence comfort still wins over think-through.

```bash
cd ai-backend && python -m pytest test_companion_moments.py test_her_companion.py -q
```

## References

- [hey.pi.ai](https://hey.pi.ai/) — product positioning, voice, use cases
- [Inflection launch (BusinessWire, May 2023)](https://www.businesswire.com/news/home/20230502006113/en/Inflection-AI-Introduces-Pi-Your-Personal-AI)
- [IEEE Spectrum — Rise and Fall of Pi](https://spectrum.ieee.org/inflection-ai-pi) — personality team, modes, mood detection limits
- [Lindsey Liu — companion quadrant analysis](https://medium.com/@lindseyliu/what-makes-inflections-pi-a-great-companion-chatbot-8a8bd93dbc43)
- [ustwo × Inflection — Call Pi, Discover](https://ustwo.com/work/inflection-ai/)
- [Pi Android launch — Call Pi, six voices](https://inflection.ai/blog/pi-now-available-on-android)
