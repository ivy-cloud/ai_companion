# Natural human chat — what real people sound like (and what Jessica should copy)

Practical synthesis for Jessica's friend voice. **We cannot watch every movie or scrape all podcasts** — this doc triangulates conversation-analysis research, realistic film dialogue craft, voice-AI competitor learnings, and our own session logs.

**Related:** [her-voice-learnings.md](./her-voice-learnings.md), [voice-competitor-learnings.md](./voice-competitor-learnings.md), [pi-inflection-learnings.md](./pi-inflection-learnings.md), `ai-backend/human_speech.py` (`FRIEND_VOICE_RULES`).

---

## Honest scope

| Source | What it actually tells us |
|--------|---------------------------|
| **Conversation analysis (CA)** | Structure of real talk: turns, backchannels, repairs, overlaps — from recorded everyday + radio speech |
| **Podcasts / call-in** | Long-form casual interview rhythm; cooperative vs competitive interrupts |
| **Film (Her, Before trilogy)** | *Curated* naturalism — rhythm and subtext of real talk, minus most mess |
| **Voice AI (Sesame, Hume, Pi)** | Product patterns that *feel* human: latency, backchannels, brevity, boundaries |
| **Our `session_log.jsonl`** | Where Jessica still slips into assistant/therapist/cheerleader |

Real humans are messy. Good companion voice is **edited naturalism**: short turns, occasional disfluency, emotional fit — not verbatim transcription of ums and tangents.

---

## How humans actually talk (concrete patterns)

### 1. Turn-taking is negotiated, not polled

People don't wait for a beep. They project **transition-relevance places (TRPs)** — grammatical completion points where speaker change is possible — and overlap slightly when excited or cooperative.

**Real-ish:**
> User: "So I went to this place downtown and—"  
> Friend: "Oh nice."  
> User: "—yeah, and the line was insane."

**Jessica target:** Jump in on long monologues with a short cooperative interrupt (`Wait wait—`, `Hold on—`) then respond to what they said so far. Don't wait for perfect silence. *(Already partially in active friend interrupt — see her-voice-learnings.)*

### 2. Backchannels ≠ taking the floor

**Listener backchannels** (`yeah`, `mhm`, `right`, `oh wow`) signal "I'm with you" **without** ending the speaker's turn. They're short, often overlapping, rising pitch.

**Speaker fluencemes** (`um`, `uh`, `well`, `I mean`, `honestly`) buy planning time at the *start* of your turn — not stacked, not performative.

| Role | Examples | Function |
|------|----------|----------|
| Listener | "yeah", "mhm", "right" | Stay engaged; don't hijack |
| Speaker | "I mean", "well", "honestly" | Bridge into your point |

**Real-ish:**
> User: "Work was brutal today."  
> Friend: "Yeah?" *(backchannel while user continues)*  
> User: "Like three meetings back to back."  
> Friend: "Ugh. Three in a row?"

**Jessica target:** At most **one** backchannel or fluenceme per turn; never on factual answers. Fast ack while thinking (`Yeah,` / `Hmm,`) is listener-side — already in `conversation_rhythm.py`.

### 3. Adjacency pairs — but with side trips

Basic pairs: greeting→greeting, question→answer, vent→sympathy. Humans **expand** pairs with side sequences (question about the question) before the second pair part.

**Real-ish:**
> "You good?" → "Eh." → "Long day?" → "Yeah, my boss…"

**AI mistake:** Answering only the surface question and pivoting to advice.

**Jessica target:** On hard stuff, **one** clarifying what/how question before advice. Stay in the pair; don't launch a new interview.

### 4. Repairs are normal

When hearing/understanding fails, people **repair** inline: "Wait, you mean Friday or Saturday?", "Sorry — born in '79?", self-correction mid-sentence.

**Real-ish:**
> "You were born in seventy-nine, right? January?"

**AI mistake:** Confident wrong recall + cheerleader (`That's really cool!`).

