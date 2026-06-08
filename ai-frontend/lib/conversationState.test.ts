import assert from 'node:assert/strict';
import {
  SPEAKING_STUCK_MS,
  THINKING_NO_STREAM_MS,
  canEnterPhase,
  canExitSpeakingPhaseNow,
  getSendMessageSkipReason,
  hasAssistantReplyStarted,
  isSpeakingPhaseBlocked,
  shouldClearStaleChatInFlight,
  shouldRecoverStuckSpeakingPhase,
  shouldRecoverThinkingNoStream,
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
    shouldRecoverStuckSpeakingPhase('speaking', clear, SPEAKING_STUCK_MS - 1),
    false,
  );
  assert.equal(
    shouldRecoverStuckSpeakingPhase('speaking', clear, SPEAKING_STUCK_MS),
    true,
  );
});

test('chat in flight does not block speaking exit', () => {
  const chatStillOpen = {
    speakInFlight: false,
    streamTtsDraining: false,
    streamTtsQueueLen: 0,
    activeSound: false,
    chatInFlight: true,
  };
  assert.equal(isSpeakingPhaseBlocked(chatStillOpen), false);
  assert.equal(canExitSpeakingPhaseNow('speaking', chatStillOpen), true);
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

test('idle can enter listening for conversation session', () => {
  assert.equal(canEnterPhase('idle', 'listening'), true);
});

test('sendMessage skip: chat in flight', () => {
  assert.equal(
    getSendMessageSkipReason({
      text: 'hello',
      isProactive: false,
      chatInFlight: true,
      phase: 'thinking',
      fromVoice: true,
      conversationMode: true,
    }),
    'chat_in_flight',
  );
});

test('sendMessage skip: conversation listening allowed', () => {
  assert.equal(
    getSendMessageSkipReason({
      text: 'hello',
      isProactive: false,
      chatInFlight: false,
      phase: 'listening',
      fromVoice: true,
      conversationMode: true,
    }),
    null,
  );
});

test('stale chat in flight when no send timing', () => {
  assert.equal(shouldClearStaleChatInFlight(true, {}, Date.now(), undefined), true);
});

test('stale chat in flight after thinking timeout without stream', () => {
  const now = Date.now();
  const sendAt = now - THINKING_NO_STREAM_MS - 100;
  assert.equal(
    shouldClearStaleChatInFlight(true, {}, now, sendAt),
    true,
  );
});

test('thinking recovery when send never started', () => {
  assert.equal(
    shouldRecoverThinkingNoStream('thinking', THINKING_NO_STREAM_MS, {
      sendStarted: false,
      streamStarted: false,
    }),
    true,
  );
});

test('thinking recovery when stream never started', () => {
  assert.equal(
    shouldRecoverThinkingNoStream('thinking', THINKING_NO_STREAM_MS, {
      sendStarted: true,
      streamStarted: false,
    }),
    true,
  );
});

test('thinking no recovery while stream active under threshold', () => {
  assert.equal(
    shouldRecoverThinkingNoStream('thinking', THINKING_NO_STREAM_MS - 1, {
      sendStarted: true,
      streamStarted: false,
    }),
    false,
  );
});

test('assistant reply started on first token', () => {
  assert.equal(hasAssistantReplyStarted({ first_token: 1 }), true);
  assert.equal(hasAssistantReplyStarted({ stream_start: 1 }), false);
});
