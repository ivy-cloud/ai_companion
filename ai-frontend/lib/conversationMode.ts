/**
 * Semi-continuous voice session — silence end detection via recording metering.
 */

/** Silence after speech before auto-send (ms). */
export const SILENCE_END_MS = 1500;

/** Minimum time above speech threshold before silence can trigger send. */
export const MIN_SPEECH_MS = 400;

/** End conversation session after this much idle time (ms). */
export const SESSION_INACTIVITY_MS = 60_000;

/** How often to poll recording levels. */
export const METERING_INTERVAL_MS = 120;

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

export type VoicePhase = 'idle' | 'listening' | 'processing' | 'speaking';

export function voicePhaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case 'listening':
      return 'Listening…';
    case 'processing':
      return 'Processing…';
    case 'speaking':
      return 'Speaking…';
    default:
      return '';
  }
}
