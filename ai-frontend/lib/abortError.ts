/** Abort errors that work in React Native (no DOMException). */

export function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Error;
  return e.name === 'AbortError' || e.message === 'Aborted';
}
