/**
 * Incremental TTS while the LLM stream is open: extract speakable sentences
 * from partial text and speak the remainder after the stream finishes.
 */

import { appendSpoken, nextSpeakableChunk } from './streamingVoice';
import {
  buildSpeechUtterances,
  lastSentenceOf,
  prepareTextForSpeech,
  remainderAfterSpoken,
  type SpeechTrimOptions,
} from './speechPlayback';

function isSameSpokenLine(a: string, b: string): boolean {
  const left = prepareTextForSpeech(a);
  const right = prepareTextForSpeech(b);
  return Boolean(left && right && left === right);
}

export type IncrementalTtsState = {
  /** Normalized text already queued or spoken this turn. */
  spokenPrefix: string;
};

export function createIncrementalTtsState(): IncrementalTtsState {
  return { spokenPrefix: '' };
}

export function resetIncrementalTtsState(state: IncrementalTtsState): void {
  state.spokenPrefix = '';
}

/**
 * Pull newly completed sentences (or early clause) from the live stream buffer.
 * Does not mutate spokenPrefix — call commitIncrementalChunks after enqueue/play.
 */
export function pullSpeakableChunks(
  state: IncrementalTtsState,
  fullStream: string,
  flush = false,
  alreadyEnqueued?: Set<string>,
): string[] {
  const chunks: string[] = [];
  let cursor = state.spokenPrefix;
  while (true) {
    const next = nextSpeakableChunk(fullStream, cursor, flush);
    if (!next) break;
    const key = prepareTextForSpeech(next);
    if (key && alreadyEnqueued?.has(key)) {
      // Already queued — advance cursor so flush can reach later sentences.
      cursor = appendSpoken(cursor, next);
      continue;
    }
    chunks.push(next);
    cursor = appendSpoken(cursor, next);
  }
  return chunks;
}

/** Advance spokenPrefix only after chunks were queued (or deduped as already queued). */
export function commitIncrementalChunks(
  state: IncrementalTtsState,
  chunks: string[],
): void {
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    state.spokenPrefix = appendSpoken(state.spokenPrefix, trimmed);
  }
}

/** Utterances still needed after incremental speech (polished final reply). */
export function buildFinalTtsUtterances(
  finalReply: string,
  state: IncrementalTtsState,
  trim: SpeechTrimOptions | false,
): string[] {
  const trimmed = finalReply.trim();
  if (!trimmed) return [];

  const remainder = remainderAfterSpoken(trimmed, state.spokenPrefix);
  const text = remainder ?? (state.spokenPrefix ? '' : trimmed);
  if (!text) return [];

  const utterances = buildSpeechUtterances(text, trim === false ? false : trim);
  const lastSpoken = lastSentenceOf(state.spokenPrefix);
  if (!lastSpoken) return utterances;

  const deduped = utterances.filter((u) => !isSameSpokenLine(u, lastSpoken));
  return deduped;
}

/** True when streaming TTS already spoke the full reply (prevents repeating the last sentence). */
export function streamTtsAlreadyComplete(
  finalReply: string,
  spokenPrefix: string,
): boolean {
  const trimmed = finalReply.trim();
  if (!trimmed) return true;
  if (!spokenPrefix.trim()) return false;

  const remainder = remainderAfterSpoken(trimmed, spokenPrefix);
  if (!remainder) return true;

  const rest = prepareTextForSpeech(remainder);
  const lastSpoken = lastSentenceOf(spokenPrefix);
  if (lastSpoken && isSameSpokenLine(lastSpoken, rest)) {
    return true;
  }

  // Trailing punctuation / filler only — not a repeat of a full new sentence.
  if (rest.length < 12 && !/[.!?]/.test(rest)) {
    return true;
  }

  const full = prepareTextForSpeech(trimmed);
  const spoken = prepareTextForSpeech(spokenPrefix);
  if (full === spoken) return true;
  if (spoken.endsWith(rest)) {
    return true;
  }
  if (!full.startsWith(spoken)) {
    return false;
  }
  const tail = full.slice(spoken.length).trim();
  if (!tail) return true;
  if (lastSpoken && isSameSpokenLine(lastSpoken, tail)) {
    return true;
  }
  // Short non-sentence crumbs only (not "Three."-style closings).
  return tail.length < 12 && !/[.!?]/.test(tail);
}
