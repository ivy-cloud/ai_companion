/** Lets Settings (or other screens) hard-reset the chat voice state machine. */
let resetHandler: ((reason: string) => void) | null = null;

export function registerConversationReset(handler: (reason: string) => void): () => void {
  resetHandler = handler;
  return () => {
    if (resetHandler === handler) resetHandler = null;
  };
}

export function requestConversationReset(reason = 'settings_reset'): void {
  resetHandler?.(reason);
}
