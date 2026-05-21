/**
 * Voice I/O state machine: idle → recording → processing → speaking → idle
 */

export type VoicePhase = 'idle' | 'recording' | 'processing' | 'speaking';

export function voicePhaseLabel(phase: VoicePhase): string {
  switch (phase) {
    case 'recording':
      return 'Recording';
    case 'processing':
      return 'Processing';
    case 'speaking':
      return 'Speaking';
    default:
      return 'Ready';
  }
}

export function voicePhaseHint(phase: VoicePhase): string {
  switch (phase) {
    case 'recording':
      return 'Hold mic and speak…';
    case 'processing':
      return 'Processing your message…';
    case 'speaking':
      return 'Speaking… tap to stop';
    default:
      return 'Hold Mic to talk · or type below';
  }
}

/** Legal transitions for the voice state machine. */
export function canEnterPhase(from: VoicePhase, to: VoicePhase): boolean {
  if (from === to) return true;
  switch (from) {
    case 'idle':
      return to === 'recording' || to === 'speaking';
    case 'recording':
      return to === 'processing';
    case 'processing':
      return to === 'speaking' || to === 'idle';
    case 'speaking':
      return to === 'idle';
    default:
      return false;
  }
}
