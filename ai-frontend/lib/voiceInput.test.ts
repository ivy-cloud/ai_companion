import assert from 'node:assert/strict';
import {
  isEmptySttError,
  isHelloSizedUtterance,
  isLikelyAssistantEchoTranscript,
  isSubstantiveTranscript,
  SHORT_UTTERANCE_NO_RESPONSE_MS,
  turnNoResponseTimeoutMs,
} from './voiceTranscript.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('isEmptySttError detects no-speech failures', () => {
  assert.equal(isEmptySttError(new Error('No speech detected')), true);
  assert.equal(isEmptySttError(new Error('no speech detected — try again')), true);
  assert.equal(isEmptySttError(new Error('Network failed')), false);
});

test('isSubstantiveTranscript accepts short valid words', () => {
  assert.equal(isSubstantiveTranscript('why'), true);
  assert.equal(isSubstantiveTranscript('hello'), true);
  assert.equal(isSubstantiveTranscript('um'), false);
});

test('isHelloSizedUtterance matches greetings', () => {
  assert.equal(isHelloSizedUtterance('hello'), true);
  assert.equal(isHelloSizedUtterance('Hello!'), true);
  assert.equal(isHelloSizedUtterance('tell me more'), false);
});

test('turnNoResponseTimeoutMs is 20s for hello-sized text', () => {
  assert.equal(turnNoResponseTimeoutMs('hello'), SHORT_UTTERANCE_NO_RESPONSE_MS);
  assert.equal(turnNoResponseTimeoutMs('hello', 45_000), SHORT_UTTERANCE_NO_RESPONSE_MS);
  assert.equal(turnNoResponseTimeoutMs('explain my sleep in detail'), 45_000);
});

test('echo: skipped when playback is not active', () => {
  assert.equal(
    isLikelyAssistantEchoTranscript('tell me about your day today', 'Tell me about your day today.', {
      playbackActive: false,
    }),
    false,
  );
});

test('echo: matches assistant tail only during playback', () => {
  const assistant =
    'I had a quiet morning. Would you like to hear about your sleep last night?';
  assert.equal(
    isLikelyAssistantEchoTranscript(
      'would you like to hear about your sleep',
      assistant,
      {
        playbackActive: true,
        lastSentence: (t) => t.split('.').pop()?.trim() ?? '',
      },
    ),
    true,
  );
});

test('echo: user speech after TTS is not suppressed', () => {
  assert.equal(
    isLikelyAssistantEchoTranscript(
      'would you like to hear about your sleep',
      'Would you like to hear about your sleep last night?',
      { playbackActive: false },
    ),
    false,
  );
});
