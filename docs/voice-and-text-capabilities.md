# Voice and text capabilities

What Jessica can do on a **phone voice call** vs the **chat panel** on the same session.

Voice is the primary mode — replies are spoken aloud. The chat panel shows the same turn with extras that work better on screen.

---

## Capability matrix

| Capability | Voice (TTS) | Chat panel | Notes |
|------------|:-----------:|:----------:|-------|
| Casual conversation | ✓ | ✓ | Friend voice, not assistant |
| Memory recall | ✓ | ✓ | Saved friend notes only |
| Time / math (canned) | ✓ | ✓ | Fast direct answers |
| Web facts | ✓ | ✓ | Spoken digest; no source lists on voice |
| **Tappable links** | — | ✓ | HTTPS links from search + inline URLs |
| **Bullet lists** | trimmed | ✓ | Short lists kept in chat display |
| **Lyrics / line breaks** | ✓ (chunked) | ✓ | ♪ prefix; one line per TTS chunk when possible |
| Generic song / lullaby / rap | ✓ | ✓ | Canned original lyrics (fast) |
| **Personalized song** | ✓ | ✓ | LLM original lyrics (topic, name, occasion) |
| **In-tune melody / karaoke** | ✓* | ✓ | *With `SINGING_API_KEY` — see [singing-roadmap.md](./singing-roadmap.md) |
| Learn singing from web / YouTube | — | — | Not possible with current stack |
| Copyrighted song request | ✓ | ✓ | Canned “same vibe” fallback — no exact lyrics |
| Poem / haiku | ✓ | ✓ | Line breaks in chat |
| Short story | ✓ | ✓ | Spoken vignette |
| Joke | ✓ | ✓ | Setup + punchline |
| Rap / freestyle (themed) | ✓ | ✓ | LLM when personalized; canned when generic |
| Translate phrase | ✓ | ✓ | Foreign phrase + gloss |
| Summarize | ✓ | ✓ | Points friendlier in chat |
| Explain / walk-through | ✓ | ✓ | One analogy max on voice |
| Quiz me | ✓ | ✓ | One question at a time |
| Brainstorm ideas | ✓ | ✓ | Loose spoken ideas |
| Draft text / message | ✓ | ✓ | Copy-ready draft in chat |
| Pep talk / vent / journal hints | ✓ | ✓ | Therapeutic *friend* tone, not clinical |
| Profile growth skills | ✓ | ✓ | sing_along, bedtime_song, pep_talk, study_buddy |

---

## Singing paths

1. **Generic** — “sing me something”, “lullaby”, “quick rap” → canned original lines (`canned:singing`), ♪ in chat, **generated music** when API configured, else line-chunked TTS.
2. **Personalized** — “sing about my dog”, “birthday song for Alex” → LLM with `singing_llm_turn_hint()`, **music API** or cheerful TTS fallback, ♪ in done payload.
3. **Copyrighted title** — “sing Shape of You” → canned safe fallback, never exact lyrics.

**With `SINGING_API_KEY`:** backend calls Replicate MiniMax Music 2.6; app plays MP3 from `singing_audio_url`. **Without key:** rhythmic sung *speech* via Azure SSML. See [singing-roadmap.md](./singing-roadmap.md) for setup.

---

## How to test on your phone

1. Start the app, open a voice session with Jessica.
2. **Generic song:** “Sing me something chill” — canned lyrics; with API key, hear generated music (~30–90 s after ♪ preparing song…).
3. **Personalized song:** “Sing a birthday song for Alex” — LLM original lyrics + music when configured.
4. **Copyright:** “Sing Shape of You by Ed Sheeran” — refuses exact lyrics, offers original vibe.
5. **TTS fallback:** Remove `SINGING_API_KEY` — same asks use rhythmic Azure speech (no errors).
6. **Chat links:** Ask “what’s the weather tonight?” — chat bubble should show a tappable HTTPS link; voice stays conversational.
7. **Text helper:** “Help me text my friend I’m running late” — draft appears in chat; she reads a short version aloud.
8. **Joke / poem:** “Tell me a joke about coffee” / “write a haiku about rain” — creative reply on both channels.

Backend tests:

```bash
cd ai-backend && python3 -m unittest test_singing test_singing_audio test_voice_text_tasks test_chat_enrichment -v
```

Full suite:

```bash
cd ai-backend && python3 -m unittest discover -v
```
