/**
 * Incremental TTS while the LLM stream is open: extract speakable sentences
 * from partial text and speak the remainder after the stream finishes.
 */

import { appendSpoken, nextSpeakableChunk } from './streamingVoice';
import {
  buildSpeechUtterances,
  remainderAfterSpoken,
  type SpeechTrimOptions,
} from './speechPlayback';

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

/** Pull newly completed sentences (or early clause) from the live stream buffer. */
export function pullSpeakableChunks(
  state: IncrementalTtsState,
  fullStream: string,
  flush = false,
): string[] {
  const chunks: string[] = [];
  while (true) {
    const next = nextSpeakableChunk(fullStream, state.spokenPrefix, flush);
    if (!next) break;
    chunks.push(next);
    state.spokenPrefix = appendSpoken(state.spokenPrefix, next);
  }
  return chunks;
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

  return buildSpeechUtterances(text, trim === false ? false : trim);
}
