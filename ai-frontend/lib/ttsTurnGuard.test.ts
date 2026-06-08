import {
  playSettledForGeneration,
  shouldAutoRetryTts,
  shouldLogTtsMissed,
  shouldOfferTapToHear,
  waitForPlaySettle,
} from './ttsTurnGuard.ts';

function test(name: string, fn: () => void | Promise<void>) {
  void (async () => {
    try {
      await fn();
      console.log(`ok ${name}`);
    } catch (e) {
      console.error(`FAIL ${name}`, e);
      process.exitCode = 1;
    }
  })();
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

test('shouldLogTtsMissed when reply exists and not settled', () => {
  if (!shouldLogTtsMissed(-1, 2, 40)) throw new Error('expected missed');
  if (shouldLogTtsMissed(2, 2, 40)) throw new Error('expected not missed');
  if (shouldLogTtsMissed(-1, 2, 0)) throw new Error('expected no missed for empty');
});

test('waitForPlaySettle resolves when check becomes true', async () => {
  let settled = false;
  setTimeout(() => {
    settled = true;
  }, 30);
  const ok = await waitForPlaySettle(() => settled, 200, 10);
  if (!ok) throw new Error('expected settled');
});

test('waitForPlaySettle times out when never settled', async () => {
  const ok = await waitForPlaySettle(() => false, 80, 20);
  if (ok) throw new Error('expected timeout');
});
