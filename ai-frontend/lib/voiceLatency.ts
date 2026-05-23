/**
 * Voice turn timing — also written to session log via voiceTurnLog.
 */

import { voiceLog } from './voiceTurnLog';

export type VoiceTimingMark =
  | 'send_start'
  | 'stream_start'
  | 'first_token'
  | 'first_tts_enqueue'
  | 'first_tts_fetch_done'
  | 'first_audio_play'
  | 'chunk_play'
  | 'stream_done'
  | 'final_tts_start'
  | 'interrupt';

export type VoiceTurnTiming = {
  turn: number;
  t0: number;
  marks: Partial<Record<VoiceTimingMark, number>>;
  chunkCount: number;
};

export function voiceLatencyLoggingEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  const flag = process.env.EXPO_PUBLIC_VOICE_LATENCY_LOG;
  return flag === '1' || flag === 'true';
}

export function createVoiceTurnTiming(turn: number): VoiceTurnTiming {
  return { turn, t0: Date.now(), marks: {}, chunkCount: 0 };
}

export function markVoiceTiming(
  timing: VoiceTurnTiming | null,
  mark: VoiceTimingMark,
): void {
  if (!timing || timing.marks[mark] != null) return;
  timing.marks[mark] = Date.now();
  const ms = timing.marks[mark]! - timing.t0;
  voiceLog(`timing_${mark}`, { ms, turn: timing.turn });
  if (!voiceLatencyLoggingEnabled()) return;
  console.log(`[voice-latency] turn=${timing.turn} ${mark} +${ms}ms`);
}

export function markVoiceChunkPlay(timing: VoiceTurnTiming | null): void {
  if (!timing) return;
  timing.chunkCount += 1;
  if (timing.chunkCount === 1) {
    markVoiceTiming(timing, 'first_audio_play');
  } else {
    markVoiceTiming(timing, 'chunk_play');
  }
}

export function logVoiceTurnSummary(timing: VoiceTurnTiming | null): void {
  if (!timing) return;
  const m = timing.marks;
  const ms = (mark: VoiceTimingMark) =>
    m[mark] != null ? m[mark]! - timing.t0 : null;
  voiceLog('turn_summary', {
    turn: timing.turn,
    first_token_ms: ms('first_token') ?? '—',
    first_tts_enqueue_ms: ms('first_tts_enqueue') ?? '—',
    first_tts_fetch_done_ms: ms('first_tts_fetch_done') ?? '—',
    first_audio_play_ms: ms('first_audio_play') ?? '—',
    stream_done_ms: ms('stream_done') ?? '—',
    audio_chunks: timing.chunkCount,
  });
  if (!voiceLatencyLoggingEnabled()) return;
  const line = (mark: VoiceTimingMark) =>
    m[mark] != null ? `${mark}=${m[mark]! - timing.t0}ms` : `${mark}=—`;
  console.log(
    `[voice-latency] turn=${timing.turn} summary ${line('first_token')} ${line('first_tts_enqueue')} ${line('first_tts_fetch_done')} ${line('first_audio_play')} ${line('stream_done')} chunks=${timing.chunkCount}`,
  );
}
