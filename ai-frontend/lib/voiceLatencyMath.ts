/** Pure voice timing math — no React Native deps (unit-testable). */

export type VoiceTimingMarks = Partial<
  Record<
    | 'play_settle'
    | 'mic_open'
    | 'listen_ready'
    | 'user_speech_end'
    | 'first_audio_play',
    number
  >
>;

export type ListenLatencyGaps = {
  playSettleToMicOpenMs: number;
  micOpenToListenReadyMs: number;
  playSettleToListenReadyMs: number;
};

export function computeListenLatencyGapsFromMarks(
  marks: VoiceTimingMarks,
  now = Date.now(),
): ListenLatencyGaps | null {
  if (marks.play_settle == null || marks.mic_open == null) {
    return null;
  }
  const listenReady = marks.listen_ready ?? now;
  return {
    playSettleToMicOpenMs: marks.mic_open - marks.play_settle,
    micOpenToListenReadyMs: listenReady - marks.mic_open,
    playSettleToListenReadyMs: listenReady - marks.play_settle,
  };
}

/** End of user speech → first audible TTS playback (ms). */
export function computeVoiceToVoiceMs(marks: VoiceTimingMarks): number | null {
  if (marks.user_speech_end == null || marks.first_audio_play == null) {
    return null;
  }
  return marks.first_audio_play - marks.user_speech_end;
}

/** Competitor-informed targets — see docs/voice-competitor-learnings.md */
export const VOICE_LATENCY_TARGETS = {
  voiceToVoiceMs: { good: 1500, acceptable: 4000 },
  firstTokenMs: { good: 800, acceptable: 2000 },
  listenReadyAfterPlaySettleMs: { good: 300, acceptable: 800 },
} as const;

export type LatencyTier = 'good' | 'acceptable' | 'slow';

export function classifyLatencyMs(
  ms: number,
  target: { good: number; acceptable: number },
): LatencyTier {
  if (ms <= target.good) return 'good';
  if (ms <= target.acceptable) return 'acceptable';
  return 'slow';
}

export function classifyVoiceToVoiceMs(ms: number): LatencyTier {
  return classifyLatencyMs(ms, VOICE_LATENCY_TARGETS.voiceToVoiceMs);
}

export function voiceLatencyTierSummary(marks: VoiceTimingMarks): {
  voice_to_voice_tier: LatencyTier | null;
  listen_ready_tier: LatencyTier | null;
} {
  const v2v = computeVoiceToVoiceMs(marks);
  let listenReadyTier: LatencyTier | null = null;
  if (marks.play_settle != null && marks.listen_ready != null) {
    listenReadyTier = classifyLatencyMs(
      marks.listen_ready - marks.play_settle,
      VOICE_LATENCY_TARGETS.listenReadyAfterPlaySettleMs,
    );
  }
  return {
    voice_to_voice_tier: v2v != null ? classifyVoiceToVoiceMs(v2v) : null,
    listen_ready_tier: listenReadyTier,
  };
}
