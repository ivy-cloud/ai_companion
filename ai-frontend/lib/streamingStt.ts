/**
 * Rolling partial STT while the user speaks (incremental recording chunks).
 * Display + semantic hints only — final turn commit still uses end-of-utterance STT.
 */

import { combineUtteranceTranscripts } from './conversationMode';

/** Min speech before first partial STT roll. */
export const PARTIAL_STT_MIN_SPEECH_MS = 500;

/** Cadence between rolling recording snapshots sent to /stt?partial=1. */
export const PARTIAL_STT_INTERVAL_MS = 900;

/**
 * Expo allows only one Recording at a time — rolling snapshots stop/unload the
 * listen recorder and race end_silence + barge-in. Keep off until copy-without-stop exists.
 */
export const PARTIAL_STT_ROLL_ENABLED = false;

export function shouldRollPartialStt(
  sawSpeech: boolean,
  speechStartedAt: number | null,
  lastPartialSttAt: number | null,
  now: number,
): boolean {
  if (!sawSpeech || speechStartedAt == null) return false;
  const speechMs = now - speechStartedAt;
  if (speechMs < PARTIAL_STT_MIN_SPEECH_MS) return false;
  if (lastPartialSttAt == null) {
    return speechMs >= PARTIAL_STT_INTERVAL_MS;
  }
  return now - lastPartialSttAt >= PARTIAL_STT_INTERVAL_MS;
}

/** Gate rolling partial STT — disabled on Expo by default (recorder conflict). */
export function canRollPartialStt(
  sawSpeech: boolean,
  speechStartedAt: number | null,
  lastPartialSttAt: number | null,
  now: number,
  opts?: { commitInFlight?: boolean; enabled?: boolean },
): boolean {
  if (opts?.commitInFlight) return false;
  const enabled = opts?.enabled ?? PARTIAL_STT_ROLL_ENABLED;
  if (!enabled) return false;
  return shouldRollPartialStt(sawSpeech, speechStartedAt, lastPartialSttAt, now);
}

/** Append chunk transcript for live caption (Azure returns per-chunk text). */
export function mergePartialSttTranscripts(prev: string, chunk: string): string {
  return combineUtteranceTranscripts(prev, chunk);
}

/**
 * Merge rolling partial caption with final tail STT.
 * Partial rolls transcribe earlier segments; final STT only sees audio since the last roll
 * (often too short → empty). Prefer the longer partial when the tail duplicates it.
 */
export function resolveVoiceTranscript(
  finalStt: string,
  rollingPartial: string,
): string {
  const final = finalStt.trim();
  const partial = rollingPartial.trim();
  if (!final) return partial;
  if (!partial) return final;
  const normPartial = partial.toLowerCase();
  const normFinal = final.toLowerCase();
  if (
    normPartial.endsWith(normFinal) ||
    normPartial.includes(normFinal) ||
    normFinal.length < partial.length * 0.6
  ) {
    return partial;
  }
  return combineUtteranceTranscripts(partial, final);
}
