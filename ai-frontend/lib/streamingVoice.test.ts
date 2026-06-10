import { appendSpoken, nextSpeakableChunk } from './streamingVoice.ts';
import { prepareTextForSpeech, remainderAfterSpoken } from './speechPlayback';

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

test('flush speaks unpunctuated tail after first sentence', () => {
  const stream = 'First sentence here. Second sentence now';
  const chunk = nextSpeakableChunk(stream, 'First sentence here.', true);
  if (!chunk?.toLowerCase().includes('second')) {
    throw new Error(`expected second sentence on flush, got ${chunk}`);
  }
});

test('second sentence pulled after first queued', () => {
  const stream = 'Alpha one. Beta two.';
  const first = nextSpeakableChunk(stream, '', false);
  if (first !== 'Alpha one.') throw new Error(`unexpected first: ${first}`);
  const second = nextSpeakableChunk(stream, appendSpoken('', first!), false);
  if (second !== 'Beta two.') throw new Error(`unexpected second: ${second}`);
});

test('second sentence after long first on flush', () => {
  const full =
    'This is a very long first sentence with many words that takes most of the reply. Hi there.';
  const first = nextSpeakableChunk(full, '', false);
  if (!first?.includes('very long first sentence')) {
    throw new Error(`expected first sentence, got ${first}`);
  }
  const spoken = appendSpoken('', first);
  const second = nextSpeakableChunk(full, spoken, true);
  if (!second?.toLowerCase().includes('hi there')) {
    throw new Error(`expected tail on flush, got ${second}`);
  }
});

test('remainder after spoken finds tail sentence', () => {
  const full =
    'This is a very long first sentence with many words that takes most of the reply. Hi there.';
  const first = nextSpeakableChunk(full, '', false) ?? '';
  const rest = remainderAfterSpoken(full, first);
  if (!rest?.toLowerCase().includes('hi there')) {
    throw new Error(`expected tail remainder, got ${rest}`);
  }
});

test('single prepared line covers both sentences', () => {
  const full = 'First sentence here. Second sentence follows.';
  const line = prepareTextForSpeech(full);
  if (!line.includes('First') || !line.includes('Second')) {
    throw new Error(`expected both sentences in one line, got ${line}`);
  }
});
