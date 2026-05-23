import { normalizeForSpeech } from './spokenNormalize';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('year becomes words', () => {
  const out = normalizeForSpeech('I was born in 1998.');
  if (!out.includes('nineteen') || out.includes('1998')) {
    throw new Error(out);
  }
});

test('multi-digit age becomes words', () => {
  const out = normalizeForSpeech('I am 42 years old.');
  if (!out.includes('forty-two') && !out.includes('forty two')) {
    throw new Error(out);
  }
  if (/\b42\b/.test(out)) throw new Error(out);
});

test('math becomes words', () => {
  const out = normalizeForSpeech('2 + 2 = 4');
  if (!out.includes('plus') || !out.includes('is four')) {
    throw new Error(out);
  }
});
