# Voice platform learnings (Vapi, Retell, PolyAI)

Builder-focused voice agent stacks — not consumer companions, but **production patterns** Jessica should copy.

**Sources:** GTM Index, Thoughtly, Paperclipped enterprise guide 2026.

---

## Stack roles

| Platform | Best for | Latency class | Jessica parallel |
|----------|----------|---------------|------------------|
| **Vapi** | Mix STT + LLM + TTS providers | Sub-600ms E2E | Our modular chain (Azure STT + Groq + Azure TTS) |
| **Retell AI** | Managed phone agents, compliance | ~800ms | Reliability / health probes (`/health`, TTS probe) |
| **PolyAI** | Enterprise natural dialogue, topic shifts | Production-tuned | TRP interrupts, think-through, no script-y IVR |
| **ElevenLabs Agents** | Voice-forward single vendor | 75ms TTS TTFB | See [elevenlabs-voice-learnings.md](./elevenlabs-voice-learnings.md) |
| **Cartesia Sonic** | Cheapest ultra-fast TTS | ~40ms TTFB | Phase 5 TTS option |
| **Deepgram Nova** | ASR accuracy + speed | ~150ms STT | Azure STT today; partial REST chunks |

## Patterns to copy

### 1. No dead air on tool calls (OpenAI + Vapi)

While web lookup or slow LLM runs, speak a short filler **before** silence.

**Jessica:** `maybe_lookup_ack` → `fast_ack` on factual turns (`Hang on—` / `Let me check.`).

### 2. Interrupt = truncate what the model "said"

User must not see/hear content the assistant never delivered.

**Jessica:** `heardReplyOnInterrupt` trims chat bubble to `spokenPrefix` on barge-in.

### 3. Semantic turn detection

Distinguish pause-for-thought vs end-of-turn.

**Jessica:** `hasIncompleteThoughtEnding` + TRP-gated cooperative interrupt.

### 4. Enterprise dialogue (PolyAI)

Handle topic shifts without resetting to script.

**Jessica:** continuity follow-ups + memory profile, not menu trees.

## What we skip

- PSTN telephony / HIPAA contact-center compliance
- Multi-vendor orchestration UI (we own the app)
- Outbound dialer campaigns

## Phase 5 option

**Vapi + Deepgram + Cartesia + Groq** ≈ $0.10–0.20/min — reference architecture if Azure+Groq latency plateaus.
