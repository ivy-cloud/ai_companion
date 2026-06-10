import {
  lastSentenceOf,
  prepareTextForSpeech,
  remainderAfterSpoken,
} from './speechPlayback';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('remainderAfterSpoken returns tail after aligned prefix', () => {
  const full = 'One. Two. Three.';
  const spoken = 'One. Two.';
  const rest = remainderAfterSpoken(full, spoken);
  if (!rest?.includes('Three')) {
    throw new Error(`expected Three, got ${rest}`);
  }
});

test('remainderAfterSpoken recovers after prefix mismatch', () => {
  const full = 'Hello there. How are you doing?';
  const spoken = 'Hello there. How are you doing';
  const rest = remainderAfterSpoken(full, spoken);
  if (!rest || !rest.includes('?')) {
    throw new Error(`expected trailing sentence, got ${rest}`);
  }
});

test('remainderAfterSpoken null when fully spoken', () => {
  const full = 'Sure thing.';
  const spoken = 'Sure thing.';
  if (remainderAfterSpoken(full, spoken) !== null) {
    throw new Error('expected null when fully spoken');
  }
});

test('lastSentenceOf picks closing sentence', () => {
  const last = lastSentenceOf('One. Two. Three.');
  if (last !== 'Three.') {
    throw new Error(`expected Three., got ${last}`);
  }
});

test('prepareTextForSpeech keeps multi-sentence reply', () => {
  const raw = 'First sentence here. Second sentence follows.';
  const cleaned = prepareTextForSpeech(raw);
  if (!cleaned.includes('Second')) {
    throw new Error(`expected both sentences, got ${cleaned}`);
  }
});
