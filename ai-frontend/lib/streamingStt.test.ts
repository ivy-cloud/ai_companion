import assert from 'node:assert/strict';
import {
  canRollPartialStt,
  mergePartialSttTranscripts,
  PARTIAL_STT_INTERVAL_MS,
  PARTIAL_STT_MIN_SPEECH_MS,
  PARTIAL_STT_ROLL_ENABLED,
  resolveVoiceTranscript,
  shouldRollPartialStt,
} from './streamingStt.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('partial STT timing constants bounded', () => {
  assert.ok(PARTIAL_STT_MIN_SPEECH_MS >= 350 && PARTIAL_STT_MIN_SPEECH_MS <= 800);
  assert.ok(PARTIAL_STT_INTERVAL_MS >= 600 && PARTIAL_STT_INTERVAL_MS <= 1500);
});

test('partial STT rolls disabled on Expo (single Recording)', () => {
  assert.equal(PARTIAL_STT_ROLL_ENABLED, false);
  const t0 = 1000;
  assert.equal(
    canRollPartialStt(true, t0, null, t0 + PARTIAL_STT_INTERVAL_MS),
    false,
  );
});

test('canRollPartialStt skips while commit in flight', () => {
  const t0 = 1000;
  assert.equal(
    canRollPartialStt(true, t0, null, t0 + PARTIAL_STT_INTERVAL_MS, {
      enabled: true,
      commitInFlight: true,
    }),
    false,
  );
  assert.equal(
    canRollPartialStt(true, t0, null, t0 + PARTIAL_STT_INTERVAL_MS, {
      enabled: true,
      commitInFlight: false,
    }),
    true,
  );
});

test('shouldRollPartialStt: needs speech first', () => {
  const t0 = 1000;
  assert.equal(shouldRollPartialStt(false, null, null, t0), false);
  assert.equal(shouldRollPartialStt(true, t0, null, t0 + 100), false);
});

test('shouldRollPartialStt: first roll after interval from speech start', () => {
  const t0 = 1000;
  const start = t0;
  assert.equal(
    shouldRollPartialStt(true, start, null, t0 + PARTIAL_STT_INTERVAL_MS - 1),
    false,
  );
  assert.equal(
    shouldRollPartialStt(true, start, null, t0 + PARTIAL_STT_INTERVAL_MS),
    true,
  );
});

test('shouldRollPartialStt: respects interval between rolls', () => {
  const t0 = 1000;
  const last = t0 + 2000;
  assert.equal(shouldRollPartialStt(true, t0, last, last + 100), false);
  assert.equal(
    shouldRollPartialStt(true, t0, last, last + PARTIAL_STT_INTERVAL_MS),
    true,
  );
});

test('mergePartialSttTranscripts joins chunks', () => {
  assert.equal(mergePartialSttTranscripts('hello', 'world'), 'hello world');
  assert.equal(mergePartialSttTranscripts('', 'first'), 'first');
});

test('resolveVoiceTranscript uses partial when final STT empty', () => {
  assert.equal(
    resolveVoiceTranscript('', 'No, I. You cannot. Hear me, OK?'),
    'No, I. You cannot. Hear me, OK?',
  );
});

test('resolveVoiceTranscript avoids duplicate when tail repeats partial', () => {
  assert.equal(
    resolveVoiceTranscript('hear me ok', 'No, I. You cannot. Hear me, OK?'),
    'No, I. You cannot. Hear me, OK?',
  );
});

test('resolveVoiceTranscript joins non-overlapping tail', () => {
  assert.equal(resolveVoiceTranscript('today', 'hello'), 'hello today');
});
