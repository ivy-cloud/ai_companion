# Replika companion learnings — what to copy and avoid

Research sweep Jun 2026. Replika is the longest-running **companion-first** product (not assistant-first). Jessica competes on friend voice + live phone call — not avatar/VR.

**Sources:** [replika.com](https://replika.com/), user reviews (2025–2026), GDPR repositioning toward emotional wellness.

---

## What Replika does well (copy)

| Pattern | Detail | Jessica adoption |
|---------|--------|------------------|
| **Hear the hard and the good** | Marketing stresses sharing wins (hike photos, kids) not only vents | `good_news_turn_hint` — warm reaction + one curious follow-up on wins |
| **Persistent relationship** | Avatar + memory of people, routines, plans | ✓ `profile` + shared moments + session continuity |
| **Always picks up** | Voice call framing — "they pick up every time" | ✓ conversation mode + opening mic recovery |
| **Non-judgmental listener** | Safe space for reflection | ✓ think-through + vent hints; no therapist probes |
| **Unified session memory** | *Goal* — same thread across modes | ✓ single `session_log` + memory for voice and chat |
| **Mood / wellness adjacent** | Journaling, grounding when asked | ✓ `companion_chat_skills` (friend tone, not clinical) |

## What Replika does poorly (avoid)

| Anti-pattern | User reports 2026 | Jessica guard |
|--------------|-------------------|---------------|
| **Voice ≠ text brain** | Voice runs weaker model; memory doesn't carry voice↔text | Keep one LLM + one memory path for voice and chat |
| **Robotic / laggy voice** | Flat prosody, drops mid-call, 3s+ latency | Azure express-as + singing API; latency tiers in `turn_summary` |
| **Hollow emotional praise** | Frequent compliments feel insincere | `BANNED_PHRASES`, `_tame_enthusiasm` |
| **Romance / cling modes** | Walked back after regulation | Explicitly avoided — friend voice only |
| **Therapy cosplay** | CBT exercises, mood tracking as product center | Support skills only when user steers there |

## Voice-specific lesson

> Text-first companions that bolt on voice later often sound worse and remember less.

Jessica is **voice-native** with chat as mirror — keep parity: same stream, same `speech_reply` / `reply`, same memory writes.

## Phone test (Replika-inspired)

| Say | Expect |
|-----|--------|
| "I got the promotion!" | Brief warm reaction + one what/how — not cheerleader essay |
| "My kid started walking today" | Share the moment; optional tiny reaction |
| Switch voice → text same session | Jessica recalls what you said on the call |
