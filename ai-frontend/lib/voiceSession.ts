/**
 * Per-turn cancellation tokens — stream, TTS fetch, and stream-TTS drain.
 */

import { logVoiceState } from './conversationState';

export type VoiceSessionSnapshot = {
  turn: number;
  speakGeneration: number;
  streamHandlerGen: number;
  streamTtsDrainGen: number;
};

export function createVoiceSession(): VoiceSessionSnapshot {
  return {
    turn: 0,
    speakGeneration: 0,
    streamHandlerGen: 0,
    streamTtsDrainGen: 0,
  };
}

export function bumpTurn(session: VoiceSessionSnapshot, reason: string): number {
  session.turn += 1;
  session.streamHandlerGen += 1;
  session.streamTtsDrainGen += 1;
  logVoiceState('turn_bump', { turn: session.turn, reason });
  return session.turn;
}

export function bumpSpeakGeneration(session: VoiceSessionSnapshot, reason: string): number {
  session.speakGeneration += 1;
  session.streamTtsDrainGen += 1;
  logVoiceState('speak_generation_bump', {
    generation: session.speakGeneration,
    reason,
  });
  return session.speakGeneration;
}

export function bumpStreamHandlers(session: VoiceSessionSnapshot, reason: string): void {
  session.streamHandlerGen += 1;
  logVoiceState('stream_handler_invalidate', {
    gen: session.streamHandlerGen,
    reason,
  });
}

export function isActiveTurn(session: VoiceSessionSnapshot, turn: number): boolean {
  return turn === session.turn;
}

export function isActiveSpeak(
  session: VoiceSessionSnapshot,
  generation: number,
): boolean {
  return generation === session.speakGeneration;
}

export function isActiveStreamHandler(
  session: VoiceSessionSnapshot,
  handlerGen: number,
): boolean {
  return handlerGen === session.streamHandlerGen;
}

export function isActiveStreamTtsDrain(
  session: VoiceSessionSnapshot,
  drainGen: number,
): boolean {
  return drainGen === session.streamTtsDrainGen;
}

export function nextStreamTtsDrainGen(session: VoiceSessionSnapshot): number {
  session.streamTtsDrainGen += 1;
  return session.streamTtsDrainGen;
}

/** Combine timeout + external abort (interrupt). */
export function mergeAbortSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      onAbort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}
