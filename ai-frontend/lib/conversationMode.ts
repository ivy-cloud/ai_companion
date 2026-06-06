import type { VoicePhase } from './conversationState';

/**
 * Semi-continuous voice session — silence end detection via recording metering.
 */

/** Silence after speech before auto-send (ms). Tunable — longer reduces cut-off mid-thought. */
export const SILENCE_END_MS = 1500;

/** Minimum time above speech threshold before silence can trigger send. */
export const MIN_SPEECH_MS = 450;

/** Extra tail captured after silence detected — reduces clipped last syllables. */
export const RECORDING_TAIL_MS = 180;

/** End conversation session after this much idle time (ms). */
export const SESSION_INACTIVITY_MS = 60_000;

/** How often to poll recording levels. */
export const METERING_INTERVAL_MS = 120;

/** Sustained user speech before voice barge-in fires (ms). */
export const BARGE_IN_MIN_SPEECH_MS = 580;

/** Ignore metering briefly after barge-in monitor starts (thinking). */
export const BARGE_IN_GRACE_MS = 600;

/** Extra grace when TTS starts — reduces false triggers from speaker bleed. */
export const BARGE_IN_TTS_GRACE_MS = 1800;

/**
 * Stricter than {@link SPEECH_LEVEL_DB} for barge-in — avoids speaker bleed / room noise.
 */
export const BARGE_IN_SPEECH_LEVEL_DB = -42;

/** After a barge-in interrupt, ignore further triggers for this long (ms). */
export const BARGE_IN_COOLDOWN_MS = 2000;

/** Wait after TTS ends before opening the mic — avoids speaker bleed / echo in the room. */
/** Wait after TTS before opening mic — reduces speaker bleed (see session_log echo). */
export const POST_TTS_LISTEN_COOLDOWN_MS = 700;

/** Retry cadence when listen is temporarily blocked by TTS/drain/in-flight states. */
export const LISTEN_RETRY_MS = 280;

/** Recover when Listening… with no mic or blocked meter for this long (safety only). */
export const LISTENING_STUCK_MS = 6500;

/** Meter may bail while TTS refs are stale — reopen listen after this (ms). */
export const LISTEN_METER_BLOCKED_MS = 2200;

/**
 * Grace after entering listening before treating "no recorder" as stuck.
 * Mic open is async; forcing idle too early caused listen ↔ idle ↔ interrupt flicker.
 */
export const LISTEN_OPEN_GRACE_MS = 1400;

/** Minimum gap between non-retry schedule_listen calls (coalesces rapid reopen). */
export const MIN_SCHEDULE_LISTEN_MS = 400;

/** Recover an active conversation when phase idles with no pending listen reopen. */
export const IDLE_LISTEN_RECOVERY_MS = 2800;

/**
 * Idle + session stuck longer than this — recover even if a listen timer is pending.
 * Retry timers alone can thrash without opening the mic (blocked TTS / stale in-flight).
 */
export const LISTEN_PAUSED_STUCK_MS = 7000;

/** Do not repeat the same watchdog listen recovery within this window. */
export const WATCHDOG_RECOVERY_COOLDOWN_MS = 8000;

/** Idle listen with no user speech before a proactive companion turn (ms). */
export const PROACTIVE_IDLE_MS = 10_000;

/** Minimum gap between proactive turns (ms). */
export const PROACTIVE_MIN_GAP_MS = 20_000;

/** Max proactive turns per session without user speech. */
export const PROACTIVE_MAX_PER_SESSION = 3;

/** Window for detecting rapid phase flips (voiceLog diagnostic). */
export const PHASE_OSCILLATION_WINDOW_MS = 2500;

/** Phase transitions in window that trigger phase_oscillation log. */
export const PHASE_OSCILLATION_MAX_FLIPS = 5;

/** After oscillation is detected, slow listen reschedule (ms). */
export const PHASE_OSCILLATION_COOLDOWN_MS = 4000;

/** Max schedule_listen retries before giving up until next successful open. */
export const MAX_LISTEN_SCHEDULE_RETRIES = 48;

/** Upper bound for listen retry delay after many failures (~13s at 280ms base). */
export const LISTEN_RETRY_MAX_DELAY_MS = 2000;

/**
 * True when listening has no recorder long enough to force idle / watchdog recovery.
 */
export function shouldForceIdleListeningWithoutRecording(
  msInListeningPhase: number,
  hasRecording: boolean,
): boolean {
  if (hasRecording) return false;
  return msInListeningPhase >= LISTEN_OPEN_GRACE_MS;
}

/** True when the listen meter has been TTS-blocked long enough to force recovery. */
export function shouldRecoverListeningMeterBlocked(
  blockedMs: number,
  ttsBlocked: boolean,
): boolean {
  return ttsBlocked && blockedMs >= LISTEN_METER_BLOCKED_MS;
}

