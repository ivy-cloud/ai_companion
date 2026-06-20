import assert from 'node:assert/strict';
import { withTimeout } from './asyncTimeout.ts';

function test(name: string, fn: () => void | Promise<void>) {
  void Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL ${name}`, err);
      process.exitCode = 1;
    });
}

test('withTimeout resolves before deadline', async () => {
  const value = await withTimeout(Promise.resolve('ok'), 50, 'fast');
  assert.equal(value, 'ok');
});

test('withTimeout rejects when promise hangs', async () => {
  await assert.rejects(
    () =>
      withTimeout(
        new Promise<string>(() => {
          /* never settles */
        }),
        20,
        'hang',
      ),
    /hang timed out after 20ms/,
  );
});
