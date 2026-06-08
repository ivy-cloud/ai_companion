import {
  buildFinalTtsUtterances,
  commitIncrementalChunks,
  createIncrementalTtsState,
  pullSpeakableChunks,
  streamTtsAlreadyComplete,
} from './incrementalTts';
import { prepareTextForSpeech } from './speechPlayback';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('stream complete when last sentence already spoken', () => {
  const full = 'Hello there. I am doing well. Thanks for asking.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'Hello there. I am doing well. Thanks for asking.';
  if (!streamTtsAlreadyComplete(full, state.spokenPrefix)) {
    throw new Error('expected complete');
  }
});

test('final pass skips duplicate last sentence', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two. Three.';
  const parts = buildFinalTtsUtterances(full, state, false);
  if (parts.length !== 0) {
    throw new Error(`expected no final parts, got ${JSON.stringify(parts)}`);
  }
});

test('final pass keeps only unseen tail', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two.';
  if (streamTtsAlreadyComplete(full, state.spokenPrefix)) {
    throw new Error('expected not complete');
  }
  const parts = buildFinalTtsUtterances(full, state, false);
  const joined = parts.join(' ');
  if (!joined.includes('Three')) {
    throw new Error(`expected Three in ${joined}`);
  }
});

test('flush reaches last sentence when first was only partial', () => {
  const full = 'Not much, just here. What is new with you?';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'Not much, just here.';
  const enqueued = new Set([prepareTextForSpeech('Not much, just here.')]);
  const second = pullSpeakableChunks(state, full, true, enqueued);
  const joined = second.join(' ');
  if (!joined.toLowerCase().includes('new with you')) {
    throw new Error(`expected tail sentence, got ${JSON.stringify(second)}`);
  }
});

test('pullSpeakableChunks does not advance spokenPrefix until commit', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  const pulled = pullSpeakableChunks(state, full, false);
  if (state.spokenPrefix !== '') {
    throw new Error('spokenPrefix should stay empty until commit');
  }
  commitIncrementalChunks(state, pulled);
  if (!state.spokenPrefix.includes('One')) {
    throw new Error('spokenPrefix should advance after commit');
  }
});

test('no repeat when stream already spoke closing sentence', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two. Three.';
  const parts = buildFinalTtsUtterances(full, state, false);
  if (parts.length > 0) {
    throw new Error(`expected empty final pass, got ${JSON.stringify(parts)}`);
  }
  if (!streamTtsAlreadyComplete(full, state.spokenPrefix)) {
    throw new Error('expected stream complete');
  }
});