/**
 * True when conversation session shows "Listening paused" (idle) long enough to force reopen.
 */
export function shouldRecoverListenPausedStuck(
  stuckMs: number,
  hasPendingListenTimer: boolean,
): boolean {
  if (stuckMs < IDLE_LISTEN_RECOVERY_MS) return false;
  if (!hasPendingListenTimer) return true;
  return stuckMs >= LISTEN_PAUSED_STUCK_MS;
}

/**
 * Expo metering is dBFS (negative). Above this ≈ speech; below ≈ silence.
 * Tune per device if needed.
 */
export const SPEECH_LEVEL_DB = -50;

export function isSpeechLevel(metering?: number): boolean {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return false;
  }
  return metering > SPEECH_LEVEL_DB;
}

export function isBargeInSpeechLevel(metering?: number): boolean {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return false;
  }
  return metering > BARGE_IN_SPEECH_LEVEL_DB;
}

export type ConversationMeterState = {
  sawSpeech: boolean;
  speechStartedAt: number | null;
  silenceSince: number | null;
  listenStartedAt: number;
  lastSpeechAt: number | null;
};

export function createConversationMeterState(now = Date.now()): ConversationMeterState {
  return {
    sawSpeech: false,
    speechStartedAt: null,
    silenceSince: null,
    listenStartedAt: now,
    lastSpeechAt: null,
  };
}

export type MeterTickResult = {
  state: ConversationMeterState;
  /** Enough speech + trailing silence — stop chunk and send. */
  endSilence: boolean;
  /** No speech for SESSION_INACTIVITY_MS — end session. */
  inactive: boolean;
  /** Ms of speech when endSilence fired (0 otherwise). */
  speechDurationMs: number;
  /** Ms of trailing silence when endSilence fired (0 otherwise). */
  silenceDurationMs: number;
};

export function tickConversationMeter(
  state: ConversationMeterState,
  metering: number | undefined,
  now: number,
): MeterTickResult {
  const speech = isSpeechLevel(metering);

  if (speech) {
    const next: ConversationMeterState = {
      ...state,
      sawSpeech: true,
      speechStartedAt: state.speechStartedAt ?? now,
      silenceSince: null,
      lastSpeechAt: now,
    };
    return { state: next, endSilence: false, inactive: false, speechDurationMs: 0, silenceDurationMs: 0 };
  }

  const silenceSince = state.silenceSince ?? now;
  const next: ConversationMeterState = { ...state, silenceSince };
  const speechMs =
    state.sawSpeech && state.speechStartedAt != null ? now - state.speechStartedAt : 0;
  const silenceMs = now - silenceSince;
  const endSilence =
    state.sawSpeech &&
    speechMs >= MIN_SPEECH_MS &&
    silenceMs >= SILENCE_END_MS;

  const anchor = state.lastSpeechAt ?? state.listenStartedAt;
  const inactive = now - anchor >= SESSION_INACTIVITY_MS;

  return {
    state: next,
    endSilence,
    inactive,
    speechDurationMs: endSilence ? speechMs : 0,
    silenceDurationMs: endSilence ? silenceMs : 0,
  };
}

export type BargeInMeterState = {
  speechStartedAt: number | null;
};

export function createBargeInMeterState(): BargeInMeterState {
  return { speechStartedAt: null };
}

/** Voice interrupt while assistant is thinking or speaking (conversation mode). */
export function tickConversationBargeIn(
  state: BargeInMeterState,
  metering: number | undefined,
  now: number,
  graceUntil: number,
): { state: BargeInMeterState; triggered: boolean } {
  if (now < graceUntil) {
    return { state: { speechStartedAt: null }, triggered: false };
  }

  if (!isBargeInSpeechLevel(metering)) {
    return { state: { speechStartedAt: null }, triggered: false };
  }

  const speechStartedAt = state.speechStartedAt ?? now;
  const triggered = now - speechStartedAt >= BARGE_IN_MIN_SPEECH_MS;
  return { state: { speechStartedAt }, triggered };
}

/**
 * Whether conversation listen can start (or restart) from the current phase.
 * When already listening with an active recorder, returns false (no-op).
 */
export function canResumeConversationListen(
  phase: VoicePhase,
  hasRecording: boolean,
  resumeAfterInterrupt: boolean,
): boolean {
  if (phase === 'listening' && hasRecording) {
    return false;
  }
  if (!resumeAfterInterrupt) {
    return phase === 'idle' || phase === 'speaking';
  }
  return (
    phase === 'idle' ||
    phase === 'speaking' ||
    phase === 'thinking' ||
    phase === 'streaming' ||
    phase === 'interrupting' ||
    (phase === 'listening' && !hasRecording)
  );
}
