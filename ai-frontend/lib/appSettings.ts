import { useSyncExternalStore } from 'react';

export type VoiceGender = 'female' | 'male';
export type VoiceInputMode = 'ptt' | 'conversation';

export type AppSettings = {
  voiceEnabled: boolean;
  naturalVoiceEnabled: boolean;
  voiceGender: VoiceGender;
  voiceInputMode: VoiceInputMode;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  voiceEnabled: true,
  naturalVoiceEnabled: true,
  voiceGender: 'female',
  voiceInputMode: 'ptt',
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
  settings = { ...settings, ...partial };
  emit();
}

export function subscribeAppSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribeAppSettings, getAppSettings, getAppSettings);
}
