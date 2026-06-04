/**
 * Per-turn TTS playback guards — auto-retry and "tap to hear" hints.
 */

export function playSettledForGeneration(
  settledGen: number,
  generation: number,
): boolean {
  return settledGen === generation;
}

/** One automatic retry per turn when reply text exists but nothing played. */
export function shouldAutoRetryTts(
  settledGen: number,
  generation: number,
  turn: number,
  retryUsedTurn: number,
  replyLen: number,
): boolean {
  if (replyLen <= 0) return false;
  if (playSettledForGeneration(settledGen, generation)) return false;
  if (retryUsedTurn === turn) return false;
  return true;
}

/** Show tap-to-hear after retry exhausted without playback. */
export function shouldOfferTapToHear(
  settledGen: number,
  generation: number,
  replyLen: number,
  retryUsedTurn: number,
  turn: number,
): boolean {
  if (replyLen <= 0) return false;
  if (playSettledForGeneration(settledGen, generation)) return false;
  return retryUsedTurn === turn;
}
