import assert from 'node:assert/strict';
import {
  IDLE_LISTEN_RECOVERY_MS,
  isOnlyOneRecordingStorm,
  ONLY_ONE_STORM_COOLDOWN_MS,
  ONLY_ONE_STORM_MIN_RETRY_MS,
  recordingStormBackoffDelayMs,
  shouldBlockWatchdogDuringRecordingStorm,
  LISTEN_OPEN_GRACE_MS,
  LISTEN_PAUSED_STUCK_MS,
  LISTEN_RETRY_MS,
  LISTENING_STUCK_MS,
  LISTEN_METER_BLOCKED_MS,
  MAX_LISTEN_SCHEDULE_RETRIES,
  MIC_OPEN_CHAIN_TIMEOUT_MS,
  OPENING_MIC_STUCK_MS,
  OPENING_MIC_WATCHDOG_COOLDOWN_MS,
  CONVERSATION_IDLE_MIC_FORCE_MS,
  WATCHDOG_RECOVERY_COOLDOWN_MS,
  MIN_SPEECH_MS,
  MIN_SPEECH_BEFORE_INTERRUPT_MS,
  INTERRUPT_USER_SPEECH_MS,
  MAX_UTTERANCE_MS,
  COMPANION_INTERRUPT_ACKS,
  pickCompanionInterruptAck,
  shouldCompanionInterruptUser,
  POST_TTS_LISTEN_COOLDOWN_MS,
  PROACTIVE_IDLE_MS,
  PROACTIVE_MAX_PER_SESSION,
  PROACTIVE_MIN_GAP_MS,
  QUIET_VOICE_TIMEOUT_MS,
  SILENCE_END_MS,
  SILENCE_END_PATIENT_MS,
  resolveSilenceEndMs,
  wantsPatientTurnPacing,
  SPEECH_LEVEL_DB,
  shouldSecondChanceQuietListen,
  canResumeConversationListen,
  shouldDeferBargeInForVoiceCommit,
  combineUtteranceTranscripts,
  shouldResetUtteranceBufferOnListenOpen,
  isTransitionRelevancePlace,
  INTERRUPT_CLAUSE_PAUSE_MIN_MS,
  INTERRUPT_CLAUSE_PAUSE_MAX_MS,
  INTERRUPT_WEAK_TRP_PAUSE_MS,
  INTERRUPT_METER_ONLY_PAUSE_MS,
  createConversationMeterState,
  hasIncompleteThoughtEnding,
  SEMANTIC_TURN_EXTENSION_MS,
  isMeterSpeech,
  isSilenceForEndDetection,
  isSpeechLevel,
  shouldForceIdleListeningWithoutRecording,
  shouldRecoverListeningMeterBlocked,
  shouldRecoverListenPausedStuck,
  shouldRecoverOpeningMicStuck,
  nextListenOpenChainStartedAt,
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
  assert.equal(POST_TTS_LISTEN_COOLDOWN_MS, 150);
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

test('onlyOne recording storm detection', () => {
  assert.equal(isOnlyOneRecordingStorm(0, 0), false);
  assert.equal(isOnlyOneRecordingStorm(1, 100), false);
  assert.equal(isOnlyOneRecordingStorm(2, 1000), true);
  assert.equal(isOnlyOneRecordingStorm(3, ONLY_ONE_STORM_COOLDOWN_MS + 1), false);
});

test('recording storm backoff scales with failures', () => {
  assert.equal(recordingStormBackoffDelayMs(0, 0), 0);
  assert.ok(recordingStormBackoffDelayMs(2, 500) >= ONLY_ONE_STORM_MIN_RETRY_MS);
  assert.ok(
    recordingStormBackoffDelayMs(3, 100) >= ONLY_ONE_STORM_COOLDOWN_MS - 100,
  );
});

test('watchdog blocked during recording storm', () => {
  assert.equal(shouldBlockWatchdogDuringRecordingStorm(1, 100), false);
  assert.equal(shouldBlockWatchdogDuringRecordingStorm(2, 1000), true);
  assert.equal(
    shouldBlockWatchdogDuringRecordingStorm(2, ONLY_ONE_STORM_COOLDOWN_MS),
    false,
  );
});

test('listen paused stuck: waits for idle recovery threshold', () => {
  assert.equal(shouldRecoverListenPausedStuck(1000, false), false);
  assert.equal(shouldRecoverListenPausedStuck(IDLE_LISTEN_RECOVERY_MS, false), true);
});

test('listen paused stuck: pending timer defers until stuck threshold', () => {
  assert.equal(shouldRecoverListenPausedStuck(IDLE_LISTEN_RECOVERY_MS, true), false);
  assert.equal(shouldRecoverListenPausedStuck(LISTEN_PAUSED_STUCK_MS, true), true);
});

test('opening mic stuck: uses schedule timestamp not phase clock', () => {
  const now = 10_000;
  assert.equal(shouldRecoverOpeningMicStuck(null, now), false);
  assert.equal(shouldRecoverOpeningMicStuck(now - OPENING_MIC_STUCK_MS + 1, now), false);
  assert.equal(shouldRecoverOpeningMicStuck(now - OPENING_MIC_STUCK_MS, now), true);
});

test('opening mic stuck constants bounded', () => {
  assert.equal(OPENING_MIC_STUCK_MS, 5500);
  assert.ok(MIC_OPEN_CHAIN_TIMEOUT_MS >= OPENING_MIC_STUCK_MS);
  assert.ok(OPENING_MIC_WATCHDOG_COOLDOWN_MS < WATCHDOG_RECOVERY_COOLDOWN_MS);
  assert.ok(CONVERSATION_IDLE_MIC_FORCE_MS <= OPENING_MIC_STUCK_MS);
});

test('listen open chain timestamp preserved across backoff retries', () => {
  const chainStart = 1000;
  assert.equal(nextListenOpenChainStartedAt(null, 5000), 5000);
  assert.equal(nextListenOpenChainStartedAt(chainStart, 9000), chainStart);
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

test('semantic turn extension constant bounded', () => {
  assert.ok(SEMANTIC_TURN_EXTENSION_MS >= 400 && SEMANTIC_TURN_EXTENSION_MS <= 1200);
});

test('patient turn pacing: distress extends silence threshold', () => {
  assert.equal(wantsPatientTurnPacing("I'm really sad today"), true);
  assert.equal(wantsPatientTurnPacing('hey what is up'), false);
  assert.equal(resolveSilenceEndMs("I'm anxious about work"), SILENCE_END_PATIENT_MS);
  assert.equal(resolveSilenceEndMs('quick question'), SILENCE_END_MS);
  assert.ok(SILENCE_END_PATIENT_MS > SILENCE_END_MS);
});

test('incomplete thought: English trailing conjunctions', () => {
  assert.equal(hasIncompleteThoughtEnding('I want to go and'), true);
  assert.equal(hasIncompleteThoughtEnding('Wait, but'), true);
  assert.equal(hasIncompleteThoughtEnding('because'), true);
  assert.equal(hasIncompleteThoughtEnding('so um'), true);
  assert.equal(hasIncompleteThoughtEnding('hello there'), false);
  assert.equal(hasIncompleteThoughtEnding('pizza please'), false);
});

test('incomplete thought: Chinese trailing markers', () => {
  assert.equal(hasIncompleteThoughtEnding('我想去因为'), true);
  assert.equal(hasIncompleteThoughtEnding('好的但是'), true);
  assert.equal(hasIncompleteThoughtEnding('你好'), false);
});

test('combine utterance transcripts joins with space', () => {
  assert.equal(combineUtteranceTranscripts('I want', 'pizza'), 'I want pizza');
  assert.equal(combineUtteranceTranscripts('', 'hello'), 'hello');
  assert.equal(combineUtteranceTranscripts('go and', 'then eat'), 'go and then eat');
});

test('defer barge-in while STT commit in flight', () => {
  assert.equal(shouldDeferBargeInForVoiceCommit(false, true), true);
  assert.equal(shouldDeferBargeInForVoiceCommit(true, false), true);
  assert.equal(shouldDeferBargeInForVoiceCommit(false, false), false);
  assert.equal(shouldDeferBargeInForVoiceCommit(false, false, true), true);
});

test('companion interrupt timing constants bounded', () => {
  assert.ok(INTERRUPT_USER_SPEECH_MS >= 18_000 && INTERRUPT_USER_SPEECH_MS <= 25_000);
  assert.ok(MIN_SPEECH_BEFORE_INTERRUPT_MS >= MIN_SPEECH_MS);
  assert.ok(MAX_UTTERANCE_MS > INTERRUPT_USER_SPEECH_MS);
});

test('shouldCompanionInterruptUser: sustained speech only at TRP pause', () => {
  const sentencePause = INTERRUPT_CLAUSE_PAUSE_MIN_MS;
  const clausePause = INTERRUPT_WEAK_TRP_PAUSE_MS;
  const meterPause = INTERRUPT_METER_ONLY_PAUSE_MS;
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS - 1, null, {
      silenceMs: meterPause,
    }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, null, { silenceMs: sentencePause }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, null, { silenceMs: meterPause }),
    true,
  );
  assert.equal(
    shouldCompanionInterruptUser(MIN_SPEECH_BEFORE_INTERRUPT_MS - 1, null, {
      silenceMs: meterPause,
    }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, 'still talking mid', {
      silenceMs: meterPause,
    }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, 'long story so far,', {
      silenceMs: sentencePause,
    }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, 'long story so far,', {
      silenceMs: clausePause,
    }),
    true,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, 'That was wild.', {
      silenceMs: sentencePause,
    }),
    true,
  );
});

