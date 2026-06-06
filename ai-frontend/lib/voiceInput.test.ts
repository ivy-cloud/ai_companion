import assert from 'node:assert/strict';
import {
  isEmptySttError,
  isLikelyAssistantEchoTranscript,
  isSubstantiveTranscript,
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
  assert.equal(isSubstantiveTranscript('um'), false);
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
