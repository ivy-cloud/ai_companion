import assert from 'node:assert/strict';
import {
  IDLE_LISTEN_RECOVERY_MS,
  LISTEN_OPEN_GRACE_MS,
  LISTEN_PAUSED_STUCK_MS,
  LISTEN_RETRY_MS,
  LISTENING_STUCK_MS,
  LISTEN_METER_BLOCKED_MS,
  MAX_LISTEN_SCHEDULE_RETRIES,
  MIN_SPEECH_MS,
  POST_TTS_LISTEN_COOLDOWN_MS,
  PROACTIVE_IDLE_MS,
  PROACTIVE_MAX_PER_SESSION,
  PROACTIVE_MIN_GAP_MS,
  QUIET_VOICE_TIMEOUT_MS,
  SILENCE_END_MS,
  SPEECH_LEVEL_DB,
  shouldSecondChanceQuietListen,
  canResumeConversationListen,
  createConversationMeterState,
  isMeterSpeech,
  isSilenceForEndDetection,
  isSpeechLevel,
  shouldForceIdleListeningWithoutRecording,
  shouldRecoverListeningMeterBlocked,
  shouldRecoverListenPausedStuck,
  tickConversationMeter,
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
  assert.equal(POST_TTS_LISTEN_COOLDOWN_MS, 280);
  assert.equal(LISTEN_RETRY_MS, 180);
  assert.equal(LISTENING_STUCK_MS, 6500);
  assert.equal(LISTEN_OPEN_GRACE_MS, 800);
  assert.equal(IDLE_LISTEN_RECOVERY_MS, 2800);
});

test('speech level: quiet speech above threshold registers', () => {
  assert.equal(SPEECH_LEVEL_DB, -60);
  assert.equal(isSpeechLevel(-59), true);
  assert.equal(isSpeechLevel(-60), false);
  assert.equal(isSpeechLevel(-50), true);
});

test('meter speech: quieter levels still count as sawSpeech', () => {
  assert.equal(isMeterSpeech(-65), true);
  assert.equal(isMeterSpeech(-73), true);
  assert.equal(isMeterSpeech(-75), false);
});

test('endSilence fires for quiet speech visible on dB bar (-72 peak)', () => {
  const t0 = 1000;
  let state = createConversationMeterState(t0);
  state = tickConversationMeter(state, -72, t0 + 100).state;
  assert.equal(state.sawSpeech, true);
  state = tickConversationMeter(state, -76, t0 + MIN_SPEECH_MS).state;
  const ready = tickConversationMeter(state, -76, t0 + MIN_SPEECH_MS + SILENCE_END_MS);
  assert.equal(ready.endSilence, true);
});

test('silence for end: drop from peak counts as trailing silence', () => {
  assert.equal(isSilenceForEndDetection(-55, -48), true);
  assert.equal(isSilenceForEndDetection(-48, -48), false);
  assert.equal(isSilenceForEndDetection(-70, -48), true);
});

test('endSilence fires when room noise stays above speech threshold after user stops', () => {
  const t0 = 1000;
  let state = createConversationMeterState(t0);
  state = tickConversationMeter(state, -48, t0 + 100).state;
  assert.equal(state.sawSpeech, true);
  state = tickConversationMeter(state, -55, t0 + MIN_SPEECH_MS).state;
  const ready = tickConversationMeter(state, -55, t0 + MIN_SPEECH_MS + SILENCE_END_MS);
  assert.equal(ready.endSilence, true);
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

test('listen meter blocked recovery threshold', () => {
  assert.equal(LISTEN_METER_BLOCKED_MS, 2200);
  assert.equal(shouldRecoverListeningMeterBlocked(1000, true), false);
  assert.equal(shouldRecoverListeningMeterBlocked(LISTEN_METER_BLOCKED_MS, true), true);
  assert.equal(shouldRecoverListeningMeterBlocked(10_000, false), false);
});

test('silence timing: endSilence needs MIN_SPEECH_MS + SILENCE_END_MS', () => {
  assert.equal(SILENCE_END_MS, 1000);
  assert.equal(MIN_SPEECH_MS, 350);
  const t0 = 1000;
  let state = createConversationMeterState(t0);
  state = {
    ...state,
    sawSpeech: true,
    speechStartedAt: t0,
    silenceSince: t0 + MIN_SPEECH_MS,
    lastSpeechAt: t0 + MIN_SPEECH_MS - 1,
  };
  const tooEarly = tickConversationMeter(state, -60, t0 + MIN_SPEECH_MS + SILENCE_END_MS - 1);
  assert.equal(tooEarly.endSilence, false);
  const ready = tickConversationMeter(state, -60, t0 + MIN_SPEECH_MS + SILENCE_END_MS);
  assert.equal(ready.endSilence, true);
  assert.ok(ready.speechDurationMs >= MIN_SPEECH_MS);
  assert.ok(ready.silenceDurationMs >= SILENCE_END_MS);
});

test('quiet voice timeout fires once after 5s with no speech', () => {
  assert.equal(QUIET_VOICE_TIMEOUT_MS, 5000);
  const t0 = 1000;
  const state = createConversationMeterState(t0);
  const before = tickConversationMeter(state, -60, t0 + QUIET_VOICE_TIMEOUT_MS - 1);
  assert.equal(before.quietVoiceTimeout, false);
  const at = tickConversationMeter(state, -60, t0 + QUIET_VOICE_TIMEOUT_MS);
  assert.equal(at.quietVoiceTimeout, true);
  const again = tickConversationMeter(at.state, -60, t0 + QUIET_VOICE_TIMEOUT_MS + 1000);
  assert.equal(again.quietVoiceTimeout, false);
});

test('second-chance quiet listen when STT empty but meter saw quiet speech', () => {
  assert.equal(
    shouldSecondChanceQuietListen({
      sawSpeech: true,
      peakMetering: -52,
      speechDurationMs: MIN_SPEECH_MS,
    }),
    true,
  );
  assert.equal(
    shouldSecondChanceQuietListen({
      sawSpeech: true,
      peakMetering: -48,
      speechDurationMs: MIN_SPEECH_MS,
    }),
    false,
  );
  assert.equal(
    shouldSecondChanceQuietListen({
      sawSpeech: false,
      peakMetering: -52,
      speechDurationMs: MIN_SPEECH_MS,
    }),
    false,
  );
});

test('proactive timing constants bounded', () => {
  assert.ok(PROACTIVE_IDLE_MS >= 8000 && PROACTIVE_IDLE_MS <= 12_000);
  assert.equal(PROACTIVE_MIN_GAP_MS, 20_000);
  assert.equal(PROACTIVE_MAX_PER_SESSION, 3);
});
