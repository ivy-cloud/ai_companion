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
  /** Normalized text already played this turn. */
  spokenPrefix: string;
  /** Normalized text queued for playback (may be ahead of spokenPrefix). */
  queuedPrefix: string;
};

export function createIncrementalTtsState(): IncrementalTtsState {
  return { spokenPrefix: '', queuedPrefix: '' };
}

export function resetIncrementalTtsState(state: IncrementalTtsState): void {
  state.spokenPrefix = '';
  state.queuedPrefix = '';
}

/**
 * Pull newly completed sentences (or early clause) from the live stream buffer.
 * Does not mutate prefixes — call commitQueuedChunks after enqueue.
 */
export function pullSpeakableChunks(
  state: IncrementalTtsState,
  fullStream: string,
  flush = false,
  alreadyEnqueued?: Set<string>,
): string[] {
  const chunks: string[] = [];
  let cursor = state.queuedPrefix;
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

/** Advance queuedPrefix only after chunks were added to the playback queue. */
export function commitQueuedChunks(
  state: IncrementalTtsState,
  chunks: string[],
): void {
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    state.queuedPrefix = appendSpoken(state.queuedPrefix, trimmed);
  }
}

/** Advance spokenPrefix only after audio for a chunk actually played. */
export function commitPlayedChunk(state: IncrementalTtsState, chunk: string): void {
  const trimmed = chunk.trim();
  if (!trimmed) return;
  state.spokenPrefix = appendSpoken(state.spokenPrefix, trimmed);
}

/** @deprecated Use commitQueuedChunks / commitPlayedChunk. */
export function commitIncrementalChunks(
  state: IncrementalTtsState,
  chunks: string[],
): void {
  commitQueuedChunks(state, chunks);
}

function replyPrefixCoversFull(reply: string, prefix: string): boolean {
  const trimmed = reply.trim();
  if (!trimmed || !prefix.trim()) return false;

  const full = prepareTextForSpeech(trimmed);
  const pref = prepareTextForSpeech(prefix);
  if (!full || !pref) return false;
  if (full === pref) return true;
  if (!full.startsWith(pref)) return false;

  const tail = full.slice(pref.length).trim();
  if (!tail) return true;

  const lastInPrefix = lastSentenceOf(prefix);
  if (lastInPrefix && isSameSpokenLine(lastInPrefix, tail)) {
    return true;
  }
  return false;
}

/** Utterances still needed after incremental speech (polished final reply). */
export function buildFinalTtsUtterances(
  finalReply: string,
  state: IncrementalTtsState,
  trim: SpeechTrimOptions | false,
): string[] {
  const trimmed = finalReply.trim();
  if (!trimmed) return [];
  if (streamTtsAlreadyComplete(trimmed, state)) return [];

  // Only spokenPrefix reflects audio the user heard — queued may be ahead of playback.
  const remainder = remainderAfterSpoken(trimmed, state.spokenPrefix);
  const text = remainder ?? (state.spokenPrefix.trim() ? '' : trimmed);
  if (!text) return [];

  const utterances = buildSpeechUtterances(text, trim === false ? false : trim);
  const lastSpoken = lastSentenceOf(state.spokenPrefix);
  if (!lastSpoken) return utterances;

  const deduped = utterances.filter((u) => !isSameSpokenLine(u, lastSpoken));
  return deduped;
}

/** True when streaming TTS already played the full reply (not merely queued). */
export function streamTtsAlreadyComplete(
  finalReply: string,
  stateOrSpoken: IncrementalTtsState | string,
): boolean {
  const state: IncrementalTtsState =
    typeof stateOrSpoken === 'string'
      ? { spokenPrefix: stateOrSpoken, queuedPrefix: stateOrSpoken }
      : stateOrSpoken;

  const trimmed = finalReply.trim();
  if (!trimmed) return true;

  if (!state.spokenPrefix.trim()) return false;

  if (replyPrefixCoversFull(trimmed, state.spokenPrefix)) {
    return true;
  }

  const full = prepareTextForSpeech(trimmed);
  const spoken = prepareTextForSpeech(state.spokenPrefix);
  if (full === spoken) return true;

  const remainder = remainderAfterSpoken(trimmed, state.spokenPrefix);
  if (!remainder) {
    return false;
  }

  const rest = prepareTextForSpeech(remainder);
  const lastSpoken = lastSentenceOf(state.spokenPrefix);
  if (lastSpoken && isSameSpokenLine(lastSpoken, rest)) {
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
  return false;
}
