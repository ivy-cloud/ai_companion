import { appendSpoken, nextSpeakableChunk } from './streamingVoice.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('first chunk at comma clause when long enough', () => {
  const chunk = nextSpeakableChunk('Well I remember that day, and more', '', false);
  if (chunk !== 'Well I remember that day,') {
    throw new Error(`expected clause chunk, got ${chunk}`);
  }
});

test('full sentence after two words', () => {
  const chunk = nextSpeakableChunk('I remember that.', '', false);
  if (chunk !== 'I remember that.') throw new Error(chunk);
});

test('short reply on flush', () => {
  const chunk = nextSpeakableChunk('Sure.', '', true);
  if (chunk !== 'Sure.') throw new Error(chunk);
});

test('append spoken', () => {
  const s = appendSpoken('Hello.', 'How are you?');
  if (s !== 'Hello. How are you?') throw new Error(s);
});
