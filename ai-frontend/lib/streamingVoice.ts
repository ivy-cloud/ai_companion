/**
 * Decide what to speak while the LLM is still streaming tokens.
 * Only full sentences (. ! ?) — no tiny word fragments (smoother cadence).
 */

import { prepareTextForSpeech, remainderAfterSpoken } from './speechPlayback';

/** First spoken chunk: enough words to start early without tiny fragments */
export const MIN_WORDS_EARLY_START = 6;

/**
 * Next chunk to send to TTS (not yet spoken).
 * @param fullStream - all text received so far
 * @param spokenPrefix - text already queued/spoken this turn
 * @param flush - on stream end: speak any leftover tail as one line
 */
export function nextSpeakableChunk(
  fullStream: string,
  spokenPrefix: string,
  flush = false,
): string | null {
  const full = prepareTextForSpeech(fullStream);
  const spoken = spokenPrefix ? prepareTextForSpeech(spokenPrefix) : '';
  const tail = spoken && full.startsWith(spoken) ? full.slice(spoken.length).trim() : full;
  if (!tail) return null;

  const sentenceMatch = tail.match(/^(.+?[.!?])(?:\s+|$)/);
  if (sentenceMatch) {
    const sentence = sentenceMatch[1].trim();
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return sentence;
    }
  }

  if (!spoken) {
    const words = tail.split(/\s+/).filter(Boolean);
    if (words.length >= MIN_WORDS_EARLY_START) {
      return words.slice(0, MIN_WORDS_EARLY_START).join(' ');
    }
  }

  if (flush && tail.length > 2) {
    return tail;
  }

  return null;
}

export function appendSpoken(spoken: string, chunk: string): string {
  const a = prepareTextForSpeech(spoken);
  const b = prepareTextForSpeech(chunk);
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`.trim();
}

export { remainderAfterSpoken };
