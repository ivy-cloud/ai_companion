/**
 * Wearables audio bridge — phone-first today; Meta glasses stub for future SDK.
 *
 * Set EXPO_PUBLIC_WEARABLES_MODE=phone|meta-stub in ai-frontend/.env
 * Backend logs non-phone values via X-Audio-Source on POST /chat.
 */

export type WearablesMode = 'phone' | 'meta-stub';

export interface WearablesAudioSource {
  mode: WearablesMode;
  /** Sent as X-Audio-Source on /chat (backend session_log when not phone). */
  audioSourceHeader: string;
  /** Short label for debug UI if needed. */
  label: string;
}

function resolveMode(): WearablesMode {
  const raw = (process.env.EXPO_PUBLIC_WEARABLES_MODE ?? 'phone').trim().toLowerCase();
  if (raw === 'meta-stub' || raw === 'meta-glasses-stub' || raw === 'meta-glasses') {
    return 'meta-stub';
  }
  return 'phone';
}

/** Active audio source for this app build — no Meta SDK; integration points only. */
export function getWearablesAudioSource(): WearablesAudioSource {
  const mode = resolveMode();
  if (mode === 'meta-stub') {
    return {
      mode: 'meta-stub',
      audioSourceHeader: 'meta-glasses',
      label: 'Meta glasses (stub)',
    };
  }
  return {
    mode: 'phone',
    audioSourceHeader: 'phone',
    label: 'Phone mic',
  };
}

/** Headers to attach to voice/chat requests when wearables mode is non-default. */
export function wearablesChatHeaders(): Record<string, string> {
  const source = getWearablesAudioSource();
  if (source.mode === 'phone') {
    return {};
  }
  return { 'X-Audio-Source': source.audioSourceHeader };
}
