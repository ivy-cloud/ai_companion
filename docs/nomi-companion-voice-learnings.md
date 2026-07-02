# Nomi / Kindroid / Candy AI voice learnings

Companion apps with **voice calls** — what users praise and pan in 2026 reviews.

**Sources:** Roborhythms, AI Companion Guides, WeavAI, aicompanionpick.com (May–Jul 2026).

---

## Market snapshot (voice call quality)

| App | Latency (reported) | Memory on voice | Voice quality | Lesson for Jessica |
|-----|-------------------|-----------------|---------------|-------------------|
| **Candy AI** | 1.2–1.5s | Strong | Natural prosody | Latency target ≤1.5s good tier |
| **Nectar AI** | 1.0–1.3s | Strong | Cleanest prosody | Invest in express-as + line chunks |
| **Nomi AI** | 1.0–1.5s (post-Jan 2026) | **Best in class** | Good, improving | 3-layer memory → our profile + moments |
| **Kindroid** | 1.5–2.0s | Variable | Custom voice clone | User voice prefs deferred |
| **Replika** | 1.8–2.5s | Strong (Pro) | Natural but slow | See [replika-companion-learnings.md](./replika-companion-learnings.md) |
| **Character.AI** | Unstable 2026 | Weak | Per-character voices | **Avoid** — disconnect issues; don't split voice/text brain |

## Copy

| Pattern | Source | Jessica |
|---------|--------|---------|
| **Memory survives voice calls** | Nomi, Candy | Single `session_log` + profile for voice + chat |
| **Personality consistency** | Nomi, Kindroid | `FRIEND_VOICE_RULES` + banned phrases |
| **Voice ≠ weaker model** | Replika anti-pattern | Same Groq model for voice and text |
| **Custom voice** | Kindroid upload | Deferred — Azure voice gender picker only |
| **Group / multi companion** | Nomi | Out of scope (one Jessica) |

## Anti-patterns (reviews)

- Flat TTS on emotional support ("that sounds tough" in robot voice) → express-as + sympathy hints
- 2–3s dead silence before answer → fast_ack + lookup_ack
- Call drops mid-sentence → robust mic reopen (opening mic watchdog)
- Chat shows full reply user never heard → interrupt truncate

## Phone test

1. Voice call 3 turns → switch to chat → Jessica recalls last voice topic (Nomi bar).
2. Ask weather → hear brief "Hang on—" before answer (no awkward silence).
3. Interrupt mid-sentence → chat shows only what was spoken.
