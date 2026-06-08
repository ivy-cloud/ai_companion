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

test('formatHealthBanner: azure not ready', () => {
  const msg = formatHealthBanner({
    reachable: true,
    status: 'ok',
    mockUnexpected: false,
    azureTtsReady: false,
    hint: null,
    devMode: null,
  });
  assert.ok(msg?.includes('Azure speech'));
});

test('formatHealthBanner: healthy returns null', () => {
  const msg = formatHealthBanner({
    reachable: true,
    status: 'ok',
    mockUnexpected: false,
    azureTtsReady: true,
    hint: null,
    devMode: null,
  });
  assert.equal(msg, null);
});

test('formatHealthBanner: degraded uses hint', () => {
  const msg = formatHealthBanner({
    reachable: true,
    status: 'degraded',
    mockUnexpected: false,
    azureTtsReady: null,
    hint: 'Start Ollama: ollama serve',
    devMode: null,
  });
  assert.equal(msg, 'Start Ollama: ollama serve');
});