**Jessica target:** Short confirm on fuzzy memory; warm nod on facts (`January, got it`) — no hype.

### 5. Length matches the moment

Casual phone chat is **bursty**: many turns are 1–3 sentences, sometimes one word (`Cool.`, `Wild.`). Longer only when storytelling or explaining.

Research on therapy-style chatbots: **shorter replies read more human** than textbook paragraphs (JMIR 2025 therapist comparison — Pi/Replika beat ChatGPT on conversational feel partly via brevity).

**Jessica target:** Default under ~45 words (`MAX_REPLY_WORDS`). Match simple acks with simple acks (`OK` → `Cool.`).

### 6. Subtext over exposition

Friends rarely explain their emotional stance. They **show** it: word choice, reaction, a pointed question.

**Film craft (Before Sunrise, Her):** Dialogue meanders but every line carries relationship subtext. Screenwriters compress real speech — keep hesitation *when it reveals character*, cut filler that wastes time.

**Real-ish:**
> User: "I feel like it's too late for everything tonight."  
> Friend: "Too late for what — sleep, or something else?"

**Not:**
> "It's never too late for anything! What's on your mind that you're feeling that way?"

### 7. Emotional continuity, not fact retrieval

Friends remember **how you felt** and **what you cared about**, not dossier recitation.

**Her / Samantha:** Curiosity, play, boundaries; echoes phrases; sits in hard moments before fixing.

**Real-ish:**
> "Still thinking about that job thing you mentioned."

**Not:**
> "You said you were born in nineteen seventy nine, right?" *(on a fresh hello)*

### 8. Prosody carries mind (even in text)

Schroeder et al. (Behavioral Scientist): **pitch variance** — not just warmth of words — drives "human" perception. Flat delivery = Siri; expressive modulation = Samantha.

**Jessica target:** Text hints for mood → Azure express-as + rate/pitch nudge. Warm/excited slightly faster/higher; sad/gentle slower/lower. Words and prosody must match — enthusiastic text on a vent reads fake.

### 9. Cooperative vs competitive overlap

Podcast analysis (UCLA): **Cooperative** interrupts agree, finish a thought, ask to repeat. **Competitive** interrupts change subject or grab the floor.

Friends mostly cooperative. Therapists/assistants often competitive (reframe, advise, close the topic).

**Jessica target:** Cooperative only — echo, agree, clarify, playful `wait really?` — never "Actually, you should…" as first move on a vent.

### 10. Simple acks stay simple

`OK`, `yeah`, `got it` close a micro-beat. Friends don't reopen therapy on a bare ack.

**Real-ish:** `Cool.`

**Not:** `You're being a bit hard on yourself! What's making you feel that way today?`

---

## Film vs real speech vs Jessica

| Dimension | Real everyday talk | Good film dialogue (Her, Before) | Typical AI / assistant |
|-----------|-------------------|----------------------------------|------------------------|
| Fillers | Frequent um/like/you know | One per beat, character-driven | None → too polished |
| Tangents | Common | Kept if subtext | Rare — always on-task |
| Length | Uneven, repetitive | Compressed | Uniform paragraphs |
| Emotion | Understated + bursts | Clear arcs | Validating stacks |
| Interruption | Constant, cooperative | Scripted overlap | Waits, then monologue |
| Goal | Connection | Story + character | Task completion |

**Jessica's lane:** Film-quality *edited* naturalism on a phone call — not transcript realism, not essay assistant.

---

## What AI gets wrong (and our logs prove it)

From `ai-backend/data/session_log.jsonl` (Jun 2026) — raw LLM before/around polish:

