import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWearablesAudioSource,
  wearablesChatHeaders,
} from './wearablesAdapter.ts';

const ORIGINAL = process.env.EXPO_PUBLIC_WEARABLES_MODE;

function withMode(mode: string | undefined, fn: () => void) {
  if (mode === undefined) {
    delete process.env.EXPO_PUBLIC_WEARABLES_MODE;
  } else {
    process.env.EXPO_PUBLIC_WEARABLES_MODE = mode;
  }
  try {
    fn();
  } finally {
    if (ORIGINAL === undefined) {
      delete process.env.EXPO_PUBLIC_WEARABLES_MODE;
    } else {
      process.env.EXPO_PUBLIC_WEARABLES_MODE = ORIGINAL;
    }
  }
}

test('default mode is phone', () => {
  withMode(undefined, () => {
    const source = getWearablesAudioSource();
    assert.equal(source.mode, 'phone');
    assert.equal(source.audioSourceHeader, 'phone');
    assert.deepEqual(wearablesChatHeaders(), {});
  });
});

test('meta-stub sends X-Audio-Source header', () => {
  withMode('meta-stub', () => {
    const source = getWearablesAudioSource();
    assert.equal(source.mode, 'meta-stub');
    assert.equal(source.audioSourceHeader, 'meta-glasses');
    assert.deepEqual(wearablesChatHeaders(), {
      'X-Audio-Source': 'meta-glasses',
    });
  });
});

test('meta-glasses alias resolves to meta-stub', () => {
  withMode('meta-glasses', () => {
    assert.equal(getWearablesAudioSource().mode, 'meta-stub');
  });
});
