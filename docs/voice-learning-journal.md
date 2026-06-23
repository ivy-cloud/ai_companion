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