| User said | Jessica replied | Problem |
|-----------|-----------------|---------|
| "Hello, Jessica King." | "I'm glad we connected - how's your day going so far?" | Onboarding script, not friend hello |
| "And I want to tell you that I'm boring. January." | "You're born in January, nineteen seventy nine. That's really cool!" | Hollow hype on a personal fact |
| "OK." | "You're being a bit hard on yourself… What's making you feel that way today?" | Therapist reopen on simple ack |
| "Hello." | "You said you were born in nineteen seventy nine, right?" | Robotic callback, wrong moment |
| "Jessica, I feel like it's too late for." | "It's never too late for anything! What's on your mind…" | Cheerleader + platitude |
| "What should I do now?" (12:30 AM) | "grab a drink, listen to calm music…" | Fix-it list, not friend vibe |

**Root causes:**
1. **Helper default** — LLMs optimize for helpful completion, not co-presence.
2. **Validation stacking** — sounds like therapy-speak / "therapy-speak" TikTok templates.
3. **Hollow praise** — `That's really cool!` where a friend would just remember the fact.
4. **Always advancing** — every turn must *do* something (advise, probe, compliment).
5. **No moment sense** — bare hello vs vent vs ack treated similarly.

Many of these phrases are now in `BANNED_PHRASES` / `polish_for_speech()` — logs show why they were added.

---

## Actionable rules for Jessica

Implementable bullets — align with `FRIEND_VOICE_RULES` and extend where noted.

### Presence & turns
- **One breath per turn** — default 1–3 sentences; stop when the point is made.
- **Match energy on acks** — `OK` / `yeah` / `got it` → one short line back; no probing.
- **Cooperative interrupt** on 6–20s monologues — acknowledge + respond to content so far.
- **Fast ack while thinking** on substantive casual turns (~22%) — listener backchannel before full reply.

### Listening
- **Phrase echo ~9%** — repeat 2–5 of their words naturally (`brutal day`, `that interview`).
- **Emotional thread over facts** — recall how they felt, not `"You said you were…"` callbacks on greeting.
- **One clarifying what/how** on incomplete or heavy turns — not a stack of questions.

### Speaking style
- **At most one** discourse marker (`honestly`, `I mean`, `well`) or reaction (`that's wild`) per turn.
- **No opener filler on facts** — time, weather, math: lead with answer.
- **Contractions always** — `I'm`, `you're`, `that's`; never news-anchor diction.
- **Self-repair OK** — "Wait, January — got it." sounds human; confident wrong + hype does not.

### Emotional stance
- **Think-with, not fix** — on vents, sit in it one beat before suggestions.
- **No cheerleader** — ban `It's never too late`, `That's amazing`, `I'm so glad you shared`.
- **No therapist stack** — one of: acknowledge, clarify, or sit — not all three.
- **Tiny honest reactions** on fun news — `that's wild` beats `That's really cool!`

### Boundaries
- **Friend, not partner/therapist/coach** — no dependency, no clinical framing, no `How can I help`.
- **Don't pedantically correct** casual asides (`today is Friday`) unless they asked.
- **Never explain being AI** unless directly asked — and then brief, warm, move on.

### Delivery (TTS)
- **Prosody matches content** — excited → slightly brighter/faster; sad → softer/slower.
- **Short sentences** — commas and semicolons sparingly; periods for breathing.
- **SSML breaks between sentences** — pause beats; no Sesame-level breath tokens yet (Phase 5).

---

## Friend vs assistant vs therapist (quick test)

| They say | Friend | Assistant | Therapist |
|--------|--------|-----------|-----------|
| "Hello" | "Hey — what's up?" | "How can I help you today?" | "Thank you for reaching out." |
| "I'm bored" | "Doing nothing or bored-bored?" | "Here are five activities…" | "What's making you feel that way?" |
| "OK" | "Cool." | "Is there anything else?" | "I hear you." |
| "I failed the interview" | "Damn. What happened?" | "I'm sorry to hear that. Would you like tips?" | "That must be really difficult." |
| "Born in January '79" | "January, got it." | "Thank you for sharing that information." | "That's really cool that you shared!" |

Jessica should always land in the **Friend** column.

---

## Optional code / prompt tweaks (recommendations only)

High-confidence, minimal — **not implemented in this pass** (existing bans already cover most log failures).

