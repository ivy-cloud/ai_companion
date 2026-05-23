/**
 * Semi-continuous voice session — silence end detection via recording metering.
 */

/** Silence after speech before auto-send (ms). */
export const SILENCE_END_MS = 1000;

/** Minimum time above speech threshold before silence can trigger send. */
export const MIN_SPEECH_MS = 400;

/** End conversation session after this much idle time (ms). */
export const SESSION_INACTIVITY_MS = 60_000;

/** How often to poll recording levels. */
export const METERING_INTERVAL_MS = 120;

/** Sustained user speech before voice barge-in fires (ms). */
export const BARGE_IN_MIN_SPEECH_MS = 450;

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
export const POST_TTS_LISTEN_COOLDOWN_MS = 1200;

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
    return { state: next, endSilence: false, inactive: false };
  }

  const silenceSince = state.silenceSince ?? now;
  const next: ConversationMeterState = { ...state, silenceSince };
  const speechMs =
    state.sawSpeech && state.speechStartedAt != null ? now - state.speechStartedAt : 0;
  const endSilence =
    state.sawSpeech &&
    speechMs >= MIN_SPEECH_MS &&
    now - silenceSince >= SILENCE_END_MS;

  const anchor = state.lastSpeechAt ?? state.listenStartedAt;
  const inactive = now - anchor >= SESSION_INACTIVITY_MS;

  return { state: next, endSilence, inactive };
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
