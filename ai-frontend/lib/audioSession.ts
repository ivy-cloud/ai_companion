/**
 * expo-av-shaped Sound/Recording on top of expo-audio (SDK 55+).
 * Conversation code still uses createAsync / stopAndUnloadAsync / getStatusAsync.
 */
import {
  RecordingPresets,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
  type RecordingOptions,
} from 'expo-audio';
import { requireNativeModule } from 'expo';

type NativeAudioModule = {
  AudioRecorder: new (options: RecordingOptions) => NativeAudioRecorder;
};

type NativeAudioRecorder = {
  isRecording: boolean;
  uri: string | null;
  record: () => void;
  stop: () => Promise<void>;
  prepareToRecordAsync: (options?: Partial<RecordingOptions>) => Promise<void>;
  getStatus: () => {
    canRecord: boolean;
    isRecording: boolean;
    durationMillis: number;
    metering?: number;
  };
  release?: () => void;
};

const NativeAudio = requireNativeModule<NativeAudioModule>('ExpoAudio');

export type PlaybackStatus = {
  isLoaded: boolean;
  isPlaying: boolean;
  didJustFinish: boolean;
  durationMillis: number;
  positionMillis: number;
  error?: string;
};

export type RecordingStatus = {
  isRecording: boolean;
  metering?: number;
};

export type CreateSoundStatus = {
  shouldPlay?: boolean;
  volume?: number;
  isMuted?: boolean;
  isLooping?: boolean;
  rate?: number;
  shouldCorrectPitch?: boolean;
};

export class Sound {
  private player: AudioPlayer;
  private lastStatus: AudioStatus | null = null;

  constructor(player: AudioPlayer) {
    this.player = player;
    (this.player as AudioPlayer & {
      addListener: (event: 'playbackStatusUpdate', listener: (status: AudioStatus) => void) => {
        remove: () => void;
      };
    }).addListener('playbackStatusUpdate', (status: AudioStatus) => {
      this.lastStatus = status;
    });
  }

  static async createAsync(
    source: number | { uri: string },
    initial: CreateSoundStatus = {},
  ): Promise<{ sound: Sound }> {
    const player = createAudioPlayer(source, {
      updateInterval: 80,
      keepAudioSessionActive: true,
    });
    const sound = new Sound(player);
    const deadline = Date.now() + 10_000;
    while (!player.isLoaded && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (initial.volume != null) player.volume = initial.volume;
    if (initial.isMuted != null) player.muted = initial.isMuted;
    if (initial.isLooping != null) player.loop = initial.isLooping;
    if (initial.rate != null) player.setPlaybackRate(initial.rate, 'high');
    if (initial.shouldCorrectPitch != null) {
      player.shouldCorrectPitch = initial.shouldCorrectPitch;
    }
    if (initial.shouldPlay) player.play();
    return { sound };
  }

  async playAsync(): Promise<void> {
    this.player.play();
  }

  async pauseAsync(): Promise<void> {
    this.player.pause();
  }

  async stopAsync(): Promise<void> {
    this.player.pause();
    await this.player.seekTo(0);
  }

  async setPositionAsync(positionMillis: number): Promise<void> {
    await this.player.seekTo(Math.max(0, positionMillis) / 1000);
  }

  async setVolumeAsync(volume: number): Promise<void> {
    this.player.volume = volume;
  }

  async setIsMutedAsync(muted: boolean): Promise<void> {
    this.player.muted = muted;
  }

  async getStatusAsync(): Promise<PlaybackStatus> {
    const status = this.lastStatus;
    const durationSec = status?.duration ?? this.player.duration;
    const positionSec = status?.currentTime ?? this.player.currentTime;
    return {
      isLoaded: status?.isLoaded ?? this.player.isLoaded,
      isPlaying: status?.playing ?? this.player.playing,
      didJustFinish: Boolean(status?.didJustFinish),
      durationMillis: durationSec * 1000,
      positionMillis: positionSec * 1000,
      error: status?.error ?? undefined,
    };
  }

  async unloadAsync(): Promise<void> {
    try {
      this.player.pause();
    } catch {
      // already released
    }
    this.player.remove();
  }
}

/** AAC m4a — supported by expo-audio and Azure STT. */
export const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: false,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 128000,
};

export const RECORDING_OPTIONS_METERED: RecordingOptions = {
  ...RECORDING_OPTIONS,
  isMeteringEnabled: true,
};

export class Recording {
  private recorder: NativeAudioRecorder;
  private uri: string | null = null;

  constructor() {
    this.recorder = new NativeAudio.AudioRecorder(RECORDING_OPTIONS);
  }

  async prepareToRecordAsync(options: RecordingOptions = RECORDING_OPTIONS): Promise<void> {
    await this.recorder.prepareToRecordAsync(options);
  }

  async startAsync(): Promise<void> {
    this.recorder.record();
  }

  async stopAndUnloadAsync(): Promise<void> {
    try {
      await this.recorder.stop();
      this.uri = this.recorder.uri;
    } catch {
      this.uri = this.uri ?? this.recorder.uri;
    }
  }

  getURI(): string | null {
    return this.uri ?? this.recorder.uri;
  }

  async getStatusAsync(): Promise<RecordingStatus> {
    const status = this.recorder.getStatus();
    return {
      isRecording: status.isRecording,
      metering: status.metering,
    };
  }
}

export const Audio = {
  Sound,
  Recording,
};

const PLAYBACK_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  interruptionMode: 'doNotMix' as const,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};

const TTS_PLAYBACK_AUDIO_MODE = {
  ...PLAYBACK_AUDIO_MODE,
  shouldPlayInBackground: true,
};

export async function configurePlaybackAudioMode() {
  await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
}

export async function configureTtsPlaybackAudioMode() {
  await setAudioModeAsync(TTS_PLAYBACK_AUDIO_MODE);
}

export async function configureRecordingAudioMode() {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  });
}

export async function ensureMicrophonePermission(): Promise<boolean> {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return true;
  const requested = await requestRecordingPermissionsAsync();
  return requested.granted;
}
