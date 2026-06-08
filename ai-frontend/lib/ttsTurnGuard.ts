/**
 * Per-turn TTS playback guards — auto-retry and "tap to hear" hints.
 */

/** Wait for natural play_settle before deciding TTS was missed. */
export const TTS_PLAYBACK_SETTLE_WAIT_MS = 3000;

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

/** True when reply text is visible but this generation never play_settled. */
export function shouldLogTtsMissed(
  settledGen: number,
  generation: number,
  replyLen: number,
): boolean {
  if (replyLen <= 0) return false;
  return !playSettledForGeneration(settledGen, generation);
}

/** Poll until play_settle matches generation or timeout. */
export async function waitForPlaySettle(
  checkSettled: () => boolean,
  timeoutMs = TTS_PLAYBACK_SETTLE_WAIT_MS,
  pollMs = 50,
): Promise<boolean> {
  if (checkSettled()) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (checkSettled()) return true;
  }
  return checkSettled();
}
