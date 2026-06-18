import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { isEmptySttError } from './voiceTranscript';

export {
  isEmptySttError,
  isLikelyAssistantEchoTranscript,
  isSubstantiveTranscript,
  turnNoResponseTimeoutMs,
} from './voiceTranscript';

/** Loud TTS: Playback category on iOS (speaker), not PlayAndRecord/earpiece. */
const PLAYBACK_AUDIO_MODE = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  staysActiveInBackground: false,
  interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  shouldDuckAndroid: false,
  playThroughEarpieceAndroid: false,
} as const;

/** Keep session on speaker while a clip plays; no ducking. */
const TTS_PLAYBACK_AUDIO_MODE = {
  ...PLAYBACK_AUDIO_MODE,
  staysActiveInBackground: true,
  shouldDuckAndroid: false,
} as const;

/** 16 kHz mono WAV — works well with Azure Speech REST. */
export const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

let prewarmRecording: Audio.Recording | null = null;
let prewarmPromise: Promise<void> | null = null;
let recordingMutex: Promise<void> = Promise.resolve();

/** Serialize prepare/start so Expo never has two Recording objects prepared at once. */
export async function withRecordingMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = recordingMutex.then(fn, fn);
  recordingMutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function safeUnloadRecording(
  recording: Audio.Recording | null | undefined,
): Promise<void> {
  if (!recording) return;
  try {
    await recording.stopAndUnloadAsync();
  } catch {
    // Already stopped/unloaded.
  }
}

export async function configurePlaybackAudioMode() {
  await Audio.setAudioModeAsync(PLAYBACK_AUDIO_MODE);
}

/** Speaker-oriented mode for active TTS — keeps session alive, no mic/earpiece routing. */
export async function configureTtsPlaybackAudioMode() {
  await Audio.setAudioModeAsync(TTS_PLAYBACK_AUDIO_MODE);
}

/**
 * Release mic/recorder session and switch to speaker-oriented playback before TTS.
 * Prewarm and PlayAndRecord (barge-in) otherwise route iOS audio to the earpiece.
 * expo-av has no defaultToSpeaker — only allowsRecordingIOS:false (Playback category).
 */
export async function prepareForTtsPlayback(): Promise<void> {
  await discardPrewarm();
  await configureTtsPlaybackAudioMode();
}

/** expo-av caps player gain at 1.0; device volume buttons set system level. */
export async function applyTtsSoundGain(
  sound: Audio.Sound,
  volume: number,
): Promise<void> {
  await sound.setIsMutedAsync(false);
  await sound.setVolumeAsync(volume);
}

export async function configureRecordingAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    staysActiveInBackground: false,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

/**
 * Mic open for conversation barge-in (PlayAndRecord on iOS).
 * Do not use while TTS is playing — call prepareForTtsPlayback() during playback
 * or iOS routes audio to the quiet earpiece receiver.
 */
export async function configureConversationBargeInAudioMode() {
  await configureRecordingAudioMode();
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  const current = await Audio.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Audio.requestPermissionsAsync();
  return requested.granted;
}

/** When true, skip prewarm (caller is playing TTS — recording mode quiets iOS speaker). */
let recordingPrewarmBlocked = false;

export function setRecordingPrewarmBlocked(blocked: boolean): void {
  recordingPrewarmBlocked = blocked;
}

/** Keep a prepared recorder hot so press-to-talk starts faster. */
export function prewarmRecordingPipeline(): void {
  if (recordingPrewarmBlocked || prewarmPromise) return;
  prewarmPromise = (async () => {
    try {
      // Re-check — aggressive prewarm unblocks briefly; TTS speaking must keep Playback route.
      if (recordingPrewarmBlocked) return;
      await configureRecordingAudioMode();
      if (recordingPrewarmBlocked) return;
      if (prewarmRecording) return;
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      prewarmRecording = recording;
    } catch {
      prewarmRecording = null;
    } finally {
      prewarmPromise = null;
    }
  })();
}

export async function discardPrewarm(): Promise<void> {
  if (prewarmPromise) {
    await prewarmPromise.catch(() => undefined);
  }
  await safeUnloadRecording(prewarmRecording);
  prewarmRecording = null;
}

/** Start recording using prewarmed instance when available. */
const RECORDING_OPTIONS_METERED: Audio.RecordingOptions = {
  ...RECORDING_OPTIONS,
  isMeteringEnabled: true,
};

/** Conversation mode: metering enabled for silence / speech detection. */
export async function startConversationRecording(): Promise<Audio.Recording> {
  return withRecordingMutex(async () => {
    await configureRecordingAudioMode();
    await discardPrewarm();
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(RECORDING_OPTIONS_METERED);
    await recording.startAsync();
    return recording;
  });
}

export async function startPushToTalkRecording(): Promise<Audio.Recording> {
  return withRecordingMutex(async () => {
    await configureRecordingAudioMode();
    await discardPrewarm();
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(RECORDING_OPTIONS_METERED);
    await recording.startAsync();
    prewarmRecordingPipeline();
    return recording;
  });
}

export async function stopRecordingToUri(recording: Audio.Recording): Promise<string> {
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  if (!uri) throw new Error('Recording failed');
  return uri;
}

/** Ignore accidental tap-and-release; keep aligned with conversation MIN_SPEECH_MS. */
export const MIN_RECORDING_MS = 350;

async function transcribeRecordingOnce(uri: string, apiBase: string): Promise<string> {
  const form = new FormData();
  form.append('file', {
    uri,
    name: 'recording.wav',
    type: 'audio/wav',
  } as unknown as Blob);

  const response = await fetch(`${apiBase}/stt`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    let detail = `Speech recognition failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      const text = await response.text();
      if (text) detail = text.slice(0, 200);
    }
    throw new Error(detail);
  }

  const data = (await response.json()) as { text?: string };
  const text = data.text?.trim() ?? '';
  if (!text) throw new Error('No speech detected');
  return text;
}

/** STT with one retry when Azure returns empty / no-match (transient or clipped audio). */
export async function transcribeRecording(uri: string, apiBase: string): Promise<string> {
  try {
    return await transcribeRecordingOnce(uri, apiBase);
  } catch (err) {
    if (!isEmptySttError(err)) throw err;
    return transcribeRecordingOnce(uri, apiBase);
  }
}

/** Rolling partial caption — failures return empty string (non-blocking). */
export async function transcribePartialRecording(
  uri: string,
  apiBase: string,
): Promise<string> {
  const form = new FormData();
  form.append('file', {
    uri,
    name: 'partial.wav',
    type: 'audio/wav',
  } as unknown as Blob);

  try {
    const response = await fetch(`${apiBase}/stt?partial=1`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) return '';
    const data = (await response.json()) as { text?: string };
    return data.text?.trim() ?? '';
  } catch {
    return '';
  }
}
