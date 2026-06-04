import assert from 'node:assert/strict';
import test from 'node:test';

import { formatHealthBanner } from './healthPreflight.ts';

test('formatHealthBanner: unreachable', () => {
  const msg = formatHealthBanner({
    reachable: false,
    status: 'unknown',
    mockUnexpected: false,
    azureTtsReady: null,
    hint: "Can't reach backend",
    devMode: null,
  });
  assert.equal(msg, "Can't reach backend");
});

test('formatHealthBanner: mock unexpected', () => {
  const msg = formatHealthBanner({
    reachable: true,
    status: 'ok',
    mockUnexpected: true,
    azureTtsReady: true,
    hint: null,
    devMode: { mock_llm: true },
  });
  assert.ok(msg?.includes('test mode'));
});
