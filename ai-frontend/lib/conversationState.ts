import { voiceLog, voiceLogPhase } from './voiceTurnLog';

/**
 * Conversation voice state machine — guards, logging, and stuck recovery.
 *
 * Phases:
 *   idle → listening → thinking → streaming → speaking → listening (loop)
 *   any active phase → interrupting → listening | idle
 *   recording — push-to-talk only
 */

export type VoicePhase =
  | 'idle'
  | 'recording'
  | 'listening'
  | 'thinking'
  | 'streaming'
  | 'speaking'
  | 'interrupting';

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

/** Max time to remain in interrupting before watchdog forces idle. */
export const INTERRUPTING_STUCK_MS = 8_000;

/** Assistant phase with no in-flight work — recover to idle/listen. */
export const ASSISTANT_STUCK_MS = 20_000;
