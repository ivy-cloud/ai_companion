/**
 * Voice I/O state machine:
 * Push-to-talk: idle → recording → processing → speaking → idle
 * Conversation: idle → listening → processing → speaking → listening (loop)
 */

export type VoicePhase =
  | 'idle'
  | 'recording'
  | 'listening'
  | 'processing'
  | 'speaking';

export function voicePhaseLabel(
  phase: VoicePhase,
  isStreaming = false,
  conversationSession = false,
): string {
  if (phase === 'processing' && isStreaming) {
    return conversationSession ? 'Thinking…' : 'Generating';
  }
  switch (phase) {
    case 'listening':
      return 'Listening…';
    case 'recording':
      return 'Recording';
    case 'processing':
      return conversationSession ? 'Thinking…' : 'Processing';
    case 'speaking':
      return 'Speaking';
    default:
      return conversationSession ? 'Tap Mic to start' : 'Ready';
  }
}

export function voicePhaseHint(
  phase: VoicePhase,
  isStreaming = false,
  conversationSession = false,
): string {
  switch (phase) {
    case 'listening':
      return 'Speak naturally — pauses auto-send';
    case 'recording':
      return 'Hold mic and speak…';
    case 'processing':
      if (conversationSession) {
        return 'Thinking… tap Mic to interrupt';
      }
      return isStreaming
        ? 'Companion is replying…'
        : 'Processing your message…';
    case 'speaking':
      if (conversationSession) {
        return 'Speaking… say something or tap Mic to interrupt';
      }
      return isStreaming
        ? 'Speaking while reply streams…'
        : 'Speaking… tap to stop';
    default:
      return conversationSession
        ? 'Conversation active · tap Mic to stop'
        : 'Hold Mic to talk · or type below';
  }
}

/** Legal transitions for the voice state machine. */
export function canEnterPhase(from: VoicePhase, to: VoicePhase): boolean {
  if (from === to) return true;
  switch (from) {
    case 'idle':
      return (
        to === 'recording' ||
        to === 'listening' ||
        to === 'processing' ||
        to === 'speaking'
      );
    case 'recording':
      return to === 'processing' || to === 'idle';
    case 'listening':
      return to === 'processing' || to === 'idle';
    case 'processing':
      return to === 'speaking' || to === 'idle' || to === 'listening';
    case 'speaking':
      return to === 'idle' || to === 'listening';
    default:
      return false;
  }
}
