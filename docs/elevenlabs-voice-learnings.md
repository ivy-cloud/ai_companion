# ElevenLabs voice learnings

Research sweep Jul 2026. ElevenLabs leads **TTS realism** and ships **ElevenAgents** (conversational AI on their own voice stack).

**Sources:** ElevenLabs docs, Ortem/Vapi/Retell comparisons 2026.

---

## What ElevenLabs does well

| Pattern | Detail | Jessica adoption |
|---------|--------|------------------|
| **Ultra-low TTS latency** | Flash ~75ms TTFB vs 300–500ms typical | Azure today; ElevenLabs optional TTS layer Phase 5 |
| **Emotion + pacing control** | Turbo v2.5 with nuanced expression | ✓ Azure express-as + `prosody_rate_for_hint` |
| **Voice cloning / brand voice** | 30s sample → consistent persona | Jessica = fixed friend voice; env gender picker |
| **Built-in turn-taking** | Interruption + language detect in ElevenAgents | ✓ barge-in + TRP gating (chained stack) |
| **Multilingual** | 70+ languages in Agents product | English-first; STT/TTS locale later |

## Builder takeaway

ElevenLabs is the right pick when **voice quality is the product**. Jessica is companion-first — we borrow **expressiveness targets**, not full migration, unless Azure ceiling bites.

## Phone test

Compare Jessica's excited vs calm lines — express-as should shift audibly. If flat, tune `AZURE_SPEECH_RATE_MAIN` and emotion hints.

## Deferred

- ElevenLabs Conversational AI WebSocket as TTS+orchestration replacement
- Voice clone for user-custom Jessica timbre
