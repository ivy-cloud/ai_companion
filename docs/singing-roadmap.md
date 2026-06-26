# Jessica singing — what works today and what does not

## Short answer

With **SINGING_API_KEY** configured (Replicate + MiniMax Music 2.6), Jessica generates **real sung audio** with vocals and backing instrumentation from original lyrics. Without a key, she **speaks original lyrics** with Azure Neural TTS singing SSML (rhythmic sung speech — not a true melody).

She **cannot learn to sing by searching the web** or copying performances from YouTube or Spotify. Web search returns text and snippets, not vocal training data. Copying real recordings raises copyright issues.

---

## What she can do now

| Request | Behavior |
|---------|----------|
| “Sing me something” / lullaby / quick rap | Original canned lyrics, ♪ in chat, **generated music** when API key set |
| “Sing about my dog” / birthday song for a name | LLM writes original lyrics; **music API** or TTS fallback |
| “Sing Shape of You” | Safe fallback — same vibe, **no** copyrighted lyrics |

### Real singing (when `SINGING_API_KEY` is set)

1. LLM or canned path produces **original** lyrics (copyright rules unchanged).
2. Backend calls **Replicate → MiniMax Music 2.6** with lyrics + style prompt (lullaby, rap, acoustic, etc.).
3. Stream shows lyrics, then **♪ preparing song…** while audio generates (~30–90 s).
4. `done` payload includes `singing_audio_url` → app plays MP3 instead of `/tts`.

### TTS singing fallback (no API key or API failure)

- Slower rate (lullaby ~0.76, default song ~0.84)
- Base pitch lift (+0.5st to +1.35st by mood)
- Each lyric line wrapped in its own mini prosody with alternating pitch
- Longer breaks between lines (220–480 ms)

Restart backend + reload Expo after pulling changes.

---

## Provider choice: Replicate MiniMax Music 2.6

| Why this API | Details |
|--------------|---------|
| REST + API token | `POST` prediction, poll or `Prefer: wait`, download MP3 URL |
| Lyrics + style | Takes structured lyrics (`[Verse]` / `[Chorus]`) and a style prompt (BPM, mood, vocal) |
| Dev-friendly | Pay-per-run on Replicate; no custom infra |
| Fallback | Missing key or failed generation → existing Azure singing SSML TTS |

Alternatives considered: Suno (no official public API), Udio (limited API access), MusicGen on Replicate (instrumental-focused, weak vocals), ElevenLabs Music (viable but we picked one provider for scope).

---

## Setup

In `ai-backend/.env`:

```bash
SINGING_ENABLED=true
SINGING_API_PROVIDER=replicate
SINGING_API_KEY=r8_your_replicate_token   # https://replicate.com/account/api-tokens
```

`REPLICATE_API_TOKEN` works as an alias. If unset or `SINGING_ENABLED=false`, song turns use Azure TTS only (app still works).

Check `/health` → `singing_audio.configured` should be `true`.

---

## How to test

### Backend unit tests (mocked — no API spend)

```bash
cd ai-backend && python3 -m unittest test_singing_audio test_singing test_tts_ssml -v
```

### On your phone

1. Add `SINGING_API_KEY` to `ai-backend/.env`, restart backend.
2. Same Wi‑Fi; Expo pointed at laptop (`EXPO_PUBLIC_API_BASE`).
3. Voice: **“Sing me a soft lullaby”** — lyrics appear, then ♪ preparing song…, then **music** plays (not speech rhythm).
4. Voice: **“Sing a birthday song for Alex”** — personalized LLM lyrics + generated track.
5. Remove the key and retry — should fall back to rhythmic Azure TTS without errors.

### Manual API check

```bash
curl -s http://localhost:8000/health | jq .singing_audio
```

---

## Why web search cannot “teach” her to sing

1. **Search gives text**, not pitch curves, phoneme timing, or breath control.
2. **Human performances are copyrighted** — we do not scrape or replay them.
3. **Azure TTS is speech synthesis**, not a music generator.
4. **LLMs write words**, not audio waveforms in key.

---

## Roadmap

| Tier | Approach | Status |
|------|----------|--------|
| **Now** | Replicate MiniMax Music 2.6 + TTS fallback | Implemented |
| **Next** | Cache/reuse clips; style picker in app | Future |
| **Later** | On-device SVS with MIDI/melody | Engineering heavy |
