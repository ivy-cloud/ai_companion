import assert from 'node:assert/strict';
import {
  IDLE_LISTEN_RECOVERY_MS,
  LISTEN_OPEN_GRACE_MS,
  LISTEN_PAUSED_STUCK_MS,
  LISTEN_RETRY_MS,
  LISTENING_STUCK_MS,
  MAX_LISTEN_SCHEDULE_RETRIES,
  POST_TTS_LISTEN_COOLDOWN_MS,
  canResumeConversationListen,
  shouldForceIdleListeningWithoutRecording,
  shouldRecoverListenPausedStuck,
} from './conversationMode.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('resume: listening without recording can restart', () => {
  assert.equal(canResumeConversationListen('listening', false, true), true);
});

test('resume: listening with recording is no-op', () => {
  assert.equal(canResumeConversationListen('listening', true, true), false);
});

test('resume: idle always allowed', () => {
  assert.equal(canResumeConversationListen('idle', false, true), true);
});

test('resume: thinking allowed after interrupt path', () => {
  assert.equal(canResumeConversationListen('thinking', false, true), true);
});

test('fresh listen: only idle or speaking', () => {
  assert.equal(canResumeConversationListen('idle', false, false), true);
  assert.equal(canResumeConversationListen('listening', false, false), false);
});

test('phase0: listen timing constants stay bounded', () => {
  assert.equal(POST_TTS_LISTEN_COOLDOWN_MS, 700);
  assert.equal(LISTEN_RETRY_MS, 280);
  assert.equal(LISTENING_STUCK_MS, 6500);
  assert.equal(LISTEN_OPEN_GRACE_MS, 1400);
  assert.equal(IDLE_LISTEN_RECOVERY_MS, 2800);
});

test('listen open grace: no force-idle while mic is still opening', () => {
  assert.equal(shouldForceIdleListeningWithoutRecording(500, false), false);
  assert.equal(shouldForceIdleListeningWithoutRecording(LISTEN_OPEN_GRACE_MS, false), true);
});

test('listen open grace: recording present is never forced idle', () => {
  assert.equal(shouldForceIdleListeningWithoutRecording(10_000, true), false);
});

test('listen paused stuck: waits for idle recovery threshold', () => {
  assert.equal(shouldRecoverListenPausedStuck(1000, false), false);
  assert.equal(shouldRecoverListenPausedStuck(IDLE_LISTEN_RECOVERY_MS, false), true);
});

test('listen paused stuck: pending timer defers until stuck threshold', () => {
  assert.equal(shouldRecoverListenPausedStuck(IDLE_LISTEN_RECOVERY_MS, true), false);
  assert.equal(shouldRecoverListenPausedStuck(LISTEN_PAUSED_STUCK_MS, true), true);
});

test('phase0: listen paused stuck constant after idle recovery', () => {
  assert.ok(LISTEN_PAUSED_STUCK_MS > IDLE_LISTEN_RECOVERY_MS);
});

test('listen retry cap is bounded', () => {
  assert.ok(MAX_LISTEN_SCHEDULE_RETRIES >= 20);
  assert.ok(MAX_LISTEN_SCHEDULE_RETRIES <= 120);
});
