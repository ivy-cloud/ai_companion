/**
 * Phase 5 — OpenAI Realtime / speech-to-speech (deferred).
 *
 * Streaming partial STT + always-on barge-in monitor unlock the UX prerequisites;
 * this module documents the future migration path only.
 */

export type RealtimeVoiceStatus = {
  ready: boolean;
  provider: string | null;
  note: string;
};

export const REALTIME_VOICE_PHASE = 5;

/** Placeholder — no WebSocket session in the phone stack yet. */
export function realtimeVoiceConfigured(): boolean {
  return false;
}

export function realtimeVoiceStatus(): RealtimeVoiceStatus {
  return {
    ready: false,
    provider: null,
    note: 'Phase 5 — see COMPANION_ROADMAP.md',
  };
}

export type RealtimeVoiceSession = {
  connect: () => Promise<void>;
  sendPcm: (chunk: ArrayBuffer) => Promise<void>;
  close: () => Promise<void>;
};

export async function openRealtimeVoiceSession(
  _apiBase: string,
): Promise<RealtimeVoiceSession> {
  throw new Error(
    'Realtime speech-to-speech is Phase 5 — use conversation mode with streaming partial STT today.',
  );
}
