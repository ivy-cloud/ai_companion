# Overnight briefing — Jessica voice (2026-06-23)

Good morning. Autonomous pass completed while you slept.

## Commit

**`74573f0`** — *Polish friend voice safety net and harden voice UX recovery*  
Branch: `fix/conversation-voice-ux` (pushed)

**15 files** in that commit (~341 insertions). This overnight pass added idle-learning install + this briefing (see commit below).

## Idle learning

| Item | Status |
|------|--------|
| `launchctl` job `com.ivy.jessica-voice-learning` | **Installed** |
| Idle threshold | 20 min (`VOICE_LEARNING_MIN_IDLE_SEC=1200`) |
| Lookback | 6 h per hourly run |
| Log | `docs/voice-learning-idle.log` |

Verify: `launchctl print gui/$(id -u)/com.ivy.jessica-voice-learning`

## What changed (friend voice)

Cross-checked all voice docs + `session_log.jsonl` (no recent chat turns — voice/STT telemetry only).

| Area | Change |
|------|--------|
| **Cooperative interrupt** | 12s threshold at 15+ words in partial STT; cooperative acks (`Hold on—`, `Right—`); jump-in hints echo phrase + what/how |
| **Phrase echo** | Active listening from 8 words (was 10); ~9% roll unchanged |
| **Think-with vents** | Incomplete vents (`too late for…`) always get think-through hint (no roll); boredom/bored routing |
| **Session opener** | Greeting hint blocks dossier recap; long opener fallback → `What's up?` |
| **Web synthesis** | Friend-tone rules in `WEB_SYNTHESIS_RULES` + `DIRECT_FACTUAL_HINT` |
| **Polish safety net** | `_cleanup_polish_artifacts` strips robotic callback / cheerleader leftovers |
| **Mic recovery** | Defer `ensureConversationListening` during partial-STT roll; `isOnlyOneRecordingStorm` cooldown |

## Tests

| Suite | Result |
|-------|--------|
| Backend (`test_her_companion` … `test_stt`) | **97 passed** (+ 8 subtests) |
| Frontend (`npm test`) | **22 passed** |

## 3 phone tests for tomorrow

1. **Hello** — Say *"Hello, Jessica."* Expect curious friend opener (`What's up?` / `What's on your mind?`), never *"I'm glad we connected"* or birth-year callback.

2. **Incomplete vent** — *"I feel like it's too late for."* Expect one clarifying what/how question, no platitude (*"never too late"*) and no fix-it list.

3. **Ramble ~12s** — Talk 15+ words without pausing. Expect cooperative jump-in (~12s with live caption) — *"Wait wait—"* then substance on what you said so far.

Full checklist: `docs/natural-human-chat.md` § Phone test.

## Notes

- `session_log.jsonl` still has Jun 20 `listen_open_failed` storms (iOS single Recording). Recovery hardened; worth one live retest after TTS.
- Hourly idle learning will append to `docs/voice-learning-journal.md` when new chat turns land.
