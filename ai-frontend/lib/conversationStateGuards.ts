/**
 * Pure voice phase guards — no React Native deps (Node testable).
 */

export type VoicePhase =
  | 'idle'
  | 'recording'
  | 'listening'
  | 'thinking'
  | 'streaming'
  | 'speaking'
  | 'interrupting';

/** Legal transitions (interrupting is entered only via force). */
export function canEnterPhase(from: VoicePhase, to: VoicePhase): boolean {
  if (from === to) return true;

  if (to === 'interrupting') {
    return (
      from === 'thinking' ||
      from === 'streaming' ||
      from === 'speaking' ||
      from === 'listening'
    );
  }

  switch (from) {
    case 'idle':
      return (
        to === 'recording' ||
        to === 'listening' ||
        to === 'thinking' ||
        to === 'streaming' ||
        to === 'speaking'
      );
    case 'recording':
      return to === 'thinking' || to === 'idle';
    case 'listening':
      return to === 'thinking' || to === 'idle';
    case 'thinking':
      return (
        to === 'streaming' ||
        to === 'speaking' ||
        to === 'idle' ||
        to === 'listening'
      );
    case 'streaming':
      return (
        to === 'speaking' ||
        to === 'thinking' ||
        to === 'idle' ||
        to === 'listening'
      );
    case 'speaking':
      return to === 'idle' || to === 'listening';
    case 'interrupting':
      return to === 'idle' || to === 'listening';
    default:
      return false;
  }
}

export function isAssistantActivePhase(phase: VoicePhase): boolean {
  return (
    phase === 'thinking' ||
    phase === 'streaming' ||
    phase === 'speaking' ||
    phase === 'interrupting'
  );
}

export function blocksRecordingPrewarm(phase: VoicePhase): boolean {
  return (
    phase === 'speaking' ||
    phase === 'thinking' ||
    phase === 'streaming' ||
    phase === 'interrupting'
  );
}

/** Max time to remain in interrupting before watchdog forces idle. */
export const INTERRUPTING_STUCK_MS = 8_000;

/** Assistant phase with no in-flight work — recover to idle/listen (safety only). */
export const ASSISTANT_STUCK_MS = 28_000;

/** Thinking with no stream_start — abort chat and release locks. */
export const THINKING_NO_STREAM_MS = 30_000;

/** User speech sent but no assistant tokens — diagnostic + recovery. */
export const TURN_NO_RESPONSE_MS = 45_000;

export type SendMessageSkipReason =
  | 'empty_text'
  | 'chat_in_flight'
  | 'recording'
  | 'listening_non_conversation';

export type VoiceTurnMarks = Partial<
  Record<'send_start' | 'stream_start' | 'stream_done' | 'first_token', number>
>;

export function getSendMessageSkipReason(input: {
  text: string;
  isProactive: boolean;
  chatInFlight: boolean;
  phase: VoicePhase;
  fromVoice: boolean;
  conversationMode: boolean;
}): SendMessageSkipReason | null {
  const text = input.text.trim();
  if (!text && !input.isProactive) return 'empty_text';
  if (input.chatInFlight) return 'chat_in_flight';
  if (input.phase === 'recording') return 'recording';
  if (
    input.phase === 'listening' &&
    input.fromVoice &&
    !input.conversationMode
  ) {
    return 'listening_non_conversation';
  }
  return null;
}

/** Hung prior chat (no stream or stream stalled) — safe to abort before a new send. */
export function shouldClearStaleChatInFlight(
  chatInFlight: boolean,
  marks: VoiceTurnMarks | undefined,
  nowMs: number,
  sendStartedAt: number | undefined,
  thresholdMs = THINKING_NO_STREAM_MS,
): boolean {
  if (!chatInFlight) return false;
  if (sendStartedAt == null) return true;
  const sinceSend = nowMs - sendStartedAt;
  if (marks?.stream_done != null) return false;
  if (marks?.stream_start == null && sinceSend >= thresholdMs) return true;
  if (marks?.stream_start != null && sinceSend >= thresholdMs) return true;
  return false;
}

export function shouldRecoverThinkingNoStream(
  phase: VoicePhase,
  stuckMs: number,
  opts: { streamStarted: boolean; sendStarted: boolean },
  thresholdMs = THINKING_NO_STREAM_MS,
): boolean {
  if (phase !== 'thinking' || stuckMs < thresholdMs) return false;
  if (!opts.sendStarted) return true;
  return !opts.streamStarted;
}

export function hasAssistantReplyStarted(marks: VoiceTurnMarks | undefined): boolean {
  return marks?.first_token != null || marks?.stream_done != null;
}

/** Max time to remain in speaking with no playback work (watchdog safety net). */
export const SPEAKING_STUCK_MS = 3_000;

export type SpeakingPhaseBlockers = {
  speakInFlight: boolean;
  streamTtsDraining: boolean;
  streamTtsQueueLen: number;
  activeSound: boolean;
  chatInFlight: boolean;
};

/** True while TTS playback or fetch should keep the speaking phase. */
export function isSpeakingPhaseBlocked(blockers: SpeakingPhaseBlockers): boolean {
  return (
    blockers.speakInFlight ||
    blockers.activeSound ||
    blockers.streamTtsDraining ||
    blockers.streamTtsQueueLen > 0
  );
}

/** Safe to leave speaking when no playback work remains (watchdog uses stuckMs). */
export function canExitSpeakingPhaseNow(
  phase: VoicePhase,
  blockers: SpeakingPhaseBlockers,
): boolean {
  return phase === 'speaking' && !isSpeakingPhaseBlocked(blockers);
}

export function shouldRecoverStuckSpeakingPhase(
  phase: VoicePhase,
  blockers: SpeakingPhaseBlockers,
  stuckMs: number,
  thresholdMs = SPEAKING_STUCK_MS,
): boolean {
  return (
    phase === 'speaking' &&
    stuckMs >= thresholdMs &&
    !isSpeakingPhaseBlocked(blockers)
  );
}