test('shouldCompanionInterruptUser: backend hint lowers threshold', () => {
  const meterPause = INTERRUPT_METER_ONLY_PAUSE_MS;
  assert.equal(
    shouldCompanionInterruptUser(6_999, null, { backendHint: true, silenceMs: meterPause }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(7_000, null, { backendHint: true, silenceMs: meterPause }),
    true,
  );
});

test('shouldCompanionInterruptUser: long live transcript lowers threshold', () => {
  const sentencePause = INTERRUPT_CLAUSE_PAUSE_MIN_MS;
  const clausePause = INTERRUPT_WEAK_TRP_PAUSE_MS;
  const medium = Array.from({ length: 23 }, (_, i) => `word${i}`).join(' ');
  assert.equal(
    shouldCompanionInterruptUser(8_999, `${medium},`, { silenceMs: clausePause }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(9_000, `${medium},`, { silenceMs: clausePause }),
    true,
  );
  const steady = Array.from({ length: 16 }, (_, i) => `word${i}`).join(' ');
  assert.equal(
    shouldCompanionInterruptUser(11_999, `${steady}.`, { silenceMs: sentencePause }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(12_000, `${steady}.`, { silenceMs: sentencePause }),
    true,
  );
  const long = Array.from({ length: 46 }, (_, i) => `word${i}`).join(' ');
  assert.equal(
    shouldCompanionInterruptUser(5_999, `${long}.`, { silenceMs: sentencePause }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(6_000, `${long}.`, { silenceMs: sentencePause }),
    true,
  );
});

test('shouldCompanionInterruptUser: patient pacing blocks interrupt', () => {
  assert.equal(
    shouldCompanionInterruptUser(
      INTERRUPT_USER_SPEECH_MS,
      "I'm really sad today.",
      { silenceMs: INTERRUPT_CLAUSE_PAUSE_MIN_MS },
    ),
    false,
  );
});

test('shouldCompanionInterruptUser: no interrupt during continuous speech', () => {
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, 'still going strong', {
      silenceMs: 0,
    }),
    false,
  );
  assert.equal(
    shouldCompanionInterruptUser(INTERRUPT_USER_SPEECH_MS, 'done now.', {
      silenceMs: SILENCE_END_MS,
    }),
    false,
  );
});

test('transition relevance place detects clause and sentence ends', () => {
  assert.equal(isTransitionRelevancePlace('long story so far,'), true);
  assert.equal(isTransitionRelevancePlace('that is wild.'), true);
  assert.equal(isTransitionRelevancePlace('I want to go and'), false);
  assert.equal(isTransitionRelevancePlace(''), false);
});

test('utterance buffer preserved across semantic extension reopen', () => {
  assert.equal(shouldResetUtteranceBufferOnListenOpen(true), false);
  assert.equal(shouldResetUtteranceBufferOnListenOpen(false), true);
});

test('clause pause window sits below end-of-turn silence', () => {
  assert.ok(INTERRUPT_CLAUSE_PAUSE_MIN_MS >= 200);
  assert.ok(INTERRUPT_CLAUSE_PAUSE_MAX_MS < SILENCE_END_MS);
});

test('companion interrupt ack is stable per speech duration', () => {
  const a = pickCompanionInterruptAck(30_500);
  const b = pickCompanionInterruptAck(30_500);
  assert.equal(a, b);
  assert.ok(COMPANION_INTERRUPT_ACKS.includes(a as (typeof COMPANION_INTERRUPT_ACKS)[number]));
});

test('meter: companionInterrupt fires at clause pause not mid-speech', () => {
  const t0 = 20_000;
  const speechStartedAt = t0 - INTERRUPT_USER_SPEECH_MS;
  let state = {
    ...createConversationMeterState(speechStartedAt),
    sawSpeech: true,
    speechStartedAt,
    silenceSince: null,
    peakMetering: -48,
    lastSpeechAt: t0 - 1,
  };
  const midSpeech = tickConversationMeter(state, -48, t0, {
    allowCompanionInterrupt: true,
  });
  assert.equal(midSpeech.companionInterrupt, false);

  const pauseAt = t0;
  state = {
    ...state,
    silenceSince: pauseAt,
    lastSpeechAt: pauseAt - 1,
  };
  const atTrp = tickConversationMeter(state, -60, pauseAt + INTERRUPT_WEAK_TRP_PAUSE_MS, {
    allowCompanionInterrupt: true,
    liveTranscript: 'long monologue here,',
  });
  assert.equal(atTrp.companionInterrupt, true);
  assert.equal(atTrp.endSilence, false);
  assert.ok(atTrp.speechDurationMs >= INTERRUPT_USER_SPEECH_MS);
});

test('meter: companionInterrupt blocked during distress partial', () => {
  const t0 = 1000;
  const pauseAt = t0 + MIN_SPEECH_MS;
  const state = {
    ...createConversationMeterState(t0),
    sawSpeech: true,
    speechStartedAt: t0,
    silenceSince: pauseAt,
    peakMetering: -48,
    lastSpeechAt: pauseAt - 1,
  };
  const fired = tickConversationMeter(
    state,
    -60,
    pauseAt + INTERRUPT_CLAUSE_PAUSE_MIN_MS,
    {
      allowCompanionInterrupt: true,
      liveTranscript: "I'm anxious about everything.",
    },
  );
  assert.equal(fired.companionInterrupt, false);
});

test('meter: endSilence unchanged for normal pause', () => {
  const t0 = 1000;
  let state = createConversationMeterState(t0);
  state = tickConversationMeter(state, -48, t0 + 100).state;
  state = tickConversationMeter(state, -55, t0 + MIN_SPEECH_MS).state;
  const ready = tickConversationMeter(state, -55, t0 + MIN_SPEECH_MS + SILENCE_END_MS, {
    allowCompanionInterrupt: true,
  });
  assert.equal(ready.endSilence, true);
  assert.equal(ready.companionInterrupt, false);
});
