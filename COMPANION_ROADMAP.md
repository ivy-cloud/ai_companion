# Companion roadmap

Phased path toward a **Her**-style voice companion: warm, intimate, remembers you, natural speech, grows over time — never clingy or creepy.

## Phase 1 — Conversation quality (shipped)

- Saved friend notes in system prompt on normal turns
- Voice length caps (~2 sentences / ~16 words)
- Mic echo suppression and clearer error copy

## Phase 2 — Latency (shipped)

- Single-clip TTS prefetch where possible
- `turn_summary` timing in session log
- Post-TTS listen cooldown (700ms) for echo safety

## Phase 3 — Polish (shipped)

- End conversation control
- Health preflight before voice sessions
- Speaking-phase recovery watchdog
- Louder TTS failure hints

## Growth & attunement (shipped — Jun 2026 overnight)

- `profile_growth.py`: structured prefs, remember/correct, **reflection memories** (`user_shared_moment`), usage **skill hints** in casual turn hints
- `companion_moments.py`: optional session opener (~38%/day), time-of-day bands, evening check-in turn hints; openers prefer shared moments when present
- `GET /companion/session-open` + frontend `speakSessionOpening` (no double mic-open race)
- Emotional hints + rhythm tuned for friend tone (not assistant / therapist)
- Frontend `conversationState.ts`: speaking-phase blockers + watchdog recovery when TTS refs clear but phase stuck

## Her attunement (Jun 2026 — continued)

- **Continuity** — `emotional_continuity_turn_hint` weaves prior `user_shared_moment` (~11% casual turns)
- **Curiosity** — `curiosity_turn_hint` for gentle Her-style question back (~10%)
- **Silence comfort** — `silence_comfort_turn_hint` when brief or low mood
- **Session goodbye** — `GET /companion/session-goodbye` + spoken farewell on End conversation
- **Skill hints UI** — unlocked labels from `/health` in app header
- **Journal echo** — `journal_reflection_hint` for optional shared-moment callback

## Phase 4 — Smart glasses (foundation started)

**Recommendation: treat smart glasses as Phase 4, only after phone voice is stable for 2+ weeks** (low echo rate, predictable `turn_summary`, rare watchdog recovery).

Foundation (no hardware required):

- [docs/meta-glasses.md](docs/meta-glasses.md) — architecture, latency/privacy/echo notes
- `ai-frontend/lib/wearablesAdapter.ts` — `phone` default, `meta-stub` placeholder
- `EXPO_PUBLIC_WEARABLES_MODE=phone|meta-stub`
- `X-Audio-Source` header on `/chat` → `session_log` `extra.audio_source`

| Risk | Why wait |
|------|----------|
| Mic / speaker placement | On-head audio causes echo and weak STT unless tuned per device |
| Latency | Round-trip voice must stay conversational; glasses add radio + SDK hops |
| Privacy | Always-on mics need explicit UX; phone already sets user expectations |
| APIs | No single standard for companion apps across Meta / Ray-Ban / others yet |

**Interim options**

1. **Bluetooth glasses + phone as compute** — glasses as remote mic/speaker; keep STT/TTS/LLM on the phone app you have today.
2. **Vendor SDK when ready** — integrate when a platform exposes stable audio streaming + user consent flows (document device-specific echo tuning).

Until then, optimize **physical phone** sessions: speaker distance, `session_log` `echo_suppressed` rate, and `listen_ready` after TTS.

## What to test on phone

See [DEV.md](DEV.md) session log section and [RUNBOOK.md](RUNBOOK.md) voice checklist.
