import assert from 'node:assert/strict';
import {
  DEFAULT_APP_SETTINGS,
  getAppSettings,
  patchAppSettings,
  subscribeAppSettings,
  type AppSettings,
  type VoiceGender,
  type VoiceInputMode,
} from './appSettings.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test('exports default settings shape', () => {
  assert.equal(DEFAULT_APP_SETTINGS.voiceInputMode, 'conversation');
  const settings: AppSettings = getAppSettings();
  assert.equal(typeof settings.voiceEnabled, 'boolean');
  assert.equal(typeof settings.naturalVoiceEnabled, 'boolean');
  assert.ok(settings.voiceGender === 'female' || settings.voiceGender === 'male');
  assert.ok(settings.voiceInputMode === 'ptt' || settings.voiceInputMode === 'conversation');
  assert.equal(typeof settings.playbackVolume, 'number');
  assert.ok(settings.playbackVolume >= 0.8 && settings.playbackVolume <= 1.0);
});

test('patchAppSettings merges partial updates', () => {
  const before = { ...getAppSettings() };
  patchAppSettings({ voiceGender: 'male' satisfies VoiceGender });
  assert.equal(getAppSettings().voiceGender, 'male');
  patchAppSettings({
    voiceInputMode: 'conversation' satisfies VoiceInputMode,
    voiceEnabled: before.voiceEnabled,
    voiceGender: before.voiceGender,
    naturalVoiceEnabled: before.naturalVoiceEnabled,
  });
  assert.equal(getAppSettings().voiceInputMode, 'conversation');
  patchAppSettings({ ...DEFAULT_APP_SETTINGS });
});

test('subscribeAppSettings notifies listeners', () => {
  let count = 0;
  const unsub = subscribeAppSettings(() => {
    count += 1;
  });
  patchAppSettings({ naturalVoiceEnabled: !getAppSettings().naturalVoiceEnabled });
  unsub();
  assert.ok(count >= 1);
  patchAppSettings({ ...DEFAULT_APP_SETTINGS });
});
