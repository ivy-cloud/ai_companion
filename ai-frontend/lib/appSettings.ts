import { useSyncExternalStore } from 'react';

export type VoiceGender = 'female' | 'male';
export type VoiceInputMode = 'ptt' | 'conversation';

export type AppSettings = {
  voiceEnabled: boolean;
  naturalVoiceEnabled: boolean;
  voiceGender: VoiceGender;
  voiceInputMode: VoiceInputMode;
  /** In-app TTS gain (0.8–1.0); expo-av caps at 1.0 — use iPhone side buttons for more. */
  playbackVolume: number;
};

export const PLAYBACK_VOLUME_MIN = 0.8;
export const PLAYBACK_VOLUME_MAX = 1.0;

export function clampPlaybackVolume(value: number): number {
  if (!Number.isFinite(value)) return PLAYBACK_VOLUME_MAX;
  return Math.min(PLAYBACK_VOLUME_MAX, Math.max(PLAYBACK_VOLUME_MIN, value));
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  voiceEnabled: true,
  naturalVoiceEnabled: true,
  voiceGender: 'female',
  voiceInputMode: 'ptt',
  playbackVolume: PLAYBACK_VOLUME_MAX,
};

let settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getAppSettings(): AppSettings {
  return settings;
}

export function patchAppSettings(partial: Partial<AppSettings>): void {
  const next = { ...settings, ...partial };
  if (partial.playbackVolume !== undefined) {
    next.playbackVolume = clampPlaybackVolume(partial.playbackVolume);
  }
  settings = next;
  emit();
}

export function subscribeAppSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
}
