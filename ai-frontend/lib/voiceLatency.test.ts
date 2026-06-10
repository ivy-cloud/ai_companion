import assert from 'node:assert/strict';
import {
  classifyVoiceToVoiceMs,
  computeListenLatencyGapsFromMarks,
  computeVoiceToVoiceMs,
  voiceLatencyTierSummary,
  VOICE_LATENCY_TARGETS,
} from './voiceLatencyMath.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('listen latency gaps: play_settle → mic_open → listen_ready', () => {
  assert.deepEqual(
    computeListenLatencyGapsFromMarks({
      play_settle: 5000,
      mic_open: 5280,
      listen_ready: 5310,
    }),
    {
      playSettleToMicOpenMs: 280,
      micOpenToListenReadyMs: 30,
      playSettleToListenReadyMs: 310,
    },
  );
});

test('listen latency gaps: null when play_settle missing', () => {
  assert.equal(
    computeListenLatencyGapsFromMarks({ mic_open: 100, listen_ready: 120 }),
    null,
  );
});

test('voice_to_voice_ms: user_speech_end to first_audio_play', () => {
  assert.equal(
    computeVoiceToVoiceMs({
      user_speech_end: 1100,
      first_audio_play: 2450,
    }),
    1350,
  );
});

test('latency tiers: voice_to_voice good / acceptable / slow', () => {
  assert.equal(classifyVoiceToVoiceMs(1200), 'good');
  assert.equal(classifyVoiceToVoiceMs(2500), 'acceptable');
  assert.equal(classifyVoiceToVoiceMs(5000), 'slow');
});

test('latency tier summary in turn_summary marks', () => {
  assert.deepEqual(
    voiceLatencyTierSummary({
      user_speech_end: 1000,
      first_audio_play: 2200,
      play_settle: 8000,
      listen_ready: 8250,
    }),
    { voice_to_voice_tier: 'good', listen_ready_tier: 'good' },
  );
  assert.equal(VOICE_LATENCY_TARGETS.voiceToVoiceMs.good, 1500);
});
