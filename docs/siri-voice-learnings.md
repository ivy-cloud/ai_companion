# Siri AI (2026) voice learnings

Apple's **Siri AI** (iOS 27 / WWDC 2026) — assistant-first, but sets UX bars Jessica should match where we overlap.

**Sources:** Apple Newsroom Jun 2026, The Verge, MacRumors, Ars Technica.

---

## What Siri AI emphasizes

| Feature | Detail | Jessica relevance |
|---------|--------|-------------------|
| **Conversational continuity** | Dedicated Siri app; history syncs iCloud across devices | ✓ chat history + session resume hints |
| **Personal context** | Messages, mail, photos semantic index | Partial — `profile` + saved notes only (privacy choice) |
| **Expressive customizable voice** | Pace + expressiveness sliders on Pro hardware | Env: `AZURE_SPEECH_RATE_MAIN`, express-as; no user slider yet |
| **Natural dictation polish** | Capitalization, punctuation while speaking | STT + `polish_for_speech` on output, not input |
| **On-screen awareness** | Visual Intelligence + in-app actions | Deferred — voice-only phone focus |
| **Multi-step tasks** | "Beyond one-shot" scripted demos | ✓ voice_text_tasks (draft, quiz, brainstorm) |

## What Jessica should not become

- System automation hub (smart home, app actions) — out of scope
- Web-scale personal data index — privacy / trust tradeoff
- Generic "how can I help" assistant opener

## Copy for friend companion

| Siri pattern | Friend-voice adaptation |
|--------------|-------------------------|
| Resume conversation on new device | `session_opening_line(..., resume=True)` — no re-intro |
| Tuned speaking pace | `prosody_rate_for_hint` + singing prosody presets |
| Polished spoken output | `polish_for_speech` / `trim_for_voice` |

## Deferred

- On-device speech-language model (Apple Silicon only)
- EU/China regulatory variants
- Visual Intelligence multimodal
