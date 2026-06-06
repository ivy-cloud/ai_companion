import assert from 'node:assert/strict';
import {
  ASSISTANT_STUCK_MS,
  canEnterPhase,
  canExitSpeakingPhaseNow,
  isSpeakingPhaseBlocked,
  shouldRecoverStuckSpeakingPhase,
} from './conversationStateGuards.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('listening → thinking', () => {
  assert.equal(canEnterPhase('listening', 'thinking'), true);
});

test('thinking → streaming', () => {
  assert.equal(canEnterPhase('thinking', 'streaming'), true);
});

test('streaming → speaking', () => {
  assert.equal(canEnterPhase('streaming', 'speaking'), true);
});

test('speaking → listening', () => {
  assert.equal(canEnterPhase('speaking', 'listening'), true);
});

test('interrupting only via force path', () => {
  assert.equal(canEnterPhase('thinking', 'interrupting'), true);
  assert.equal(canEnterPhase('idle', 'interrupting'), false);
});

test('interrupting → listening', () => {
  assert.equal(canEnterPhase('interrupting', 'listening'), true);
});

test('idle → speaking allowed for session opener', () => {
  assert.equal(canEnterPhase('idle', 'speaking'), true);
});

test('speaking blocked while TTS refs active', () => {
  const blocked = {
    speakInFlight: true,
    streamTtsDraining: false,
    streamTtsQueueLen: 0,
    activeSound: false,
    chatInFlight: false,
  };
  assert.equal(isSpeakingPhaseBlocked(blocked), true);
  assert.equal(canExitSpeakingPhaseNow('speaking', blocked), false);
});

test('speaking can exit when idle work', () => {
  const clear = {
    speakInFlight: false,
    streamTtsDraining: false,
    streamTtsQueueLen: 0,
    activeSound: false,
    chatInFlight: false,
  };
  assert.equal(canExitSpeakingPhaseNow('speaking', clear), true);
  assert.equal(canExitSpeakingPhaseNow('streaming', clear), false);
});

test('watchdog speaking recovery threshold', () => {
  const clear = {
    speakInFlight: false,
    streamTtsDraining: false,
    streamTtsQueueLen: 0,
    activeSound: false,
    chatInFlight: false,
  };
  assert.equal(
    shouldRecoverStuckSpeakingPhase('speaking', clear, ASSISTANT_STUCK_MS - 1),
    false,
  );
  assert.equal(
    shouldRecoverStuckSpeakingPhase('speaking', clear, ASSISTANT_STUCK_MS),
    true,
  );
});

test('speaking blocked while stream TTS draining', () => {
  const blocked = {
    speakInFlight: false,
    streamTtsDraining: true,
    streamTtsQueueLen: 0,
    activeSound: false,
    chatInFlight: false,
  };
  assert.equal(isSpeakingPhaseBlocked(blocked), true);
  assert.equal(canExitSpeakingPhaseNow('speaking', blocked), false);
});

test('speaking blocked while chat in flight', () => {
  const blocked = {
    speakInFlight: false,
    streamTtsDraining: false,
    streamTtsQueueLen: 0,
    activeSound: false,
    chatInFlight: true,
  };
  assert.equal(isSpeakingPhaseBlocked(blocked), true);
  assert.equal(canExitSpeakingPhaseNow('speaking', blocked), false);
});

test('idle can enter listening for conversation session', () => {
  assert.equal(canEnterPhase('idle', 'listening'), true);
});
