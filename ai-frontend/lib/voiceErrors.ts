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
    lower.includes('silent mode') ||
    lower.includes('volume') ||
    lower.includes('muted') ||
    lower.includes('audio session')
  ) {
    return 'No sound — raise volume and turn off silent mode, then tap above.';
  }
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('subscription-key') ||
    lower.includes('ocp-apim')
  ) {
    return 'Voice auth failed — fix AZURE_SPEECH_KEY in ai-backend/.env (Azure Portal → Speech → Keys).';
  }
  if (
    lower.includes('timeout') ||
    lower.includes('empty') ||
    lower.includes('invalid audio') ||
    lower.includes('no audio') ||
    lower.includes('playback') && lower.includes('fail')
  ) {
    return 'No audio heard — raise volume, silent switch off, tap above to hear.';
  }
  if (lower.includes('tts failed') || lower.includes('azure')) {
    return 'Voice playback failed — check Wi‑Fi and tap above to hear.';
  }
  if (raw.length > 140) {
    return `${raw.slice(0, 137)}…`;
  }
  return raw;
}