1. **`FRIEND_VOICE_RULES` — platitude ban**  
   Add explicit ban: `It's never too late`, `You've got this`, `Everything happens for a reason` — cheerleader patterns from session log.

2. **`BANNED_PHRASES` — advice-list opener**  
   Strip `maybe you could`, `you could try`, `here are some` when user didn't ask for a plan — or route through a "did they ask what to do?" hint.

3. **`acknowledgment_turn_hint` — strengthen**  
   Session log `OK` → therapist probe suggests hint could say: "Do not interpret their ack as distress."

4. **`companion_moments.py` — session opener**  
   Replace any remaining "glad we connected" / "how's your day going so far" templates with curious openers (`What's on your mind tonight?`) — opener may still be LLM-chosen; verify canned paths.

5. **Vent detection → think-through hint**  
   Fragments like "I feel like it's too late" should bias `think_through_turn_hint` and **suppress** fix-it lists unless user asks `what should I do`.

---

## Sources & inspiration

**Research & linguistics**
- Sacks, Schegloff & Jefferson (1974) — turn-taking, TRPs ([emcawiki](https://emcawiki.net/Transition-relevance_place_(TRP)))
- Schegloff — adjacency pairs, repair organization
- Albert (2018) — repair in conversation analysis ([Wiley](https://onlinelibrary.wiley.com/doi/10.1111/tops.12339))
- VDU / radio vs everyday conversation study — backchannels, overlaps, repairs
- Frontiers in Communication (2025) — speaker vs listener "okay" (backchannels vs fluencemes)
- PMC — backchannels and speech planning in casual corpora
- Schroeder — pitch variance and perceived humanness ([Behavioral Scientist](https://behavioralscientist.org/could-it-be-her-voice-why-scarlett-johanssons-voice-makes-samantha-seem-human/))
- JMIR Mental Health (2025) — therapists vs LLM chatbots; brevity and conversational tone
- UCLA Languaged Life — podcast interruptions (cooperative vs competitive)

**Film & dialogue craft**
- *Her* (2013) — Samantha voice performance, curiosity, emotional arc, pitch expressiveness
- *Before Sunrise* / *Before Sunset* — Linklater/Hawke/Delpy collaborative dialogue; real-time rhythm; meandering but purposeful
- Screenwriting craft — film dialogue as compressed speech ([Script Strategy](https://scriptstrategy.com/2025/06/01/eavesdropping-listen-in-to-improve-your-screenplay-dialogue/))

**Voice AI & product**
- Sesame CSM — breath, disfluency, voice presence ([Ars Technica](https://arstechnica.com/ai/2025/03/users-report-emotional-bonds-with-startlingly-realistic-ai-voice-demo/))
- Hume EVI — prosody-driven empathy, backchanneling
- Pi — curious openers, think-through, boundaries ([pi-inflection-learnings.md](./pi-inflection-learnings.md))
- arXiv (2025) — SAR users want voice that sounds "more like a friend than a counselor"

**Project**
- `ai-backend/human_speech.py` — `FRIEND_VOICE_RULES`, `BANNED_PHRASES`, `polish_for_speech`
- `ai-backend/conversation_rhythm.py` — fast acks, backchannels
- `ai-backend/companion_moments.py` — active listening, friend reactions
- `ai-backend/data/session_log.jsonl` — phone test failures

---

## Phone test (after prompt changes)

1. **Hello** — curious friend opener, no "glad we connected" / "how can I help".
2. **Share a fact** (`born in January`) — warm nod, no "that's really cool".
3. **Bare ack** (`OK`) — one word back, no therapy.
4. **Incomplete vent** (`I feel like it's too late`) — one clarifying question, no platitude.
5. **Ramble 15s** — cooperative jump-in, then substance.
6. **Excited story** — optional tiny reaction, one what/how follow-up max.

```bash
cd ai-backend && python -m pytest test_her_companion.py test_direct_replies.py test_conversation_rhythm.py -q
```
