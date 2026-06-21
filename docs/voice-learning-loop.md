# Jessica voice learning loop

Repeatable workflow to keep Jessica sounding like a friend on the phone — not an assistant, therapist, or cheerleader.

**Related:** [natural-human-chat.md](./natural-human-chat.md), [her-voice-learnings.md](./her-voice-learnings.md), `ai-backend/human_speech.py`.

---

## What the daily script does

`scripts/daily_voice_learning.py`:

1. Reads recent entries from `ai-backend/data/session_log.jsonl` (default: last 24 hours)
2. Flags assistant replies that sound AI-like:
   - Cheerleader platitudes (`never too late`, `you've got this`)
   - Therapist probes (`what's making you feel`, `hard on yourself`)
   - Assistant openers (`glad we connected`, `how can I help`)
   - Fix-it lists when the user didn't ask for a plan
   - Robotic memory callbacks (`you said you were…`)
   - Replies over ~45 words
   - Banned-phrase near-misses
3. Appends a dated section to [voice-learning-journal.md](./voice-learning-journal.md)
4. Prints suggested rule additions; optional `--auto-apply` adds high-confidence missing phrases to `BANNED_PHRASES`

---

## Run manually

```bash
cd ai-backend && .venv/bin/python ../scripts/daily_voice_learning.py
```

Options:

```bash
# Last 48 hours, print only
.venv/bin/python ../scripts/daily_voice_learning.py --hours 48 --dry-run

# Scan + auto-apply high-confidence bans + journal entry for a specific date
.venv/bin/python ../scripts/daily_voice_learning.py --hours 168 --date 2026-06-18 --auto-apply
```

---

## Human / agent review workflow

After the script runs:

1. **Read** the new journal section in `docs/voice-learning-journal.md`
2. **Cross-check** raw turns in `ai-backend/data/session_log.jsonl` if needed
3. **Update rules** only when high-confidence:
   - `ai-backend/human_speech.py` — `BANNED_PHRASES`, `FRIEND_VOICE_RULES`, `polish_for_speech`
   - `ai-backend/companion_moments.py` — vent routing, session openers
   - `ai-backend/personality.py` — turn hints
4. **Run tests:**

```bash
cd ai-backend && .venv/bin/python -m unittest test_her_companion test_direct_replies test_conversation_rhythm test_memory -v
```

5. **Phone test** (from [natural-human-chat.md](./natural-human-chat.md)):

| # | Say | Expect |
|---|-----|--------|
| 1 | Hello | Curious friend opener — no "glad we connected" / "how can I help" |
| 2 | Born in January | Warm nod — no "that's really cool" |
| 3 | OK | One word back — no therapy |
| 4 | I feel like it's too late | One clarifying question — no platitude |
| 5 | Ramble ~15s | Cooperative jump-in, then substance |
| 6 | Excited story | Optional tiny reaction, one follow-up max |

6. **Commit** only when you want the rule changes saved (automation does not commit by default).

---

## Extended idle learning (10+ hours / day)

When the laptop is on but you're not using it, Jessica can learn **every hour** — up to ~24 passes/day if the Mac stays idle.

### Local (recommended — only runs when you're away)

```bash
chmod +x scripts/idle_voice_learning.sh scripts/install_idle_learning.sh
./scripts/install_idle_learning.sh
```

- Checks **Mac idle time** (default: 20+ minutes via `ioreg`)
- Skips if you're typing / using the trackpad
- Scans last **6 hours** of `session_log.jsonl` each pass
- **`--deep`**: rotates through `docs/natural-human-chat.md` and `docs/*-learnings.md`
- Logs: `docs/voice-learning-idle.log`

Tune idle threshold before reinstalling:

```bash
export VOICE_LEARNING_MIN_IDLE_SEC=900   # 15 min
./scripts/install_idle_learning.sh
```

Uninstall: `launchctl bootout gui/$(id -u)/com.ivy.jessica-voice-learning`

### Cloud agent (every 2 hours)

Import [cursor-automation-voice-learning-hourly.json](./cursor-automation-voice-learning-hourly.json) into Cursor Automations — runs even when the Mac is off, applies high-confidence rule fixes in the repo.

Pair **local idle** (journal + log scanning) with **cloud hourly** (agent edits + tests) for continuous improvement.

### Nightly deep pass (optional)

Import [cursor-automation-voice-learning.json](./cursor-automation-voice-learning.json) for a once-daily ~2:00 AM review of the full journal.

Adjust timezone in the Automations editor after import.
