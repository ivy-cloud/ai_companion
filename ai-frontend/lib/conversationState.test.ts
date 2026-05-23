import assert from 'node:assert/strict';
import { canEnterPhase } from './conversationState';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('listening → thinking', () => {
  assert.equal(canEnterPhase('listening', 'thinking'), true);
});

test('thinking → streaming', () => {
  assert.equal(canEnterPhase('thinking', 'streaming'), true);
});

test('streaming → speaking', () => {
  assert.equal(canEnterPhase('streaming', 'speaking'), true);
});

test('speaking → listening', () => {
  assert.equal(canEnterPhase('speaking', 'listening'), true);
});

test('interrupting only via force path', () => {
  assert.equal(canEnterPhase('thinking', 'interrupting'), true);
  assert.equal(canEnterPhase('idle', 'interrupting'), false);
});

test('interrupting → listening', () => {
  assert.equal(canEnterPhase('interrupting', 'listening'), true);
});

test('reject idle → speaking without path', () => {
  assert.equal(canEnterPhase('idle', 'speaking'), true);
});
