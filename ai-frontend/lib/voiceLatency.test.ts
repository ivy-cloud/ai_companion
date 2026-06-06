import assert from 'node:assert/strict';
import { computeListenLatencyGaps, type VoiceTurnTiming } from './voiceLatency.ts';

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
  const timing: VoiceTurnTiming = {
    turn: 1,
    t0: 1000,
    marks: {
      play_settle: 5000,
      mic_open: 5280,
      listen_ready: 5310,
    },
    chunkCount: 1,
  };
  assert.deepEqual(computeListenLatencyGaps(timing), {
    playSettleToMicOpenMs: 280,
    micOpenToListenReadyMs: 30,
    playSettleToListenReadyMs: 310,
  });
});

test('listen latency gaps: null when play_settle missing', () => {
  const timing: VoiceTurnTiming = {
    turn: 2,
    t0: 0,
    marks: { mic_open: 100, listen_ready: 120 },
    chunkCount: 0,
  };
  assert.equal(computeListenLatencyGaps(timing), null);
});
