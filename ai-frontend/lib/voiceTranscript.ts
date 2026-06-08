/** Substantive-speech and echo helpers — no native deps (unit-testable). */

/** Ignore accidental tap-and-release and STT noise phrases. */
const PHANTOM_TRANSCRIPTS = new Set([
  'you',
  'the',
  'a',
  'uh',
  'um',
  'hmm',
  'thank you',
  'thanks',
]);

/** Short follow-ups are valid voice input (STT often returns one word). */
const SHORT_VALID_UTTERANCES = new Set([
  'why',
  'how',
  'who',
  'what',
  'when',
  'where',
  'which',
  'really',
  'huh',
  'wow',
  'hey',
  'hi',
  'hello',
  'yes',
  'no',
  'yeah',
  'yep',
  'nope',
  'ok',
  'okay',
  'sure',
  'right',
  'true',
  'false',
  'more',
  'again',
  'wait',
  'stop',
]);

/** True when Azure STT returned no usable text (retry-worthy). */
export function isEmptySttError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('no speech detected');
}

/** Faster no-response diagnostic for greetings and other one-word turns. */
export const SHORT_UTTERANCE_NO_RESPONSE_MS = 20_000;

/** Greeting-sized voice input (e.g. "hello", "hi", short follow-ups). */
export function isHelloSizedUtterance(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');
  if (!normalized) return false;
  if (SHORT_VALID_UTTERANCES.has(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 2 && normalized.length <= 12;
}

export function turnNoResponseTimeoutMs(
  text: string,
  fullMs = 45_000,
): number {
  return isHelloSizedUtterance(text) ? SHORT_UTTERANCE_NO_RESPONSE_MS : fullMs;
}

export function isSubstantiveTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');
  if (!normalized) return false;
  if (SHORT_VALID_UTTERANCES.has(normalized)) return true;
  if (PHANTOM_TRANSCRIPTS.has(normalized)) return false;
  if (normalized.length < 4) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length < 4) return false;
  return true;
}

/**
 * Speaker-echo guard — only applies while assistant audio is actively playing.
 * Pass normalizeSpoken to match TTS normalization (e.g. prepareTextForSpeech).
 */
export function isLikelyAssistantEchoTranscript(
  transcript: string,
  assistantSpokenText: string,
  options: {
    playbackActive: boolean;
    normalizeSpoken?: (text: string) => string;
    lastSentence?: (text: string) => string;
  },
): boolean {
  if (!options.playbackActive) return false;

  const normalize = options.normalizeSpoken ?? ((t: string) => t.trim().toLowerCase());
  const heard = normalize(transcript);
  const spoken = normalize(assistantSpokenText);
  if (!heard || heard.length < 6 || !spoken) return false;
  if (spoken.includes(heard) || heard.includes(spoken)) return true;

  const tailSource = options.lastSentence?.(assistantSpokenText) ?? '';
  if (!tailSource) return false;

  const tailNorm = normalize(tailSource);
  if (tailNorm.includes(heard) || heard.includes(tailNorm)) return true;

  const heardWords = heard.split(/\s+/).filter((w) => w.length > 2);
  const tailWords = new Set(tailNorm.split(/\s+/).filter((w) => w.length > 2));
  const overlap = heardWords.filter((w) => tailWords.has(w)).length;
  return heardWords.length >= 3 && overlap >= Math.min(4, heardWords.length);
}
