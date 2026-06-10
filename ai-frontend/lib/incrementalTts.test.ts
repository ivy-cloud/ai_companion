import {
  buildFinalTtsUtterances,
  commitPlayedChunk,
  commitQueuedChunks,
  createIncrementalTtsState,
  pullSpeakableChunks,
  resetIncrementalTtsState,
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
  state.queuedPrefix = state.spokenPrefix;
  if (!streamTtsAlreadyComplete(full, state)) {
    throw new Error('expected complete');
  }
});

test('not complete when only queued ahead of spoken', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.queuedPrefix = 'One. Two. Three.';
  if (streamTtsAlreadyComplete(full, state)) {
    throw new Error('queued alone must not mark stream complete');
  }
  const parts = buildFinalTtsUtterances(full, state, false);
  const joined = parts.join(' ');
  if (!joined.includes('One')) {
    throw new Error(`expected unplayed first sentence, got ${JSON.stringify(parts)}`);
  }
});

test('stream complete when tail already spoken', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two. Three.';
  state.queuedPrefix = 'One. Two. Three.';
  if (!streamTtsAlreadyComplete(full, state)) {
    throw new Error('expected complete when spoken covers full');
  }
  const parts = buildFinalTtsUtterances(full, state, false);
  if (parts.length !== 0) {
    throw new Error(`expected no final parts, got ${JSON.stringify(parts)}`);
  }
});

test('final pass skips duplicate last sentence', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two. Three.';
  state.queuedPrefix = state.spokenPrefix;
  const parts = buildFinalTtsUtterances(full, state, false);
  if (parts.length !== 0) {
    throw new Error(`expected no final parts, got ${JSON.stringify(parts)}`);
  }
});

test('final pass keeps only unseen tail', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two.';
  state.queuedPrefix = state.spokenPrefix;
  if (streamTtsAlreadyComplete(full, state)) {
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
  state.queuedPrefix = 'Not much, just here.';
  const enqueued = new Set([prepareTextForSpeech('Not much, just here.')]);
  const second = pullSpeakableChunks(state, full, true, enqueued);
  const joined = second.join(' ');
  if (!joined.toLowerCase().includes('new with you')) {
    throw new Error(`expected tail sentence, got ${JSON.stringify(second)}`);
  }
});

test('pullSpeakableChunks does not advance prefixes until commit', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  const pulled = pullSpeakableChunks(state, full, false);
  if (state.spokenPrefix !== '' || state.queuedPrefix !== '') {
    throw new Error('prefixes should stay empty until commit');
  }
  commitQueuedChunks(state, pulled);
  if (!state.queuedPrefix.includes('One')) {
    throw new Error('queuedPrefix should advance after enqueue commit');
  }
  if (state.spokenPrefix !== '') {
    throw new Error('spokenPrefix should stay empty until play commit');
  }
  commitPlayedChunk(state, pulled[0]);
  if (!state.spokenPrefix.includes('One')) {
    throw new Error('spokenPrefix should advance after play commit');
  }
});

test('remainder not skipped when first sentence dominates length', () => {
  const full =
    'This is a very long first sentence with many words that takes most of the reply. Hi there.';
  const state = createIncrementalTtsState();
  state.spokenPrefix =
    'This is a very long first sentence with many words that takes most of the reply.';
  state.queuedPrefix = state.spokenPrefix;
  if (streamTtsAlreadyComplete(full, state)) {
    throw new Error('expected tail sentence still needed');
  }
  const parts = buildFinalTtsUtterances(full, state, false);
  const joined = parts.join(' ');
  if (!joined.toLowerCase().includes('hi there')) {
    throw new Error(`expected tail in final pass, got ${JSON.stringify(parts)}`);
  }
});

test('no repeat when stream already spoke closing sentence', () => {
  const full = 'One. Two. Three.';
  const state = createIncrementalTtsState();
  state.spokenPrefix = 'One. Two. Three.';
  state.queuedPrefix = state.spokenPrefix;
  const parts = buildFinalTtsUtterances(full, state, false);
  if (parts.length > 0) {
    throw new Error(`expected empty final pass, got ${JSON.stringify(parts)}`);
  }
  if (!streamTtsAlreadyComplete(full, state)) {
    throw new Error('expected stream complete');
  }
});

test('two-sentence reply re-enqueues first when only queued', () => {
  const full = 'Hello there friend. Hope your day is going well.';
  const state = createIncrementalTtsState();
  state.queuedPrefix = 'Hello there friend.';
  if (streamTtsAlreadyComplete(full, state)) {
    throw new Error('expected not complete with only first sentence queued');
  }
  const parts = buildFinalTtsUtterances(full, state, false);
  const joined = parts.join(' ').toLowerCase();
  if (!joined.includes('hello') && !joined.includes('friend')) {
    throw new Error(`expected first sentence in final pass, got ${JSON.stringify(parts)}`);
  }
});

test('fast ack spoken skips duplicate opening in final pass', () => {
  const full = 'Yeah, that makes sense. Tell me more about it.';
  const state = createIncrementalTtsState();
  commitPlayedChunk(state, 'Yeah,');
  commitQueuedChunks(state, ['Yeah,']);
  const parts = buildFinalTtsUtterances(full, state, false);
  const joined = parts.join(' ').toLowerCase();
  if (joined.startsWith('yeah') || joined === 'yeah,') {
    throw new Error(`final pass should not repeat fast ack, got ${JSON.stringify(parts)}`);
  }
  if (!joined.includes('makes sense') && !joined.includes('tell me more')) {
    throw new Error(`expected main reply tail, got ${JSON.stringify(parts)}`);
  }
});

test('queued-only full reply still needs final TTS pass', () => {
  const full = 'Turn two reply here. With a second sentence.';
  const state = createIncrementalTtsState();
  commitQueuedChunks(state, ['Turn two reply here.', 'With a second sentence.']);
  if (streamTtsAlreadyComplete(full, state)) {
    throw new Error('queued without play must not mark complete');
  }
  const parts = buildFinalTtsUtterances(full, state, false);
  if (parts.length === 0) {
    throw new Error('final pass should enqueue unplayed reply');
  }
});

test('second turn enqueue after prior turn fully spoken', () => {
  const turn1 = 'First reply ends here.';
  const state = createIncrementalTtsState();
  commitPlayedChunk(state, turn1);
  commitQueuedChunks(state, [turn1]);
  if (!streamTtsAlreadyComplete(turn1, state)) {
    throw new Error('turn 1 should be complete');
  }
  resetIncrementalTtsState(state);
  const turn2 = 'Second reply starts now. And continues.';
  const pulled = pullSpeakableChunks(state, turn2, false);
  if (pulled.length === 0 || !pulled[0].toLowerCase().includes('second')) {
    throw new Error(`turn 2 should pull first sentence, got ${JSON.stringify(pulled)}`);
  }
  if (streamTtsAlreadyComplete(turn2, state)) {
    throw new Error('turn 2 must not be complete before any playback');
  }
});
