/**
 * Voice conversation orchestration — pacing, chunking, fast acks, interrupt readiness.
 *
 * Interruption: parent owns voiceSession (turn/speakGeneration) + interruptAssistant();
 * any in-flight stream/TTS must check generation before continuing.
 * TTS or stream checks generation before playing the next clip.
 */

import {
  buildSpeechUtterances,
  MAX_UTTERANCE_CHARS,
  type SpeechTrimOptions,
  splitIntoSentences,
} from './speechPlayback';

export type SpeakPart = { text: string };

/** One sentence per clip when possible — better barge-in and stream TTS. */
export const CONVERSATIONAL_CHUNK_CHARS = 100;

export type RhythmMeta = {
  casual?: boolean;
  stream_tts?: boolean;
  fast_ack?: string;
  interruptible?: boolean;
};

export function shouldStreamTtsWhileOpen(
  voiceEnabled: boolean,
  naturalVoice: boolean,
  rhythm?: RhythmMeta | null,
): boolean {
  if (!voiceEnabled) return false;
  if (rhythm?.stream_tts === false) return false;
  return true;
}

/** No artificial pause between clips — Azure + fetch gaps are enough. */
export function utterancePauseMs(
  _index: number,
  _chunkText: string,
  _totalChunks: number,
): number {
  return 0;
}

/**
 * Split trimmed reply into small conversational clips for streaming / final TTS.
 */
export function buildConversationalSpeakParts(
  mainText: string,
  trim: SpeechTrimOptions | false,
  options?: { prependAck?: string },
): SpeakPart[] {
  const trimmed = mainText.trim();
  if (!trimmed) return [];

  const utterances = buildSpeechUtterances(trimmed, trim === false ? false : trim);
  const parts: SpeakPart[] = [];

  if (options?.prependAck?.trim()) {
    parts.push({ text: options.prependAck.trim() });
  }

  for (const block of utterances) {
    const sentences = splitIntoSentences(block);
    if (sentences.length <= 1 && block.length <= CONVERSATIONAL_CHUNK_CHARS) {
      parts.push({ text: block });
      continue;
    }

    let buffer = '';
    for (const sentence of sentences) {
      const next = buffer ? `${buffer} ${sentence}` : sentence;
      if (buffer && next.length > CONVERSATIONAL_CHUNK_CHARS) {
        parts.push({ text: buffer });
        buffer = sentence;
      } else {
        buffer = next;
      }
    }
    if (buffer) parts.push({ text: buffer });
  }

  const filtered = parts.filter((p) => p.text.length > 0);
  if (filtered.length <= 1) return filtered;

  const joined = filtered.map((p) => p.text).join(' ');
  if (joined.length <= MAX_UTTERANCE_CHARS) {
    return [{ text: joined }];
  }

  return filtered;
}

export function fastAckAlreadyInReply(reply: string, ack: string): boolean {
  const r = reply.trim().toLowerCase();
  const a = ack.trim().toLowerCase().replace(/[,.!?]+$/, '');
  return r.startsWith(a);
}
