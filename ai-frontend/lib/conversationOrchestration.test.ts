import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldStreamTtsWhileOpen } from './conversationOrchestration';

test('shouldStreamTtsWhileOpen: disabled in conversation mode', () => {
  assert.equal(
    shouldStreamTtsWhileOpen(true, true, { stream_tts: true }, { conversationMode: true }),
    false,
  );
  assert.equal(
    shouldStreamTtsWhileOpen(true, true, { stream_tts: true }, { conversationMode: false }),
    true,
  );
});
