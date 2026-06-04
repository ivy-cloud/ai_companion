import {
  playSettledForGeneration,
  shouldAutoRetryTts,
  shouldOfferTapToHear,
} from './ttsTurnGuard.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('playSettledForGeneration matches gen only', () => {
  if (!playSettledForGeneration(3, 3)) throw new Error('expected match');
  if (playSettledForGeneration(3, 4)) throw new Error('expected mismatch');
});

test('shouldAutoRetry when no settle and retry unused', () => {
  if (!shouldAutoRetryTts(-1, 2, 5, -1, 40)) throw new Error('expected retry');
});

test('shouldAutoRetry false when already settled', () => {
  if (shouldAutoRetryTts(2, 2, 5, -1, 40)) throw new Error('expected no retry');
});

test('shouldAutoRetry false when retry already used on turn', () => {
  if (shouldAutoRetryTts(-1, 2, 5, 5, 40)) throw new Error('expected no retry');
});

test('shouldOfferTapToHear after retry exhausted', () => {
  if (!shouldOfferTapToHear(-1, 2, 40, 5, 5)) {
    throw new Error('expected tap hint');
  }
  if (shouldOfferTapToHear(2, 2, 40, 5, 5)) {
    throw new Error('expected no hint when settled');
  }
});
