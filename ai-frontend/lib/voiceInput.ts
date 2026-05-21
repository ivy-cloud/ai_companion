import { Audio, InterruptionModeIOS } from 'expo-av';

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

export async function configurePlaybackAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export async function configureRecordingAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  const current = await Audio.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Audio.requestPermissionsAsync();
  return requested.granted;
}

/** Keep a prepared recorder hot so press-to-talk starts faster. */
export function prewarmRecordingPipeline(): void {
  if (prewarmPromise) return;
  prewarmPromise = (async () => {
    try {
      await configureRecordingAudioMode();
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
  if (prewarmPromise) await prewarmPromise;
  if (!prewarmRecording) return;
  try {
    await prewarmRecording.stopAndUnloadAsync();
  } catch {
    // ignore
  }
  prewarmRecording = null;
}

/** Start recording using prewarmed instance when available. */
export async function startPushToTalkRecording(): Promise<Audio.Recording> {
  await configureRecordingAudioMode();

  if (prewarmPromise) await prewarmPromise;

  if (prewarmRecording) {
    const recording = prewarmRecording;
    prewarmRecording = null;
    await recording.startAsync();
    prewarmRecordingPipeline();
    return recording;
  }

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(RECORDING_OPTIONS);
  await recording.startAsync();
  prewarmRecordingPipeline();
  return recording;
}

export async function stopRecordingToUri(recording: Audio.Recording): Promise<string> {
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI();
  if (!uri) throw new Error('Recording failed');
  return uri;
}

/** Ignore accidental tap-and-release and STT noise phrases. */
export const MIN_RECORDING_MS = 450;

const PHANTOM_TRANSCRIPTS = new Set([
  'you',
  'the',
  'a',
  'uh',
  'um',
  'hmm',
  'okay',
  'ok',
  'yeah',
  'yes',
  'no',
  'thank you',
  'thanks',
  'thank you.',
  'thanks.',
]);

export function isSubstantiveTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '');
  if (normalized.length < 4) return false;
  if (PHANTOM_TRANSCRIPTS.has(normalized)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length < 4) return false;
  return true;
}

export async function transcribeRecording(uri: string, apiBase: string): Promise<string> {
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
