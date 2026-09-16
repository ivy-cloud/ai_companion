import { isEmptySttError } from './voiceTranscript';
import {
  configurePlaybackAudioMode,
  configureRecordingAudioMode,
  configureTtsPlaybackAudioMode,
  ensureMicrophonePermission,
  RECORDING_OPTIONS,
  RECORDING_OPTIONS_METERED,
  Recording,
  Sound,
} from './audioSession';

export type { Recording, Sound };
export {
  configurePlaybackAudioMode,
  configureRecordingAudioMode,
  ensureMicrophonePermission,
};

export {
  isEmptySttError,
  isLikelyAssistantEchoTranscript,
  isSubstantiveTranscript,
  turnNoResponseTimeoutMs,
} from './voiceTranscript';

let prewarmRecording: Recording | null = null;
let prewarmPromise: Promise<void> | null = null;
/** Bumped on discard so in-flight prewarm cannot claim the single Recording slot. */
let prewarmGeneration = 0;
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
  recording: Recording | null | undefined,
): Promise<void> {
  if (!recording) return;
  try {
    await recording.stopAndUnloadAsync();
  } catch {
    // Already stopped/unloaded.
  }
}

/**
 * Release mic/recorder session and switch to speaker-oriented playback before TTS.
 * Prewarm and PlayAndRecord (barge-in) otherwise route iOS audio to the earpiece.
 * expo-audio routes to speaker when allowsRecording is false.
 */
export async function prepareForTtsPlayback(): Promise<void> {
  await discardPrewarm();
  await configureTtsPlaybackAudioMode();
}

/** Player gain caps at 1.0; device volume buttons set system level. */
export async function applyTtsSoundGain(sound: Sound, volume: number): Promise<void> {
  await sound.setIsMutedAsync(false);
  await sound.setVolumeAsync(volume);
}

/** After TTS playback, iOS needs a beat before PlayAndRecord accepts a new recorder. */
export async function prepareForConversationListen(): Promise<void> {
  await discardPrewarm();
  await new Promise((resolve) => setTimeout(resolve, 250));
  await configureRecordingAudioMode();
}

/**
 * Mic open for conversation barge-in (PlayAndRecord on iOS).
 * Do not use while TTS is playing — call prepareForTtsPlayback() during playback
 * or iOS routes audio to the quiet earpiece receiver.
 */
export async function configureConversationBargeInAudioMode() {
  await configureRecordingAudioMode();
}

/** When true, skip prewarm (caller is playing TTS — recording mode quiets iOS speaker). */
let recordingPrewarmBlocked = false;

export function setRecordingPrewarmBlocked(blocked: boolean): void {
  recordingPrewarmBlocked = blocked;
}

/** Keep a prepared recorder hot so press-to-talk starts faster. */
export function prewarmRecordingPipeline(): void {
  if (recordingPrewarmBlocked || prewarmPromise) return;
  const generation = ++prewarmGeneration;
  prewarmPromise = (async () => {
    try {
      // Re-check — aggressive prewarm unblocks briefly; TTS speaking must keep Playback route.
      if (recordingPrewarmBlocked || generation !== prewarmGeneration) return;
      await configureRecordingAudioMode();
      if (recordingPrewarmBlocked || generation !== prewarmGeneration) return;
      if (prewarmRecording) return;
      const recording = new Recording();
      await recording.prepareToRecordAsync(RECORDING_OPTIONS);
      if (recordingPrewarmBlocked || generation !== prewarmGeneration) {
        await safeUnloadRecording(recording);
        return;
      }
      prewarmRecording = recording;
    } catch {
      prewarmRecording = null;
    } finally {
      prewarmPromise = null;
    }
  })();
}

export async function discardPrewarm(): Promise<void> {
  prewarmGeneration += 1;
  if (prewarmPromise) {
    await prewarmPromise.catch(() => undefined);
  }
  await safeUnloadRecording(prewarmRecording);
  prewarmRecording = null;
}

/** Free Expo's single prepared Recording slot before opening conversation mic. */
export async function ensureRecordingSlotFree(): Promise<void> {
  await discardPrewarm();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Conversation mode: metering enabled for silence / speech detection.
 * Caller must hold the recording mutex (see startConversationListening). */
export async function startConversationRecording(): Promise<Recording> {
  await ensureRecordingSlotFree();
  await prepareForConversationListen();
  const recording = new Recording();
  await recording.prepareToRecordAsync(RECORDING_OPTIONS_METERED);
  await recording.startAsync();
  return recording;
}

export async function startPushToTalkRecording(): Promise<Recording> {
  return withRecordingMutex(async () => {
    await configureRecordingAudioMode();
    await discardPrewarm();
    const recording = new Recording();
    await recording.prepareToRecordAsync(RECORDING_OPTIONS_METERED);
    await recording.startAsync();
    prewarmRecordingPipeline();
    return recording;
  });
}

export async function stopRecordingToUri(recording: Recording): Promise<string> {
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
    name: 'recording.m4a',
    type: 'audio/mp4',
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
    name: 'partial.m4a',
    type: 'audio/mp4',
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
