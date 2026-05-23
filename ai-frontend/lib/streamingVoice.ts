/**
 * Decide what to speak while the LLM is still streaming tokens.
 * Balance: fast first audio vs avoiding tiny word fragments mid-sentence.
 */

import { prepareTextForSpeech, remainderAfterSpoken } from './speechPlayback';

/** First streaming clip: allow a natural clause break before a full stop. */
export const FIRST_CHUNK_MIN_WORDS = 4;
export const FIRST_CHUNK_MIN_CHARS = 16;

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

  const isFirst = !spoken;

  const sentenceMatch = tail.match(/^(.+?[.!?])(?:\s+|$)/);
  if (sentenceMatch) {
    const sentence = sentenceMatch[1].trim();
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return sentence;
    }
    if (words.length >= 1 && /[.!?]$/.test(sentence)) {
      return sentence;
    }
  }

  if (!flush && isFirst) {
    const clauseMatch = tail.match(/^(.+?[,;:])\s+/);
    if (clauseMatch) {
      const clause = clauseMatch[1].trim();
      const words = clause.split(/\s+/).filter(Boolean);
      if (
        clause.length >= FIRST_CHUNK_MIN_CHARS &&
        words.length >= FIRST_CHUNK_MIN_WORDS
      ) {
        return clause;
      }
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
