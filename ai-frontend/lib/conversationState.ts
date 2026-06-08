import { voiceLog, voiceLogPhase } from './voiceTurnLog';
import {
  canEnterPhase,
  type SpeakingPhaseBlockers,
  type VoicePhase,
} from './conversationStateGuards';

export type { SpeakingPhaseBlockers, VoicePhase };
export {
  ASSISTANT_STUCK_MS,
  SPEAKING_STUCK_MS,
  INTERRUPTING_STUCK_MS,
  THINKING_NO_STREAM_MS,
  TURN_NO_RESPONSE_MS,
  blocksRecordingPrewarm,
  canEnterPhase,
  canExitSpeakingPhaseNow,
  formatSendBlockBanner,
  getInputLockReason,
  getSendMessageSkipReason,
  hasAssistantReplyStarted,
  isAssistantActivePhase,
  isSpeakingPhaseBlocked,
  shouldClearStaleChatInFlight,
  shouldRecoverStuckSpeakingPhase,
  shouldRecoverThinkingNoStream,
  type SendMessageSkipReason,
  type VoiceTurnMarks,
} from './conversationStateGuards';

/**
 * Conversation voice state machine — guards, logging, and stuck recovery.
 *
 * Phases:
 *   idle → listening → thinking → streaming → speaking → listening (loop)
 *   any active phase → interrupting → listening | idle
 *   recording — push-to-talk only
 */

export type VoicePhaseTransitionOptions = {
  /** Bypass transition table (interrupt cleanup, watchdog recovery). */
  force?: boolean;
  reason?: string;
};

export function voiceStateLoggingEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  const flag = process.env.EXPO_PUBLIC_VOICE_STATE_LOG;
  return flag === '1' || flag === 'true';
}

export function logVoiceState(
  event: string,
  detail?: Record<string, string | number | boolean | null | undefined>,
): void {
  const extra = detail
    ? ` ${Object.entries(detail)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`
    : '';
  voiceLog(event, detail);
  if (voiceStateLoggingEnabled()) {
    console.log(`[voice-state] ${event}${extra}`);
  }
}

export { voiceLogPhase };

export type VoicePhaseController = {
  get: () => VoicePhase;
  set: (phase: VoicePhase) => void;
  onChange?: (phase: VoicePhase) => void;
  phaseSince?: () => number;
};

export function transitionVoicePhase(
  ctrl: VoicePhaseController,
  to: VoicePhase,
  options?: VoicePhaseTransitionOptions,
): boolean {
  const from = ctrl.get();
  if (!options?.force && !canEnterPhase(from, to)) {
    logVoiceState('transition_rejected', {
      from,
      to,
      reason: options?.reason ?? 'guard',
    });
    return false;
  }

  if (from !== to) {
    logVoiceState('transition', {
      from,
      to,
      reason: options?.reason ?? 'ok',
      msInPhase: ctrl.phaseSince?.() ?? 0,
    });
    ctrl.set(to);
    ctrl.onChange?.(to);
  }
  return true;
}
