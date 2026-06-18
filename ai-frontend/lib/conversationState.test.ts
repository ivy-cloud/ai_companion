import assert from 'node:assert/strict';
import {
  SPEAKING_STUCK_MS,
  THINKING_NO_STREAM_MS,
  canEnterPhase,
  canExitSpeakingPhaseNow,
  formatSendBlockBanner,
  getInputLockReason,
  getSendMessageSkipReason,
  isValidPostSttSendPhase,
  hasAssistantReplyStarted,
  isOwningStreamTtsDrain,
  isSpeakingPhaseBlocked,
  shouldClearOrphanedStreamTtsDrain,
  shouldClearStaleChatInFlight,
  shouldRecoverStuckSpeakingPhase,
  shouldRecoverThinkingNoStream,
  shouldRecoverStreamingIncomplete,
  shouldRecoverSttProcessingStuck,
  STREAM_INCOMPLETE_MS,
  STT_PROCESSING_STUCK_MS,
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

test('input lock only during recording', () => {
  assert.equal(getInputLockReason('idle'), null);
  assert.equal(getInputLockReason('thinking'), null);
  assert.equal(getInputLockReason('streaming'), null);
  assert.equal(getInputLockReason('speaking'), null);
  assert.equal(getInputLockReason('listening'), null);
  assert.equal(getInputLockReason('recording'), 'recording');
});

test('formatSendBlockBanner includes phase detail', () => {
  const banner = formatSendBlockBanner('chat_in_flight', {
    phase: 'thinking',
    chatInFlight: true,
    voiceSendLock: false,
    fromVoice: false,
  });
  assert.match(banner, /chat_in_flight|processing last turn/);
  assert.match(banner, /phase=thinking/);
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

test('stale chat in flight clears sooner with short threshold', () => {
  const now = Date.now();
  const sendAt = now - 20_500;
  assert.equal(
    shouldClearStaleChatInFlight(true, {}, now, sendAt, 20_000),
    true,
  );
  assert.equal(
    shouldClearStaleChatInFlight(true, {}, now, sendAt, THINKING_NO_STREAM_MS),
    false,
  );
});

test('stale chat in flight after stream_done when finally hung', () => {
  const now = Date.now();
  const sendAt = now - THINKING_NO_STREAM_MS - 100;
  assert.equal(
    shouldClearStaleChatInFlight(
      true,
      { stream_done: sendAt + 1000 },
      now,
      sendAt,
    ),
    true,
  );
  assert.equal(
    shouldClearStaleChatInFlight(
      true,
      { stream_done: sendAt + 1000 },
      now,
      sendAt,
      THINKING_NO_STREAM_MS,
    ),
    true,
  );
});

test('stream_done within threshold keeps chat in flight', () => {
  const now = Date.now();
  const sendAt = now - 5000;
  assert.equal(
    shouldClearStaleChatInFlight(
      true,
      { stream_done: sendAt + 1000 },
      now,
      sendAt,
    ),
    false,
  );
});

test('sendMessage skip: voice send lock', () => {
  assert.equal(
    getSendMessageSkipReason({
      text: 'hello',
      isProactive: false,
      chatInFlight: false,
      voiceSendLock: true,
      phase: 'thinking',
      fromVoice: true,
      conversationMode: true,
    }),
    'voice_send_lock',
  );
});

test('post-STT send accepts listening phase in conversation mode', () => {
  assert.equal(isValidPostSttSendPhase('thinking', true), true);
  assert.equal(isValidPostSttSendPhase('listening', true), true);
  assert.equal(isValidPostSttSendPhase('listening', false), false);
  assert.equal(isValidPostSttSendPhase('speaking', true), false);
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

test('stt processing recovery when voice send lock held', () => {
  assert.equal(
    shouldRecoverSttProcessingStuck(true, STT_PROCESSING_STUCK_MS, {
      sendStarted: false,
    }),
    true,
  );
  assert.equal(
    shouldRecoverSttProcessingStuck(true, STT_PROCESSING_STUCK_MS - 1, {
      sendStarted: false,
    }),
    false,
  );
  assert.equal(
    shouldRecoverSttProcessingStuck(true, STT_PROCESSING_STUCK_MS, {
      sendStarted: true,
    }),
    false,
  );
});

test('streaming recovery when stream_start without stream_done', () => {
  assert.equal(
    shouldRecoverStreamingIncomplete('streaming', STREAM_INCOMPLETE_MS, {
      stream_start: 1,
    }),
    true,
  );
  assert.equal(
    shouldRecoverStreamingIncomplete('streaming', STREAM_INCOMPLETE_MS - 1, {
      stream_start: 1,
    }),
    false,
  );
  assert.equal(
    shouldRecoverStreamingIncomplete('streaming', STREAM_INCOMPLETE_MS, {
      stream_start: 1,
      stream_done: 2,
    }),
    false,
  );
});

test('assistant reply started on first token', () => {
  assert.equal(hasAssistantReplyStarted({ first_token: 1 }), true);
  assert.equal(hasAssistantReplyStarted({ stream_start: 1 }), false);
});

test('owning drain matches active drainGen', () => {
  assert.equal(isOwningStreamTtsDrain(4, 4), true);
  assert.equal(isOwningStreamTtsDrain(4, 3), false);
  assert.equal(isOwningStreamTtsDrain(4, null), false);
});

test('do not clear draining while owner prefetch is in flight', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(2, true, 2, 0, false, false),
    false,
  );
});

test('clear orphaned draining after gen bump', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(5, true, 3, 0, false, false),
    true,
  );
});

test('keep draining while audio is playing', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(1, true, null, 0, false, true),
    false,
  );
});

test('clear orphaned draining when owner ref is null', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(1, true, null, 0, false, false),
    true,
  );
});

test('skip clear when not draining', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(1, false, null, 0, false, false),
    false,
  );
});

test('skip clear while queue still has chunks', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(2, true, 2, 1, false, false),
    false,
  );
});

test('skip clear while speak is in flight', () => {
  assert.equal(
    shouldClearOrphanedStreamTtsDrain(2, true, 2, 0, true, false),
    false,
  );
});
