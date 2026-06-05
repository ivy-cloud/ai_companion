# Meta smart glasses — phone-first bridge

Phase 4 foundation for Ray-Ban Meta / Meta View patterns **without** requiring physical hardware or a fake SDK.

## Target flow

```
Glasses mic → phone (Bluetooth) → STT → POST /chat → TTS → phone or glasses speaker
```

Today the Expo app uses the **phone mic and speaker**. The stub path exercises the same backend with `X-Audio-Source: meta-glasses` logged in `session_log.jsonl` for debugging.

## Meta Ray-Ban / Meta View patterns

| Layer | Phone today | Glasses (future) |
|-------|-------------|------------------|
| Capture | Expo `Audio.Recording` | Glasses BLE audio → phone app |
| STT | Azure via `POST /stt` | Same — compute stays on phone |
| LLM | FastAPI `/chat` NDJSON | Same |
| Playback | Expo `Audio.Sound` | Route to glasses speaker when SDK exposes stream |
| Pairing | N/A | Meta View app / Wearables SDK pairing |

## Architecture

1. **Audio I/O on phone** — keep STT/TTS/LLM on the Mac backend; phone is the real-time client.
2. **Bluetooth relay** — glasses as remote mic + earpiece; phone remains the trust boundary for consent and logging.
3. **Future Meta Wearables SDK** — when available, implement `WearablesAudioSource` in `ai-frontend/lib/wearablesAdapter.ts`:
   - `startCapture()` → PCM or encoded stream from SDK
   - `routePlayback()` → glasses vs phone speaker
   - No changes required to companion personality or memory layers

## Env flag

```bash
# ai-frontend/.env
EXPO_PUBLIC_WEARABLES_MODE=phone      # default
EXPO_PUBLIC_WEARABLES_MODE=meta-stub  # logs meta-glasses on /chat
```

## Backend hook

`POST /chat` accepts optional header:

```
X-Audio-Source: meta-glasses
```

Non-`phone` values are stored in `session_log` turn `extra.audio_source` for field tuning.

## Challenges

| Challenge | Mitigation |
|-----------|------------|
| **Latency** | Keep LLM + TTS on LAN backend; prefetch TTS chunks; glasses add radio hop — budget +200–400 ms |
| **Echo** | On-head speaker bleeds into glasses mic; longer post-TTS listen cooldown; AEC when SDK exposes it |
| **Privacy** | Explicit “listening” indicator; no always-on without user session; logs stay local on Mac |
| **SDK gap** | Stub mode validates logging and headers; swap adapter when Meta ships stable streaming APIs |

## Integration checklist (when SDK lands)

- [ ] Replace `meta-stub` with SDK session init + consent UI
- [ ] Pipe SDK mic frames to existing `transcribeRecording` / `/stt`
- [ ] Route TTS output to SDK playback when connected, fallback to phone speaker
- [ ] Per-device echo tuning in `conversationMode.ts` (POST_TTS_LISTEN_COOLDOWN_MS)
- [ ] Field-test `session_log` `echo_suppressed` rate vs phone baseline

See also [COMPANION_ROADMAP.md](../COMPANION_ROADMAP.md) Phase 4.
