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
    blockers.streamTtsQueueLen > 0 ||
    blockers.chatInFlight
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
  thresholdMs = ASSISTANT_STUCK_MS,
): boolean {
  return (
    phase === 'speaking' &&
    stuckMs >= thresholdMs &&
    !isSpeakingPhaseBlocked(blockers)
  );
}
