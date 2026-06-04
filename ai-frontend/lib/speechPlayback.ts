/**
 * Azure TTS (expo-av): one smooth clip when possible.
 * Split ONLY on . ! ? — never commas. No artificial pauses between chunks.
 */

import { normalizeForSpeech } from './spokenNormalize';

/** ~3 short spoken sentences from the backend (25 words). */
export const MAX_SPOKEN_CHARS = 300;
export const MAX_UTTERANCE_CHARS = 420;
export const MAX_SPOKEN_SENTENCES = 2;
export const MAX_SPOKEN_SENTENCES_CASUAL = 2;
export const MAX_SPOKEN_CHARS_CASUAL = 140;

export type SpeechTrimOptions = {
  maxSentences: number;
  maxChars: number;
};

export const SENTENCE_END_SPLIT = /(?<=[.!?])\s+/;

export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(SENTENCE_END_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stripEmojisAndSymbols(text: string): string {
  let cleaned = text;
  try {
    cleaned = cleaned.replace(/\p{Extended_Pictographic}+/gu, '');
    cleaned = cleaned.replace(/\p{Emoji}+/gu, '');
  } catch {
    cleaned = cleaned.replace(
      /(?:\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF]|[\u2600-\u27BF])/g,
      '',
    );
  }
  return cleaned
    .replace(/[@#$%^&*+=|\\<>~`[\]{}©®™°§¶•·/]/g, '')
    .replace(/[\u200B-\u200D\uFEFF\uFE0F]/g, '')
    .replace(/[*_#`]/g, '');
}

/** TTS-friendly: natural words, light punctuation, no spelled fragments. */
export function polishSpokenText(text: string): string {
  const base = stripEmojisAndSymbols(text)
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s*:\s*/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizeForSpeech(base);
}

export function prepareTextForSpeech(text: string): string {
  return polishSpokenText(text);
}

function trimBySentences(
  text: string,
  options: SpeechTrimOptions,
  normalize: (raw: string) => string,
): string {
  let cleaned = normalize(text);
  if (!cleaned) return '';

  let sentences = splitIntoSentences(cleaned);
  if (sentences.length === 0) {
    return cleaned.length <= options.maxChars
      ? cleaned
      : cleaned.slice(0, options.maxChars).replace(/\s+\S*$/, '').trim();
  }

  sentences = sentences.slice(0, options.maxSentences);
  cleaned = sentences.join(' ').trim();

  while (sentences.length > 1 && cleaned.length > options.maxChars) {
    sentences.pop();
    cleaned = sentences.join(' ').trim();
  }

  if (cleaned.length > options.maxChars) {
    cleaned = cleaned.slice(0, options.maxChars).replace(/\s+\S*$/, '').trim();
    if (!/[.!?]$/.test(cleaned)) cleaned += '.';
  }

  return cleaned;
}

/** Limits for TTS (normalized words, no spelled digits). */
export function trimForVoicePlayback(
  text: string,
  options: SpeechTrimOptions = {
    maxSentences: MAX_SPOKEN_SENTENCES,
    maxChars: MAX_SPOKEN_CHARS,
  },
): string {
  return trimBySentences(text, options, prepareTextForSpeech);
}

/** Same sentence/char limits as voice, but keeps normal punctuation for the chat bubble. */
export function trimReplyForDisplay(text: string, options: SpeechTrimOptions): string {
  return trimBySentences(text, options, (raw) =>
    stripEmojisAndSymbols(raw).replace(/\s+/g, ' ').trim(),
  );
}

export function replyTrimOptions(
  casualVoice: boolean,
  voiceEnabled: boolean,
): SpeechTrimOptions | false {
  if (!voiceEnabled || !casualVoice) return false;
  return {
    maxSentences: MAX_SPOKEN_SENTENCES_CASUAL,
    maxChars: MAX_SPOKEN_CHARS_CASUAL,
  };
}

export function formatReplyForUi(
  reply: string,
  casualVoice: boolean,
  voiceEnabled: boolean,
): string {
  const opts = replyTrimOptions(casualVoice, voiceEnabled);
  if (!opts) return reply.trim();
  return trimReplyForDisplay(reply, opts);
}

/** First full sentence for early TTS while the model is still streaming. */
export function firstCompleteSentence(text: string): string | null {
  const cleaned = prepareTextForSpeech(text);
  const match = cleaned.match(/^(.+?[.!?])(?:\s+|$)/);
  if (!match) return null;
  const sentence = match[1].trim();
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return sentence;
}

/** Last sentence from normalized spoken text (for deduping stream vs final TTS). */
export function lastSentenceOf(text: string): string | null {
  const sentences = splitIntoSentences(prepareTextForSpeech(text));
  return sentences.length > 0 ? sentences[sentences.length - 1] : null;
}

/** Text after an already-spoken prefix (same normalization). */
export function remainderAfterSpoken(full: string, spokenPrefix: string): string | null {
  const fullClean = prepareTextForSpeech(full);
  const prefixClean = prepareTextForSpeech(spokenPrefix);
  if (!fullClean) return null;
  if (!prefixClean) return fullClean;
  if (fullClean === prefixClean) return null;
  if (prefixClean.startsWith(fullClean) || prefixClean.length >= fullClean.length * 0.88) {
    return null;
  }
  if (!fullClean.startsWith(prefixClean)) {
    return null;
  }
  const rest = fullClean.slice(prefixClean.length).trim();
  return rest.length > 0 ? rest : null;
}

/**
 * One utterance by default — continuous speech, no comma-sized fragments.
 */
export function buildSpeechUtterances(
  text: string,
  trim: boolean | SpeechTrimOptions = true,
): string[] {
  let cleaned: string;
  if (trim === false) {
    cleaned = prepareTextForSpeech(text);
  } else if (trim === true) {
    cleaned = trimForVoicePlayback(text);
  } else {
    cleaned = trimForVoicePlayback(text, trim);
  }
  if (!cleaned) return [];

  if (cleaned.length <= MAX_UTTERANCE_CHARS) {
    return [cleaned];
  }

  const sentences = splitIntoSentences(cleaned);
  if (sentences.length <= 1) {
    return [cleaned];
  }

  const utterances: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const next = buffer ? `${buffer} ${sentence}` : sentence;
    if (next.length > MAX_UTTERANCE_CHARS && buffer) {
      utterances.push(buffer);
      buffer = sentence;
    } else {
      buffer = next;
    }
  }

  if (buffer) utterances.push(buffer);
  return utterances.length > 0 ? utterances : [cleaned];
}

/** @deprecated Prefer utterancePauseMs from conversationOrchestration for varied pacing. */
export function pauseBetweenUtterances(hasMore: boolean): number {
  return hasMore ? 200 : 0;
}

/** Join queued stream chunks into one continuous speak line. */
export function coalesceSpeechChunks(chunks: string[]): string {
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
