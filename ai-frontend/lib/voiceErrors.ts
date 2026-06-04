/** Short, user-facing voice error copy (conversation + push-to-talk). */

export function formatVoiceInputError(raw: string, onlyOneRecorder?: boolean): string {
  if (onlyOneRecorder) {
    return 'Microphone busy — wait a moment, then tap Listen on Mic.';
  }
  const lower = raw.toLowerCase();
  if (lower.includes('permission') || lower.includes('microphone access')) {
    return 'Microphone access is required to talk.';
  }
  if (raw.length > 140) {
    return `${raw.slice(0, 137)}…`;
  }
  return raw;
}

export function formatVoicePlaybackError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('timeout') ||
    lower.includes('empty') ||
    lower.includes('invalid audio') ||
    lower.includes('no audio')
  ) {
    return 'No audio heard — tap above to hear.';
  }
  if (lower.includes('tts failed') || lower.includes('azure')) {
    return 'Voice playback failed — tap above to hear.';
  }
  if (raw.length > 140) {
    return `${raw.slice(0, 137)}…`;
  }
  return raw;
}
