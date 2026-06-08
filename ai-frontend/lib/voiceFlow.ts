/**
 * Voice I/O labels and hints.
 * State machine rules live in conversationState.ts.
 */

import type { VoicePhase } from './conversationState';

export type { VoicePhase };

export function voicePhaseLabel(
  phase: VoicePhase,
  _isStreaming = false,
  conversationSession = false,
  options?: { proactive?: boolean; companionName?: string },
): string {
  if (
    options?.proactive &&
    conversationSession &&
    (phase === 'thinking' || phase === 'streaming')
  ) {
    const name = options.companionName?.trim() || 'Companion';
    return `${name} is thinking aloud…`;
  }
  switch (phase) {
    case 'listening':
      return 'Listening…';
    case 'recording':
      return 'Recording';
    case 'thinking':
      return conversationSession ? 'Thinking…' : 'Processing';
    case 'streaming':
      return conversationSession ? 'Thinking…' : 'Generating';
    case 'speaking':
      return 'Speaking';
    case 'interrupting':
      return 'Stopping…';
    default:
      return conversationSession ? 'Listening paused' : 'Ready';
  }
}

export function voicePhaseHint(
  phase: VoicePhase,
  isStreaming = false,
  conversationSession = false,
): string {
  switch (phase) {
    case 'listening':
      return 'Speak naturally · pause ~1s or tap Done speaking';
    case 'recording':
      return 'Hold mic and speak…';
    case 'thinking':
      if (conversationSession) {
        return 'Thinking… tap Mic to interrupt';
      }
      return 'Processing your message…';
    case 'streaming':
      if (conversationSession) {
        return 'Reply streaming… tap Mic to interrupt';
      }
      return isStreaming
        ? 'Companion is replying…'
        : 'Processing your message…';
    case 'speaking':
      if (conversationSession) {
        return 'Speaking… tap Mic to interrupt';
      }
      return 'Speaking… tap to stop';
    case 'interrupting':
      return 'Interrupting…';
    default:
      return conversationSession
        ? 'Conversation active · tap Mic (Listen) to resume'
        : 'Hold Mic to talk · or type below';
  }
}

export { canEnterPhase, isAssistantActivePhase } from './conversationState';
