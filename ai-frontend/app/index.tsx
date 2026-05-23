import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  configurePlaybackAudioMode,
  configureRecordingAudioMode,
  discardPrewarm,
  safeUnloadRecording,
  setRecordingPrewarmBlocked,
  withRecordingMutex,
  ensureMicrophonePermission,
  prepareForTtsPlayback,
  prewarmRecordingPipeline,
  isSubstantiveTranscript,
  MIN_RECORDING_MS,
  startConversationRecording,
  startPushToTalkRecording,
  stopRecordingToUri,
  transcribeRecording,
} from '../lib/voiceInput';
import {
  BARGE_IN_COOLDOWN_MS,
  BARGE_IN_GRACE_MS,
  BARGE_IN_MIN_SPEECH_MS,
  BARGE_IN_TTS_GRACE_MS,
  POST_TTS_LISTEN_COOLDOWN_MS,
  createBargeInMeterState,
  createConversationMeterState,
  METERING_INTERVAL_MS,
  tickConversationBargeIn,
  tickConversationMeter,
  type BargeInMeterState,
  type ConversationMeterState,
} from '../lib/conversationMode';
import {
  formatReplyForUi,
  lastSentenceOf,
  prepareTextForSpeech,
  MAX_SPOKEN_CHARS,
  MAX_SPOKEN_CHARS_CASUAL,
  MAX_SPOKEN_SENTENCES,
  MAX_SPOKEN_SENTENCES_CASUAL,
  MAX_UTTERANCE_CHARS,
  replyTrimOptions,
  trimReplyForDisplay,
  type SpeechTrimOptions,
} from '../lib/speechPlayback';
import { isAbortError } from '../lib/abortError';
import {
  buildConversationalSpeakParts,
  fastAckAlreadyInReply,
  shouldStreamTtsWhileOpen,
  utterancePauseMs,
  type RhythmMeta,
} from '../lib/conversationOrchestration';
import { streamChatMessage, type ChatStreamDoneMeta } from '../lib/chatStream';
import {
  createIncrementalTtsState,
  pullSpeakableChunks,
  resetIncrementalTtsState,
  type IncrementalTtsState,
} from '../lib/incrementalTts';
import {
  getDeviceTimezone,
  refreshDeviceTimezoneCache,
} from '../lib/deviceTimezone';
import {
  createVoiceTurnTiming,
  logVoiceTurnSummary,
  markVoiceTiming,
  markVoiceChunkPlay,
  type VoiceTurnTiming,
} from '../lib/voiceLatency';
import {
  ASSISTANT_STUCK_MS,
  INTERRUPTING_STUCK_MS,
  blocksRecordingPrewarm,
  isAssistantActivePhase,
  logVoiceState,
  transitionVoicePhase,
  type VoicePhase,
} from '../lib/conversationState';
import {
  bumpSpeakGeneration,
  bumpStreamHandlers,
  bumpTurn,
  createVoiceSession,
  isActiveSpeak,
  isActiveStreamHandler,
  isActiveStreamTtsDrain,
  isActiveTurn,
  mergeAbortSignals,
} from '../lib/voiceSession';
import { voicePhaseHint, voicePhaseLabel } from '../lib/voiceFlow';
import {
  setVoiceLogContext,
  voiceLog,
  voiceLogSnapshot,
} from '../lib/voiceTurnLog';

/** LAN URL of the FastAPI backend (same Wi‑Fi as the phone). Override in `.env`: EXPO_PUBLIC_API_BASE */
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.178:8000';
const API_URL = `${API_BASE}/chat`;
const TTS_URL = `${API_BASE}/tts`;

const TTS_FETCH_TIMEOUT_MS = 30_000;

const SILENT_SOUND = require('../assets/silent.wav');

type SpeakPart = {
  text: string;
};

type VoiceGender = 'female' | 'male';

type VoiceInputMode = 'ptt' | 'conversation';

type AzureTtsStatus = {
  ready?: boolean;
  voice?: string;
  voice_label?: string;
  hint?: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += table[(triple >> 18) & 63];
    output += table[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? table[(triple >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? table[triple & 63] : '=';
  }
  return output;
}

async function fetchCompanionFromHealth(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return null;
    const data = (await response.json()) as { companion?: { name?: string } };
    return data.companion?.name?.trim() || null;
  } catch {
    return null;
  }
}

async function fetchAzureVoiceLabel(gender: VoiceGender): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/health?voice_gender=${gender}`);
    if (!response.ok) {
      return `Backend returned ${response.status} — check server at ${API_BASE}`;
    }
    const data = (await response.json()) as { azure_tts?: AzureTtsStatus };
    const azure = data.azure_tts;
    if (azure?.ready && azure.voice_label) return azure.voice_label;
    if (azure?.ready && azure.voice) return azure.voice;
    if (azure?.hint) {
      const h = azure.hint;
      return h.length > 100 ? `${h.slice(0, 97)}…` : h;
    }
    return 'Speech key not set in ai-backend/.env';
  } catch {
    return `Can't reach backend (${API_BASE}) — start server & same Wi‑Fi`;
  }
}

function formatVoiceStatusLine(voiceName: string): string {
  if (
    voiceName.startsWith("Can't reach") ||
    voiceName.startsWith('Backend ') ||
    voiceName.includes('Speech key') ||
    voiceName.includes('Loading')
  ) {
    return voiceName;
  }
  return `Azure voice: ${voiceName}`;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
};

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [naturalVoiceEnabled, setNaturalVoiceEnabled] = useState(true);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>('ptt');
  const [conversationSession, setConversationSession] = useState(false);
  const [companionName, setCompanionName] = useState('…');
  const [voiceGender, setVoiceGender] = useState<VoiceGender>('female');
  const [voiceName, setVoiceName] = useState('Loading voice…');
  const [voicePlaybackError, setVoicePlaybackError] = useState<string | null>(null);
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const [deviceTimezone, setDeviceTimezone] = useState<string | undefined>(() =>
    getDeviceTimezone(),
  );
  const voiceEnabledRef = useRef(true);
  const voicePhaseRef = useRef<VoicePhase>('idle');
  const voiceInputModeRef = useRef<VoiceInputMode>('ptt');
  const conversationSessionRef = useRef(false);
  const conversationMeterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationMeterStateRef = useRef<ConversationMeterState | null>(null);
  const conversationListenGenRef = useRef(0);
  const conversationBargeGenRef = useRef(0);
  const conversationBargeMeterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationBargeRecordingRef = useRef<Audio.Recording | null>(null);
  const conversationBargeStateRef = useRef<BargeInMeterState | null>(null);
  const conversationBargeGraceUntilRef = useRef(0);
  const conversationBargeCooldownUntilRef = useRef(0);
  const conversationListenResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartedAtRef = useRef(0);
  const micPressRef = useRef(false);
  const voiceUtteranceRef = useRef(0);
  const voiceSendLockRef = useRef(false);
  const lastVoiceTranscriptRef = useRef('');
  const naturalVoiceEnabledRef = useRef(true);
  const voiceGenderRef = useRef<VoiceGender>('female');
  const ttsExpressStyleRef = useRef<string | null>(null);
  const ttsEmotionHintRef = useRef<string | null>(null);
  const primeSoundRef = useRef<Audio.Sound | null>(null);
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const voiceSessionRef = useRef(createVoiceSession());
  const phaseChangedAtRef = useRef(Date.now());
  const ttsAbortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const streamVoiceBufferRef = useRef('');
  const speakInFlightRef = useRef(false);
  const chatInFlightRef = useRef(false);
  const pendingStreamTextRef = useRef('');
  const streamUiFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTtsStateRef = useRef<IncrementalTtsState>(createIncrementalTtsState());
  const streamTtsQueueRef = useRef<string[]>([]);
  const streamTtsDrainingRef = useRef(false);
  const streamTtsDoneRef = useRef(false);
  /** Normalized lines already queued for stream TTS this turn — prevents repeat loops. */
  const streamTtsEnqueuedKeysRef = useRef<Set<string>>(new Set());
  /** Raw streamed reply text for TTS chunking (UI buffer may be formatted differently). */
  const streamTtsRawRef = useRef('');
  /** Last assistant line for echo detection (mic picking up TTS). */
  const lastAssistantTtsTextRef = useRef('');
  const lastPlayedTtsKeyRef = useRef('');
  const rhythmMetaRef = useRef<RhythmMeta | null>(null);
  const serverSpeechChunksRef = useRef<string[] | null>(null);
  const voiceTurnTimingRef = useRef<VoiceTurnTiming | null>(null);
  const iosSpeakerPrimedGenerationRef = useRef(-1);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    naturalVoiceEnabledRef.current = naturalVoiceEnabled;
  }, [naturalVoiceEnabled]);

  useEffect(() => {
    voiceGenderRef.current = voiceGender;
  }, [voiceGender]);

  useEffect(() => {
    let mounted = true;
    void fetchAzureVoiceLabel(voiceGender).then((label) => {
      if (mounted) setVoiceName(label);
    });
    return () => {
      mounted = false;
    };
  }, [voiceGender]);

  useEffect(() => {
    voicePhaseRef.current = voicePhase;
  }, [voicePhase]);

  useEffect(() => {
    voiceInputModeRef.current = voiceInputMode;
  }, [voiceInputMode]);

  useEffect(() => {
    conversationSessionRef.current = conversationSession;
  }, [conversationSession]);

  useEffect(() => {
    if (voiceEnabled) prewarmVoiceMicIfIdle();
  }, [voiceEnabled]);

  useEffect(() => {
    const syncTimezone = () => setDeviceTimezone(getDeviceTimezone());
    syncTimezone();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshDeviceTimezoneCache();
        syncTimezone();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    let loadedSound: Audio.Sound | null = null;

    const prepareAudio = async () => {
      try {
        await configurePlaybackAudioMode();
        const [name, label] = await Promise.all([
          fetchCompanionFromHealth(),
          fetchAzureVoiceLabel(voiceGenderRef.current),
        ]);
        if (!mounted) return;
        if (name) setCompanionName(name);
        setVoiceName(label);

        const { sound } = await Audio.Sound.createAsync(SILENT_SOUND, {
          shouldPlay: false,
          volume: 1.0,
        });
        if (!mounted) {
          await sound.unloadAsync();
          return;
        }
        loadedSound = sound;
        primeSoundRef.current = sound;
      } catch {
        if (mounted) setVoiceName('Azure (error)');
      }
    };

    void prepareAudio();
    return () => {
      mounted = false;
      void loadedSound?.unloadAsync();
      primeSoundRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      const recording = recordingRef.current;
      recordingRef.current = null;
      if (recording) void recording.stopAndUnloadAsync();
    };
  }, []);

  const scrollToEnd = (animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  };

  const isActiveVoiceTurn = (turn: number) => isActiveTurn(voiceSessionRef.current, turn);

  const isActiveSpeakGeneration = (generation: number) =>
    isActiveSpeak(voiceSessionRef.current, generation);

  const abortTtsFetches = (reason: string) => {
    if (ttsAbortRef.current) {
      logVoiceState('tts_abort', { reason });
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
  };

  const ensureTtsAbortSignal = (): AbortSignal => {
    if (!ttsAbortRef.current || ttsAbortRef.current.signal.aborted) {
      ttsAbortRef.current = new AbortController();
    }
    return ttsAbortRef.current.signal;
  };

  const prewarmVoiceMicIfIdle = () => {
    if (
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation'
    ) {
      return;
    }
    if (
      voicePhaseRef.current === 'speaking' ||
      isAssistantActivePhase(voicePhaseRef.current) ||
      voicePhaseRef.current === 'listening'
    ) {
      return;
    }
    prewarmRecordingPipeline();
  };

  /** Free Expo's single prepared Recording slot (prewarm + conversation + barge-in). */
  const releaseAllActiveRecorders = async (keep?: Audio.Recording | null) => {
    await discardPrewarm();
    stopConversationMetering();
    conversationBargeGenRef.current += 1;
    if (conversationBargeMeterRef.current) {
      clearInterval(conversationBargeMeterRef.current);
      conversationBargeMeterRef.current = null;
    }
    conversationBargeStateRef.current = null;
    conversationBargeGraceUntilRef.current = 0;
    const barge = conversationBargeRecordingRef.current;
    conversationBargeRecordingRef.current = null;
    const main = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    await Promise.all([
      safeUnloadRecording(barge !== keep ? barge : null),
      safeUnloadRecording(main !== keep ? main : null),
    ]);
  };

  const syncRecordingPrewarmBlock = (phase: VoicePhase) => {
    setRecordingPrewarmBlocked(blocksRecordingPrewarm(phase));
  };

  const setVoicePhaseTransition = (
    next: VoicePhase,
    options?: { force?: boolean; reason?: string },
  ) => {
    const ok = transitionVoicePhase(
      {
        get: () => voicePhaseRef.current,
        set: (phase) => {
          voicePhaseRef.current = phase;
          setVoicePhase(phase);
          syncRecordingPrewarmBlock(phase);
        },
        phaseSince: () => Date.now() - phaseChangedAtRef.current,
      },
      next,
      options,
    );
    if (ok && voicePhaseRef.current === next) {
      phaseChangedAtRef.current = Date.now();
      logVoiceSnapshot(`after_phase_${next}`);
    }
    return ok;
  };

  const stopConversationMetering = () => {
    if (conversationMeterRef.current) {
      clearInterval(conversationMeterRef.current);
      conversationMeterRef.current = null;
    }
    conversationMeterStateRef.current = null;
  };

  /** Stop barge-in metering and return the live recorder (caller may hand off to listen). */
  const detachConversationBargeRecording = (): Audio.Recording | null => {
    conversationBargeGenRef.current += 1;
    if (conversationBargeMeterRef.current) {
      clearInterval(conversationBargeMeterRef.current);
      conversationBargeMeterRef.current = null;
    }
    conversationBargeStateRef.current = null;
    conversationBargeGraceUntilRef.current = 0;
    const rec = conversationBargeRecordingRef.current;
    conversationBargeRecordingRef.current = null;
    return rec;
  };

  const stopConversationBargeIn = () => {
    const rec = detachConversationBargeRecording();
    if (rec) void safeUnloadRecording(rec);
  };

  const refreshConversationBargeInGrace = (forTts = false) => {
    const graceMs = forTts ? BARGE_IN_TTS_GRACE_MS : BARGE_IN_GRACE_MS;
    conversationBargeGraceUntilRef.current = Date.now() + graceMs;
    conversationBargeStateRef.current = createBargeInMeterState();
  };

  const startConversationBargeIn = async (options?: { forTts?: boolean }) => {
    return withRecordingMutex(async () => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return;
    }
    const phase = voicePhaseRef.current;
    // Barge-in only while TTS plays — avoids false interrupts during stream/thinking.
    if (phase !== 'speaking') return;
    if (conversationBargeRecordingRef.current) {
      if (options?.forTts) refreshConversationBargeInGrace(true);
      return;
    }

    const bargeGen = ++conversationBargeGenRef.current;
    refreshConversationBargeInGrace(options?.forTts === true);

    const permitted = await ensureMicrophonePermission();
    if (!permitted || bargeGen !== conversationBargeGenRef.current) return;
    if (voicePhaseRef.current !== 'speaking') {
      return;
    }

    try {
      await releaseAllActiveRecorders();
      const recording = await startConversationRecording();
      if (bargeGen !== conversationBargeGenRef.current) {
        await recording.stopAndUnloadAsync();
        return;
      }
      if (voicePhaseRef.current !== 'speaking') {
        await recording.stopAndUnloadAsync();
        return;
      }

      conversationBargeRecordingRef.current = recording;
      conversationBargeStateRef.current = createBargeInMeterState();

      conversationBargeMeterRef.current = setInterval(() => {
        void (async () => {
          if (bargeGen !== conversationBargeGenRef.current) return;
          const active = conversationBargeRecordingRef.current;
          if (!active) return;
          const currentPhase = voicePhaseRef.current;
          if (currentPhase !== 'speaking') return;

          const now = Date.now();
          if (now < conversationBargeCooldownUntilRef.current) {
            conversationBargeStateRef.current = createBargeInMeterState();
            return;
          }

          let status: Awaited<ReturnType<Audio.Recording['getStatusAsync']>>;
          try {
            status = await active.getStatusAsync();
          } catch {
            return;
          }
          if (!status.isRecording) return;
          const prev =
            conversationBargeStateRef.current ?? createBargeInMeterState();
          const graceUntil = conversationBargeGraceUntilRef.current;
          const tick = tickConversationBargeIn(prev, status.metering, now, graceUntil);
          conversationBargeStateRef.current = tick.state;

          if (tick.triggered) {
            conversationBargeCooldownUntilRef.current = Date.now() + BARGE_IN_COOLDOWN_MS;
            const speechStartedAt =
              tick.state.speechStartedAt ??
              conversationBargeStateRef.current?.speechStartedAt ??
              now;
            const bargeRec = detachConversationBargeRecording();
            if (bargeRec) {
              void resumeConversationListenAfterBargeIn(bargeRec, speechStartedAt);
            } else {
              interruptConversationAssistant({ resumeListening: true });
            }
          }
        })();
      }, METERING_INTERVAL_MS);
    } catch {
      if (bargeGen === conversationBargeGenRef.current) {
        stopConversationBargeIn();
      }
    }
    });
  };

  const endConversationSession = () => {
    clearConversationListenResumeTimer();
    conversationListenGenRef.current += 1;
    conversationSessionRef.current = false;
    setConversationSession(false);
    stopConversationBargeIn();
    stopConversationMetering();
    const rec = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    if (rec) void safeUnloadRecording(rec);
    if (voicePhaseRef.current === 'listening') {
      setVoicePhaseTransition('idle');
      if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
    }
  };

  const beginConversationListenMeter = (listenGen: number) => {
    stopConversationMetering();
    conversationMeterRef.current = setInterval(() => {
      void (async () => {
        if (listenGen !== conversationListenGenRef.current) return;
        const recording = recordingRef.current;
        if (!recording || voicePhaseRef.current !== 'listening') return;
        if (
          streamTtsDrainingRef.current ||
          streamTtsQueueRef.current.length > 0 ||
          activeSoundRef.current ||
          speakInFlightRef.current
        ) {
          return;
        }

        let status: Awaited<ReturnType<Audio.Recording['getStatusAsync']>>;
        try {
          status = await recording.getStatusAsync();
        } catch {
          return;
        }
        if (!status.isRecording) return;

        const now = Date.now();
        const prev = conversationMeterStateRef.current ?? createConversationMeterState(now);
        const tick = tickConversationMeter(prev, status.metering, now);
        conversationMeterStateRef.current = tick.state;

        if (tick.inactive) {
          endConversationSession();
          setVoiceInputError('Conversation ended — no speech heard.');
          prewarmVoiceMicIfIdle();
          return;
        }

        if (tick.endSilence) {
          stopConversationMetering();
          const active = recordingRef.current;
          recordingRef.current = null;
          if (!active) return;
          void finalizeConversationListenChunk(active, listenGen);
        }
      })();
    }, METERING_INTERVAL_MS);
  };

  /** Keep barge-in audio, stop TTS, and finish the user's interrupt utterance. */
  const resumeConversationListenAfterBargeIn = async (
    recording: Audio.Recording,
    speechStartedAt: number,
  ) => {
    return withRecordingMutex(async () => {
      if (
        !conversationSessionRef.current ||
        voiceInputModeRef.current !== 'conversation' ||
        !voiceEnabledRef.current
      ) {
        await safeUnloadRecording(recording);
        return;
      }

      interruptAssistant({
        keepConversationSession: true,
        resumeListening: false,
      });

      const listenGen = ++conversationListenGenRef.current;
      stopConversationMetering();

      try {
        await configureRecordingAudioMode();
      } catch {
        await safeUnloadRecording(recording);
        return;
      }

      if (listenGen !== conversationListenGenRef.current || !conversationSessionRef.current) {
        await safeUnloadRecording(recording);
        return;
      }

      await releaseAllActiveRecorders(recording);

      const now = Date.now();
      recordingRef.current = recording;
      recordingStartedAtRef.current = speechStartedAt;
      conversationMeterStateRef.current = {
        sawSpeech: true,
        speechStartedAt,
        silenceSince: null,
        listenStartedAt: now,
        lastSpeechAt: now,
      };

      setVoiceInputError(null);
      voiceUtteranceRef.current += 1;

      if (!setVoicePhaseTransition('listening')) {
        recordingRef.current = null;
        await safeUnloadRecording(recording);
        ensureConversationListening();
        return;
      }

      beginConversationListenMeter(listenGen);
    });
  };

  const finalizeConversationListenChunk = async (
    recording: Audio.Recording,
    listenGen: number,
  ) => {
    stopConversationMetering();
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;

    if (
      listenGen !== conversationListenGenRef.current ||
      !conversationSessionRef.current
    ) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      return;
    }

    const utteranceId = ++voiceUtteranceRef.current;
    if (!setVoicePhaseTransition('thinking', { reason: 'stt_done' })) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      ensureConversationListening();
      return;
    }

    try {
      const uri = await stopRecordingToUri(recording);
      void processVoiceUtterance(uri, utteranceId, { fromConversation: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      setVoiceInputError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
      if (conversationSessionRef.current) {
        ensureConversationListening();
      } else {
        setVoicePhaseTransition('idle');
        prewarmVoiceMicIfIdle();
      }
    }
  };

  const clearConversationListenResumeTimer = () => {
    if (conversationListenResumeTimerRef.current) {
      clearTimeout(conversationListenResumeTimerRef.current);
      conversationListenResumeTimerRef.current = null;
    }
  };

  /** Unstick conversation mode after a missed interrupt / stale STT / failed listen transition. */
  const ensureConversationListening = () => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return;
    }
    voiceSendLockRef.current = false;
    chatInFlightRef.current = false;
    speakInFlightRef.current = false;
    ensureUiUnlocked();
    if (voicePhaseRef.current === 'listening' && recordingRef.current) {
      return;
    }
    logVoiceState('ensure_listen', { phase: voicePhaseRef.current });
    void startConversationListening({ resumeAfterInterrupt: true });
  };

  /** Single debounced path back to Listening… after TTS / errors / interrupt. */
  const scheduleConversationListen = (delayMs = POST_TTS_LISTEN_COOLDOWN_MS) => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return;
    }
    clearConversationListenResumeTimer();
    conversationListenResumeTimerRef.current = setTimeout(() => {
      conversationListenResumeTimerRef.current = null;
      if (
        chatInFlightRef.current ||
        voiceSendLockRef.current ||
        streamTtsDrainingRef.current ||
        streamTtsQueueRef.current.length > 0 ||
        activeSoundRef.current ||
        speakInFlightRef.current
      ) {
        scheduleConversationListen(400);
        return;
      }
      ensureConversationListening();
    }, delayMs);
  };

  const resumeConversationListeningAfterTurn = () => {
    voiceLog('schedule_listen', { delayMs: POST_TTS_LISTEN_COOLDOWN_MS });
    logVoiceSnapshot('schedule_listen');
    scheduleConversationListen();
  };

  const startConversationListening = async (options?: {
    /** After interrupt or failed transcript — allow processing → listening. */
    resumeAfterInterrupt?: boolean;
  }) => {
    return withRecordingMutex(async () => {
      if (
        !conversationSessionRef.current ||
        voiceInputModeRef.current !== 'conversation' ||
        !voiceEnabledRef.current
      ) {
        return;
      }
      if (voicePhaseRef.current === 'listening' && recordingRef.current) {
        return;
      }
      const phase = voicePhaseRef.current;
      if (options?.resumeAfterInterrupt) {
        const okResume =
          phase === 'idle' ||
          phase === 'speaking' ||
          phase === 'thinking' ||
          phase === 'streaming' ||
          phase === 'interrupting';
        if (!okResume) return;
      } else if (phase !== 'idle' && phase !== 'speaking') {
        return;
      }
      if (
        !options?.resumeAfterInterrupt &&
        (chatInFlightRef.current || voiceSendLockRef.current)
      ) {
        return;
      }

      const listenGen = ++conversationListenGenRef.current;
      stopConversationBargeIn();
      stopConversationMetering();

      if (voicePhaseRef.current === 'speaking' && !options?.resumeAfterInterrupt) {
        interruptAssistant({ keepConversationSession: true });
      }

      setVoiceInputError(null);
      voiceUtteranceRef.current += 1;

      const permitted = await ensureMicrophonePermission();
      if (!permitted) {
        setVoiceInputError('Microphone access is required to talk.');
        endConversationSession();
        return;
      }

      if (listenGen !== conversationListenGenRef.current || !conversationSessionRef.current) {
        return;
      }

      if (!setVoicePhaseTransition('listening')) {
        scheduleConversationListen(300);
        return;
      }

      try {
        await releaseAllActiveRecorders();
        const recording = await startConversationRecording();
        if (listenGen !== conversationListenGenRef.current || !conversationSessionRef.current) {
          await safeUnloadRecording(recording);
          return;
        }

        recordingRef.current = recording;
        recordingStartedAtRef.current = Date.now();
        conversationMeterStateRef.current = createConversationMeterState();
        beginConversationListenMeter(listenGen);
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'Could not start listening';
        const onlyOne =
          raw.includes('Only one Recording') || raw.includes('one Recording object');
        if (onlyOne) {
          try {
            await releaseAllActiveRecorders();
            const recording = await startConversationRecording();
            if (
              listenGen === conversationListenGenRef.current &&
              conversationSessionRef.current
            ) {
              recordingRef.current = recording;
              recordingStartedAtRef.current = Date.now();
              conversationMeterStateRef.current = createConversationMeterState();
              beginConversationListenMeter(listenGen);
              return;
            }
            await safeUnloadRecording(recording);
          } catch {
            // fall through
          }
        }
        setVoiceInputError(
          onlyOne
            ? 'Mic busy — tap Listen on Mic to try again.'
            : raw.length > 140
              ? `${raw.slice(0, 137)}…`
              : raw,
        );
        setVoicePhaseTransition('idle');
        ensureConversationListening();
      }
    });
  };

  const startConversationSession = () => {
    if (!voiceEnabledRef.current) {
      setVoiceInputError('Turn on voice to use conversation mode.');
      return;
    }
    if (conversationSessionRef.current) return;

    if (voicePhaseRef.current !== 'idle') {
      interruptAssistant({ keepConversationSession: true });
    }

    conversationSessionRef.current = true;
    setConversationSession(true);
    clearConversationListenResumeTimer();
    void startConversationListening({ resumeAfterInterrupt: true });
  };

  const stopConversationListening = () => {
    conversationListenGenRef.current += 1;
    stopConversationBargeIn();
    stopConversationMetering();
    const rec = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    if (rec) void safeUnloadRecording(rec);
    if (voicePhaseRef.current === 'listening') {
      voicePhaseRef.current = 'idle';
      setVoicePhase('idle');
      syncRecordingPrewarmBlock('idle');
    }
  };

  const interruptConversationAssistant = (options?: { resumeListening?: boolean }) => {
    interruptAssistant({
      keepConversationSession: true,
      resumeListening: options?.resumeListening === true,
    });
  };

  const onConversationMicPress = () => {
    if (!voiceEnabledRef.current) {
      setVoiceInputError('Turn on voice to use the mic.');
      return;
    }

    if (isAssistantActivePhase(voicePhaseRef.current)) {
      interruptConversationAssistant({ resumeListening: true });
      return;
    }

    if (conversationSessionRef.current) {
      if (voicePhaseRef.current === 'listening') {
        endConversationSession();
        prewarmVoiceMicIfIdle();
        return;
      }
      if (voicePhaseRef.current === 'idle') {
        ensureConversationListening();
        return;
      }
      endConversationSession();
      interruptAssistant();
      prewarmVoiceMicIfIdle();
      return;
    }

    startConversationSession();
  };

  const onVoiceInputModeChange = (mode: VoiceInputMode) => {
    setVoiceInputMode(mode);
    voiceInputModeRef.current = mode;
    if (mode === 'ptt') {
      endConversationSession();
    }
  };

  const clearStreamUiFlush = () => {
    if (streamUiFlushTimerRef.current) {
      clearTimeout(streamUiFlushTimerRef.current);
      streamUiFlushTimerRef.current = null;
    }
  };

  const flushStreamUi = (scroll = true) => {
    clearStreamUiFlush();
    const assistantId = activeAssistantIdRef.current;
    if (!assistantId) return;

    const raw = pendingStreamTextRef.current;
    const opts = replyTrimOptions(
      naturalVoiceEnabledRef.current,
      voiceEnabledRef.current,
    );
    const text = opts ? trimReplyForDisplay(raw, opts) : raw;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId ? { ...message, text } : message,
      ),
    );
    if (scroll) scrollToEnd(false);
  };

  const appendAssistantChunk = (chunk: string) => {
    if (!activeAssistantIdRef.current || !chunk) return;

    pendingStreamTextRef.current += chunk;
    if (streamUiFlushTimerRef.current) return;

    streamUiFlushTimerRef.current = setTimeout(() => {
      flushStreamUi(true);
    }, 48);
  };

  const resetStreamTts = () => {
    streamTtsQueueRef.current = [];
    streamTtsDrainingRef.current = false;
    streamTtsDoneRef.current = false;
    streamTtsEnqueuedKeysRef.current = new Set();
    streamTtsRawRef.current = '';
    lastPlayedTtsKeyRef.current = '';
    resetIncrementalTtsState(streamTtsStateRef.current);
  };

  const useConversationSingleClipTts = () =>
    conversationSessionRef.current &&
    voiceInputModeRef.current === 'conversation';

  /** Short replies: one TTS clip at end — avoids last-sentence repeat loops. */
  const useSingleClipStreamTts = (raw: string) =>
    useConversationSingleClipTts() || prepareTextForSpeech(raw).length <= 480;

  const cancelActiveStreamTtsDrain = () => {
    voiceSessionRef.current.streamTtsDrainGen += 1;
    streamTtsQueueRef.current = [];
    streamTtsDrainingRef.current = false;
  };

  /** One Azure clip for the full reply — avoids last-sentence loop in conversation mode. */
  const speakStreamReplyAsSingleClip = async (turn: number, generation: number) => {
    const raw = streamTtsRawRef.current.trim();
    const line = prepareTextForSpeech(raw);
    if (!line) return;
    await stopPlayback();
    cancelActiveStreamTtsDrain();
    streamTtsEnqueuedKeysRef.current = new Set();
    lastPlayedTtsKeyRef.current = '';
    resetIncrementalTtsState(streamTtsStateRef.current);
    streamTtsStateRef.current.spokenPrefix = line;
    lastAssistantTtsTextRef.current = raw;
    logVoiceState('stream_tts_single_clip', {
      chars: line.length,
      preview: line.length > 56 ? `${line.slice(0, 53)}…` : line,
    });
    enqueueStreamTtsChunks([line], turn, generation);
  };

  const waitPlaybackFullyStopped = async () => {
    let stable = 0;
    for (let i = 0; i < 100; i += 1) {
      if (
        !activeSoundRef.current &&
        !streamTtsDrainingRef.current &&
        streamTtsQueueRef.current.length === 0 &&
        !speakInFlightRef.current
      ) {
        stable += 1;
        if (stable >= 6) return;
      } else {
        stable = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const isLikelyAssistantEcho = (transcript: string): boolean => {
    const heard = prepareTextForSpeech(transcript).toLowerCase();
    const spoken = prepareTextForSpeech(lastAssistantTtsTextRef.current).toLowerCase();
    if (!heard || heard.length < 6 || !spoken) return false;
    if (spoken.includes(heard) || heard.includes(spoken)) return true;
    const tail = lastSentenceOf(lastAssistantTtsTextRef.current);
    if (tail) {
      const tailNorm = prepareTextForSpeech(tail).toLowerCase();
      if (tailNorm.includes(heard) || heard.includes(tailNorm)) return true;
      const heardWords = heard.split(/\s+/).filter((w) => w.length > 2);
      const tailWords = new Set(tailNorm.split(/\s+/).filter((w) => w.length > 2));
      const overlap = heardWords.filter((w) => tailWords.has(w)).length;
      if (heardWords.length >= 2 && overlap >= Math.min(3, heardWords.length)) {
        return true;
      }
    }
    return false;
  };

  const streamTtsChunkKey = (text: string) => prepareTextForSpeech(text.trim());

  const logVoiceSnapshot = (label: string, extra?: Record<string, string | number | boolean>) => {
    voiceLogSnapshot(label, {
      phase: voicePhaseRef.current,
      queue: streamTtsQueueRef.current.length,
      draining: streamTtsDrainingRef.current,
      streamDone: streamTtsDoneRef.current,
      activeSound: Boolean(activeSoundRef.current),
      speakInFlight: speakInFlightRef.current,
      chatInFlight: chatInFlightRef.current,
      enqueuedKeys: streamTtsEnqueuedKeysRef.current.size,
      spokenLen: streamTtsStateRef.current.spokenPrefix.length,
      rawLen: streamTtsRawRef.current.length,
      convSession: conversationSessionRef.current,
      convMode: voiceInputModeRef.current,
      ...extra,
    });
  };

  const ensureUiUnlocked = () => {
    setLoading(false);
    setIsStreaming(false);
  };

  const releaseVoiceUi = (reason = 'release') => {
    streamTtsQueueRef.current = [];
    streamTtsDrainingRef.current = false;
    streamTtsDoneRef.current = false;
    resetStreamTts();
    chatInFlightRef.current = false;
    speakInFlightRef.current = false;
    ensureUiUnlocked();
    setVoicePhaseTransition('idle', { force: true, reason });
    if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
  };

  const maybeFinishStreamTtsIdle = (turn: number, generation: number) => {
    if (!isActiveVoiceTurn(turn) || !isActiveSpeakGeneration(generation)) return;
    if (!streamTtsDoneRef.current) return;
    if (streamTtsDrainingRef.current || streamTtsQueueRef.current.length > 0) return;
    if (speakInFlightRef.current || chatInFlightRef.current) return;
    setVoicePhaseTransition('idle', { reason: 'stream_tts_queue_empty' });
  };

  const drainStreamTtsQueue = async (turn: number, generation: number) => {
    if (streamTtsDrainingRef.current) return;
    if (!isActiveVoiceTurn(turn) || !isActiveSpeakGeneration(generation)) return;

    const drainGen = voiceSessionRef.current.streamTtsDrainGen;
    streamTtsDrainingRef.current = true;
    logVoiceState('stream_tts_drain_start', { turn, generation, drainGen });
    logVoiceSnapshot('drain_start', { drainGen });
    let betweenClips = false;
    let prefetch: Promise<string | null> | null = null;

    try {
      while (streamTtsQueueRef.current.length > 0) {
        if (
          !isActiveVoiceTurn(turn) ||
          !isActiveSpeakGeneration(generation) ||
          !isActiveStreamTtsDrain(voiceSessionRef.current, drainGen)
        ) {
          logVoiceState('stream_tts_drain_cancel', { turn, generation });
          return;
        }

        setVoicePlaybackError(null);
        setVoicePhaseTransition('speaking', { reason: 'stream_tts_play' });

        if (!prefetch) {
          const text = streamTtsQueueRef.current.shift();
          if (!text?.trim()) continue;
          const playKey = streamTtsChunkKey(text);
          if (playKey && playKey === lastPlayedTtsKeyRef.current) {
            logVoiceState('skip_duplicate_play', { preview: playKey.slice(0, 48) });
            continue;
          }
          lastPlayedTtsKeyRef.current = playKey;
          prefetch = prepareTtsClip(text.trim(), generation, {
            markFetchDone: !voiceTurnTimingRef.current?.marks.first_tts_fetch_done,
          });
        }

        const path = await prefetch;
        prefetch = null;
        if (!path) {
          betweenClips = false;
          continue;
        }

        const nextText = streamTtsQueueRef.current[0]?.trim();
        if (nextText) {
          prefetch = prepareTtsClip(nextText, generation);
        }

        try {
          await playTtsClip(path, generation, { betweenClips });
          betweenClips = true;
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Voice failed';
          setVoicePlaybackError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
          streamTtsQueueRef.current = [];
          releaseVoiceUi();
          return;
        }
      }
    } finally {
      streamTtsDrainingRef.current = false;
      logVoiceState('stream_tts_drain_end', { turn, generation });
      logVoiceSnapshot('drain_end');
      if (
        streamTtsQueueRef.current.length > 0 &&
        isActiveVoiceTurn(turn) &&
        isActiveSpeakGeneration(generation) &&
        isActiveStreamTtsDrain(voiceSessionRef.current, drainGen)
      ) {
        void drainStreamTtsQueue(turn, generation);
      } else if (
        isActiveVoiceTurn(turn) &&
        isActiveSpeakGeneration(generation)
      ) {
        maybeFinishStreamTtsIdle(turn, generation);
      }
    }
  };

  const enqueueStreamTtsChunks = (chunks: string[], turn: number, generation: number) => {
    if (!voiceEnabledRef.current || chunks.length === 0) return;
    if (!isActiveVoiceTurn(turn) || !isActiveSpeakGeneration(generation)) return;
    let added = false;
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const key = streamTtsChunkKey(trimmed);
      if (!key || streamTtsEnqueuedKeysRef.current.has(key)) {
        continue;
      }
      streamTtsEnqueuedKeysRef.current.add(key);
      added = true;
      logVoiceState('stream_tts_enqueue', {
        turn,
        chars: trimmed.length,
        preview: trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed,
      });
      if (!voiceTurnTimingRef.current?.marks.first_tts_enqueue) {
        markVoiceTiming(voiceTurnTimingRef.current, 'first_tts_enqueue');
      }
      streamTtsQueueRef.current.push(trimmed);
    }
    if (added) {
      logVoiceSnapshot('after_enqueue', { addedChunks: chunks.length });
      void drainStreamTtsQueue(turn, generation);
    }
  };

  const feedIncrementalTtsFromStream = (
    turn: number,
    generation: number,
    flush = false,
  ) => {
    if (!voiceEnabledRef.current) return;
    const chunks = pullSpeakableChunks(
      streamTtsStateRef.current,
      streamTtsRawRef.current,
      flush,
      streamTtsEnqueuedKeysRef.current,
    );
    enqueueStreamTtsChunks(chunks, turn, generation);
  };

  const interruptAssistant = (options?: {
    keepConversationSession?: boolean;
    resumeListening?: boolean;
  }) => {
    const fromPhase = voicePhaseRef.current;
    const hadWork =
      chatInFlightRef.current ||
      speakInFlightRef.current ||
      streamTtsDrainingRef.current ||
      streamTtsQueueRef.current.length > 0 ||
      isAssistantActivePhase(fromPhase);

    if (!options?.keepConversationSession) {
      endConversationSession();
    } else {
      conversationListenGenRef.current += 1;
      stopConversationBargeIn();
      stopConversationMetering();
      void releaseAllActiveRecorders();
    }

    if (hadWork && fromPhase !== 'interrupting') {
      setVoicePhaseTransition('interrupting', {
        force: true,
        reason: 'user_interrupt',
      });
    }

    logVoiceState('interrupt_begin', {
      from: fromPhase,
      resume: options?.resumeListening === true,
    });
    markVoiceTiming(voiceTurnTimingRef.current, 'interrupt');

    voiceUtteranceRef.current += 1;
    bumpTurn(voiceSessionRef.current, 'interrupt');
    bumpSpeakGeneration(voiceSessionRef.current, 'interrupt');
    bumpStreamHandlers(voiceSessionRef.current, 'interrupt');
    setVoiceLogContext(
      voiceSessionRef.current.turn,
      voiceSessionRef.current.speakGeneration,
    );
    logVoiceSnapshot('interrupt');
    abortTtsFetches('interrupt');
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    streamVoiceBufferRef.current = '';
    pendingStreamTextRef.current = '';
    streamTtsQueueRef.current = [];
    streamTtsDrainingRef.current = false;
    streamTtsDoneRef.current = false;
    streamTtsEnqueuedKeysRef.current = new Set();
    resetStreamTts();
    clearStreamUiFlush();
    voiceSendLockRef.current = false;
    lastVoiceTranscriptRef.current = '';
    micPressRef.current = false;
    chatInFlightRef.current = false;
    speakInFlightRef.current = false;
    ensureUiUnlocked();
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      finalizeInterruptedTurn(assistantId);
    }

    void stopPlayback().catch(() => {});
    void discardPrewarm();

    const resumeConversation =
      options?.keepConversationSession &&
      options?.resumeListening === true &&
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation' &&
      voiceEnabledRef.current;

    if (resumeConversation) {
      setVoicePhaseTransition('idle', { force: true, reason: 'interrupt_to_listen' });
      scheduleConversationListen(120);
    } else {
      setVoicePhaseTransition('idle', { force: true, reason: 'interrupt_done' });
      syncRecordingPrewarmBlock('idle');
      if (!options?.keepConversationSession && voiceEnabledRef.current) {
        prewarmVoiceMicIfIdle();
      }
    }

    logVoiceState('interrupt_end', { resume: resumeConversation });
  };

  const finalizeInterruptedTurn = (assistantId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId && message.streaming
          ? {
              ...message,
              streaming: false,
              text: message.text.trim() || '…',
            }
          : message,
      ),
    );
    setIsStreaming(false);
    setLoading(false);
  };

  const primeIosSpeaker = async () => {
    if (Platform.OS !== 'ios') return;
    await prepareForTtsPlayback();
    const sound = primeSoundRef.current;
    if (!sound) return;
    try {
      await sound.setVolumeAsync(1.0);
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch {
      // continue
    }
  };

  const replyTrim = (forTest = false): SpeechTrimOptions | false => {
    if (forTest) return false;
    return replyTrimOptions(
      naturalVoiceEnabledRef.current,
      voiceEnabledRef.current,
    );
  };

  const formatAssistantReply = (reply: string, forTest = false): string => {
    if (forTest) return reply.trim();
    return formatReplyForUi(
      reply,
      naturalVoiceEnabledRef.current,
      voiceEnabledRef.current,
    );
  };

  const buildSpeakParts = (
    mainText: string,
    forTest: boolean,
    serverChunks?: string[] | null,
  ): SpeakPart[] => {
    if (serverChunks?.length) {
      return serverChunks.filter(Boolean).map((text) => ({ text }));
    }
    const trim = replyTrim(forTest) ?? {
      maxSentences: MAX_SPOKEN_SENTENCES,
      maxChars: MAX_SPOKEN_CHARS,
    };
    return buildConversationalSpeakParts(mainText, trim);
  };

  const playFastAckLine = async (text: string, turn: number, generation: number) => {
    if (!voiceEnabledRef.current || turn !== voiceSessionRef.current.turn) return;
    if (!isActiveSpeakGeneration(generation)) return;
    try {
      await prepareForTtsPlayback();
      const path = await prepareTtsClip(text, generation);
      if (!path || !isActiveSpeakGeneration(generation)) return;
      await playTtsClip(path, generation);
    } catch {
      // Fast ack is optional — never block the turn.
    }
  };

  const stopPlayback = async () => {
    speakInFlightRef.current = false;
    const sound = activeSoundRef.current;
    activeSoundRef.current = null;
    if (!sound) return;
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // ignore
    }
  };

  const prepareTtsClip = async (
    text: string,
    generation: number,
    options?: { markFetchDone?: boolean },
  ): Promise<string | null> => {
    if (!isActiveSpeakGeneration(generation)) return null;

    const spoken = prepareTextForSpeech(text.trim());
    if (!spoken) return null;

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), TTS_FETCH_TIMEOUT_MS);
    const signal = mergeAbortSignals(ensureTtsAbortSignal(), timeoutController.signal);
    let response: Response;
    try {
      logVoiceState('tts_fetch_start', { generation, chars: spoken.length });
      response = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spoken,
          style: 'default',
          voice_gender: voiceGenderRef.current,
          ...(ttsExpressStyleRef.current
            ? { express_style: ttsExpressStyleRef.current }
            : {}),
          ...(ttsEmotionHintRef.current ? { emotion_hint: ttsEmotionHintRef.current } : {}),
        }),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        logVoiceState('tts_fetch_abort', { generation });
        return null;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Voice timed out — check backend and Azure Speech');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!isActiveSpeakGeneration(generation)) return null;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `TTS failed (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    if (!isActiveSpeakGeneration(generation)) return null;

    if (buffer.byteLength < 100) {
      throw new Error('TTS returned empty or invalid audio');
    }

    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) {
      throw new Error('No cache directory for audio (unsupported platform)');
    }

    const b64 = bytesToBase64(new Uint8Array(buffer));
    const path = `${cacheDir}azure-tts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.mp3`;

    await FileSystem.writeAsStringAsync(path, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (options?.markFetchDone) {
      markVoiceTiming(voiceTurnTimingRef.current, 'first_tts_fetch_done');
    }

    logVoiceState('tts_fetch_done', { generation });
    return path;
  };

  const playTtsClip = async (
    path: string,
    generation: number,
    options?: { betweenClips?: boolean },
  ): Promise<void> => {
    let sound: Audio.Sound | null = null;
    if (!options?.betweenClips) {
      if (recordingRef.current || conversationBargeRecordingRef.current) {
        await releaseAllActiveRecorders();
      }
      await prepareForTtsPlayback();
    }
    try {

      const created = await Audio.Sound.createAsync(
        { uri: path },
        {
          shouldPlay: false,
          isLooping: false,
          volume: 1.0,
          isMuted: false,
          rate: 1.0,
          shouldCorrectPitch: true,
        },
      );
      sound = created.sound;

      if (!isActiveSpeakGeneration(generation)) {
        await sound.unloadAsync();
        return;
      }

      activeSoundRef.current = sound;
      logVoiceState('tts_play_start', { generation });
      logVoiceSnapshot('play_start', { generation });
      await sound.setVolumeAsync(1.0);

      let settled = false;
      await new Promise<void>((resolve, reject) => {
        let interruptPollId: ReturnType<typeof setInterval> | null = null;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (interruptPollId) clearInterval(interruptPollId);
          try {
            sound!.setOnPlaybackStatusUpdate(null);
          } catch {
            // ignore
          }
          logVoiceSnapshot('play_settle');
          fn();
        };

        const timeoutId = setTimeout(() => {
          settle(() => reject(new Error('Playback timeout — try again or check device volume')));
        }, 45_000);

        const checkFinished = (
          status: Awaited<ReturnType<Audio.Sound['getStatusAsync']>>,
        ) => {
          if (!isActiveSpeakGeneration(generation)) {
            settle(() => resolve());
            return;
          }
          if (activeSoundRef.current !== sound) {
            settle(() => resolve());
            return;
          }
          if (!status.isLoaded) return;
          if ('error' in status && status.error) {
            settle(() => reject(new Error(String(status.error))));
            return;
          }
          if (status.didJustFinish) {
            settle(() => resolve());
            return;
          }
          const duration = status.durationMillis ?? 0;
          const position = status.positionMillis ?? 0;
          if (duration > 0 && position >= duration - 80) {
            settle(() => resolve());
          }
        };

        interruptPollId = setInterval(() => {
          if (!isActiveSpeakGeneration(generation) || activeSoundRef.current !== sound) {
            settle(() => resolve());
          }
        }, 100);

        sound!.setProgressUpdateIntervalAsync(250).catch(() => {});
        sound!.setOnPlaybackStatusUpdate(checkFinished);

        void sound!.playAsync().then(async () => {
          markVoiceChunkPlay(voiceTurnTimingRef.current);
          const status = await sound!.getStatusAsync();
          checkFinished(status);
        }).catch((e) => {
          settle(() => reject(e));
        });
      });

      const played = sound;
      await played.unloadAsync();
      if (activeSoundRef.current === played) activeSoundRef.current = null;
      sound = null;
    } finally {
      void FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      if (sound) {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore
        }
        if (activeSoundRef.current === sound) activeSoundRef.current = null;
      }
    }
  };

  const speakParts = async (parts: SpeakPart[]): Promise<boolean> => {
    if (parts.length === 0) return true;

    const generation = voiceSessionRef.current.speakGeneration;
    speakInFlightRef.current = true;

    try {
      if (iosSpeakerPrimedGenerationRef.current !== generation) {
        await primeIosSpeaker();
        iosSpeakerPrimedGenerationRef.current = generation;
      }

      let nextPathPromise: Promise<string | null> | null = prepareTtsClip(
        parts[0].text,
        generation,
        { markFetchDone: true },
      );

      for (let index = 0; index < parts.length; index += 1) {
        if (!isActiveSpeakGeneration(generation)) return true;

        let path: string | null;
        try {
          path = await nextPathPromise;
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Voice failed';
          setVoicePlaybackError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
          return false;
        }
        if (!path) {
          if (!isActiveSpeakGeneration(generation)) return true;
          return false;
        }

        if (index + 1 < parts.length) {
          nextPathPromise = prepareTtsClip(parts[index + 1].text, generation);
        } else {
          nextPathPromise = null;
        }

        try {
          await playTtsClip(path, generation, { betweenClips: index > 0 });
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Voice failed';
          setVoicePlaybackError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
          return false;
        }

        const pauseMs = utterancePauseMs(index, parts[index].text, parts.length);
        if (pauseMs > 0 && isActiveSpeakGeneration(generation)) {
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
        }
      }
      return true;
    } finally {
      speakInFlightRef.current = false;
      if (isActiveSpeakGeneration(generation)) {
        activeSoundRef.current = null;
      }
    }
  };

  const waitStreamTtsQueueIdle = async () => {
    await waitPlaybackFullyStopped();
  };

  const finishStreamTtsTurn = (turn: number) => {
    if (!isActiveVoiceTurn(turn)) return;
    stopConversationBargeIn();
    if (!conversationSessionRef.current || voiceInputModeRef.current !== 'conversation') {
      setVoicePhaseTransition('idle', { reason: 'stream_tts_done' });
      if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
    } else {
      setVoicePhaseTransition('idle', { reason: 'stream_tts_done' });
      resumeConversationListeningAfterTurn();
    }
  };

  const runTtsForReply = async (reply: string, turn: number) => {
    if (!isActiveVoiceTurn(turn) || !voiceEnabledRef.current || !reply.trim()) {
      if (isActiveVoiceTurn(turn)) releaseVoiceUi();
      return;
    }

    const streamTts = shouldStreamTtsWhileOpen(
      voiceEnabledRef.current,
      naturalVoiceEnabledRef.current,
      rhythmMetaRef.current,
    );

    /**
     * Stream TTS: onDone already flushed using streamTtsRawRef.
     * Do NOT flush again here — UI buffer may be formatted and re-queue the last sentence.
     */
    if (streamTts) {
      markVoiceTiming(voiceTurnTimingRef.current, 'final_tts_start');
      if (useSingleClipStreamTts(reply)) {
        voiceLog('run_tts_single_clip', { replyLen: reply.trim().length });
        await speakStreamReplyAsSingleClip(turn, voiceSessionRef.current.speakGeneration);
      }
      logVoiceSnapshot('before_wait_idle');
      await waitStreamTtsQueueIdle();
      logVoiceSnapshot('after_wait_idle');
      if (!isActiveVoiceTurn(turn)) return;
      serverSpeechChunksRef.current = null;
      finishStreamTtsTurn(turn);
      return;
    }

    markVoiceTiming(voiceTurnTimingRef.current, 'final_tts_start');

    const parts = buildSpeakParts(reply.trim(), false, serverSpeechChunksRef.current);
    serverSpeechChunksRef.current = null;

    if (parts.length === 0) {
      if (!conversationSessionRef.current || voiceInputModeRef.current !== 'conversation') {
        setVoicePhaseTransition('idle');
        if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
      } else {
        setVoicePhaseTransition('idle');
        resumeConversationListeningAfterTurn();
      }
      return;
    }

    if (!isActiveVoiceTurn(turn)) return;

    setVoicePlaybackError(null);
    setVoicePhaseTransition('speaking');
    const generation = voiceSessionRef.current.speakGeneration;

    await prepareForTtsPlayback();
    if (!isActiveVoiceTurn(turn)) return;
    const ok = await speakParts(parts);

    if (isActiveVoiceTurn(turn) && isActiveSpeakGeneration(generation)) {
      stopConversationBargeIn();
      if (ok) {
        if (!conversationSessionRef.current || voiceInputModeRef.current !== 'conversation') {
          setVoicePhaseTransition('idle');
          if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
        } else {
          setVoicePhaseTransition('idle');
          resumeConversationListeningAfterTurn();
        }
      } else {
        if (
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation'
        ) {
          setVoicePhaseTransition('idle');
          scheduleConversationListen();
        } else {
          releaseVoiceUi();
        }
      }
    }
  };

  const speakReply = async (text: string, options?: { forTest?: boolean }) => {
    if (!voiceEnabledRef.current || !text.trim()) return;
    if (voicePhaseRef.current !== 'idle') return;

    const parts = buildSpeakParts(text.trim(), options?.forTest === true);
    if (parts.length === 0) return;

    setVoicePlaybackError(null);
    setVoicePhaseTransition('speaking');
    const generation = voiceSessionRef.current.speakGeneration;
    await stopPlayback();
    await prepareForTtsPlayback();
    const ok = await speakParts(parts);
    if (isActiveSpeakGeneration(generation)) {
      if (ok) {
        setVoicePhaseTransition('idle', { reason: 'speak_reply_done' });
        prewarmVoiceMicIfIdle();
      } else {
        releaseVoiceUi('speak_reply_failed');
      }
    }
  };

  const onVoiceToggle = (enabled: boolean) => {
    setVoiceEnabled(enabled);
    voiceEnabledRef.current = enabled;
    if (!enabled) {
      void stopPlayback().catch(() => {});
      interruptAssistant();
    } else {
      prewarmVoiceMicIfIdle();
    }
  };

  useEffect(() => {
    return () => {
      stopConversationMetering();
      stopConversationBargeIn();
    };
  }, []);

  /** Recover from stuck assistant phases (missed interrupt, stale async). */
  useEffect(() => {
    const intervalId = setInterval(() => {
      const phase = voicePhaseRef.current;
      const stuckMs = Date.now() - phaseChangedAtRef.current;

      if (phase === 'interrupting' && stuckMs > INTERRUPTING_STUCK_MS) {
        logVoiceState('watchdog_interrupting', { stuckMs });
        releaseVoiceUi('watchdog_interrupting');
        if (
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation'
        ) {
          scheduleConversationListen(80);
        }
        return;
      }

      if (!isAssistantActivePhase(phase)) return;
      if (chatInFlightRef.current || speakInFlightRef.current) return;
      if (streamTtsDrainingRef.current || streamTtsQueueRef.current.length > 0) return;
      if (stuckMs < ASSISTANT_STUCK_MS) return;

      logVoiceState('watchdog_assistant_stuck', { phase, stuckMs });
      interruptAssistant({
        keepConversationSession: conversationSessionRef.current,
        resumeListening:
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation',
      });
    }, 2500);

    return () => clearInterval(intervalId);
  }, []);

  const onNaturalVoiceToggle = (enabled: boolean) => {
    setNaturalVoiceEnabled(enabled);
    naturalVoiceEnabledRef.current = enabled;
  };

  const processVoiceUtterance = async (
    uri: string,
    utteranceId: number,
    options?: { fromConversation?: boolean },
  ) => {
    if (utteranceId !== voiceUtteranceRef.current) return;
    if (voiceSendLockRef.current) return;

    voiceSendLockRef.current = true;
    const fromConversation =
      options?.fromConversation === true && conversationSessionRef.current;
    try {
      const transcript = await transcribeRecording(uri, API_BASE);
      voiceLog('stt_result', {
        fromConversation,
        len: transcript.length,
        preview:
          transcript.length > 60 ? `${transcript.slice(0, 57)}…` : transcript,
      });
      if (utteranceId !== voiceUtteranceRef.current) {
        if (fromConversation) {
          scheduleConversationListen(200);
        }
        return;
      }
      if (
        voicePhaseRef.current !== 'thinking' &&
        voicePhaseRef.current !== 'streaming'
      ) {
        if (fromConversation) {
          scheduleConversationListen(200);
        }
        return;
      }
      if (
      fromConversation &&
      (activeSoundRef.current ||
        streamTtsDrainingRef.current ||
        streamTtsQueueRef.current.length > 0 ||
        voicePhaseRef.current === 'speaking')
    ) {
      logVoiceState('stt_ignored_during_tts', {
        phase: voicePhaseRef.current,
      });
      scheduleConversationListen(400);
      return;
    }

    if (fromConversation && isLikelyAssistantEcho(transcript)) {
        logVoiceState('echo_suppressed', {
          preview:
            transcript.length > 48 ? `${transcript.slice(0, 45)}…` : transcript,
        });
        setVoiceInputError('Heard my own voice — speak again.');
        setVoicePhaseTransition('idle', { reason: 'echo_suppressed' });
        scheduleConversationListen(300);
        return;
      }
      if (!isSubstantiveTranscript(transcript)) {
        if (fromConversation) {
          setVoiceInputError('Didn’t catch that — try again.');
          setVoicePhaseTransition('idle');
          scheduleConversationListen(200);
        } else {
          setVoiceInputError(
            'Didn’t catch that — hold Mic a little longer, or say a short word like "why" clearly.',
          );
          setVoicePhaseTransition('idle');
          prewarmVoiceMicIfIdle();
        }
        return;
      }
      if (transcript === lastVoiceTranscriptRef.current) {
        if (fromConversation) {
          setVoiceInputError('Same as last message — say something new.');
          setVoicePhaseTransition('idle');
          scheduleConversationListen(200);
        }
        return;
      }
      lastVoiceTranscriptRef.current = transcript;
      await sendMessage(transcript);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice input failed';
      setVoiceInputError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
      if (!fromConversation) {
        setVoicePhaseTransition('idle');
        prewarmVoiceMicIfIdle();
      } else {
        setVoicePhaseTransition('idle');
        scheduleConversationListen(200);
      }
    } finally {
      voiceSendLockRef.current = false;
    }
  };

  const onMicPressIn = async () => {
    if (voiceInputModeRef.current === 'conversation') return;
    if (micPressRef.current) return;
    if (!voiceEnabledRef.current) {
      setVoiceInputError('Turn on voice to use the mic.');
      return;
    }

    micPressRef.current = true;
    setVoiceInputError(null);
    voiceUtteranceRef.current += 1;

    if (voicePhaseRef.current !== 'idle') {
      interruptAssistant();
    }

    const permitted = await ensureMicrophonePermission();
    if (!permitted) {
      micPressRef.current = false;
      setVoiceInputError('Microphone access is required to talk.');
      return;
    }

    if (!micPressRef.current) return;

    setVoicePhaseTransition('recording');

    try {
      const recording = await startPushToTalkRecording();
      if (!micPressRef.current || voicePhaseRef.current !== 'recording') {
        await recording.stopAndUnloadAsync();
        setVoicePhaseTransition('idle');
        prewarmVoiceMicIfIdle();
        return;
      }
      recordingRef.current = recording;
      recordingStartedAtRef.current = Date.now();
    } catch (err) {
      recordingRef.current = null;
      micPressRef.current = false;
      const msg = err instanceof Error ? err.message : 'Could not start recording';
      setVoiceInputError(msg);
      setVoicePhaseTransition('idle');
      prewarmVoiceMicIfIdle();
    }
  };

  const onMicPressOut = async () => {
    if (voiceInputModeRef.current === 'conversation') return;
    const wasPressed = micPressRef.current;
    micPressRef.current = false;

    if (voicePhaseRef.current !== 'recording') {
      const stray = recordingRef.current;
      recordingRef.current = null;
      recordingStartedAtRef.current = 0;
      if (stray) void stray.stopAndUnloadAsync().catch(() => {});
      return;
    }

    if (!wasPressed) {
      const stray = recordingRef.current;
      recordingRef.current = null;
      recordingStartedAtRef.current = 0;
      if (stray) void stray.stopAndUnloadAsync().catch(() => {});
      setVoicePhaseTransition('idle');
      prewarmVoiceMicIfIdle();
      return;
    }

    const utteranceId = ++voiceUtteranceRef.current;
    setVoicePhaseTransition('thinking', { reason: 'ptt_release' });

    const recording = recordingRef.current;
    recordingRef.current = null;
    const startedAt = recordingStartedAtRef.current;
    recordingStartedAtRef.current = 0;

    if (!recording) {
      setVoicePhaseTransition('idle');
      prewarmVoiceMicIfIdle();
      return;
    }

    const recordedMs = startedAt > 0 ? Date.now() - startedAt : 0;
    if (recordedMs < MIN_RECORDING_MS) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      setVoicePhaseTransition('idle');
      prewarmVoiceMicIfIdle();
      return;
    }

    try {
      const uri = await stopRecordingToUri(recording);
      void processVoiceUtterance(uri, utteranceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      setVoiceInputError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
      setVoicePhaseTransition('idle');
      prewarmVoiceMicIfIdle();
    }
  };

  const sendMessage = async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if (!text || chatInFlightRef.current) return;

    const fromVoice = messageText !== undefined;

    if (!fromVoice && voicePhaseRef.current === 'listening') {
      stopConversationListening();
    }

    if (voicePhaseRef.current === 'recording') {
      return;
    }
    if (
      voicePhaseRef.current === 'listening' &&
      fromVoice &&
      voiceInputModeRef.current !== 'conversation'
    ) {
      return;
    }

    if (fromVoice) {
      bumpTurn(voiceSessionRef.current, 'new_voice_message');
      bumpSpeakGeneration(voiceSessionRef.current, 'new_voice_message');
      bumpStreamHandlers(voiceSessionRef.current, 'new_voice_message');
      abortTtsFetches('new_voice_message');
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      streamVoiceBufferRef.current = '';
      pendingStreamTextRef.current = '';
      resetStreamTts();
      clearStreamUiFlush();
      await stopPlayback();
    } else {
      if (
        conversationSessionRef.current &&
        voiceInputModeRef.current === 'conversation'
      ) {
        interruptConversationAssistant();
      } else {
        interruptAssistant();
      }
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    }

    const turn = voiceSessionRef.current.turn;
    setVoiceLogContext(turn, voiceSessionRef.current.speakGeneration);
    voiceTurnTimingRef.current = createVoiceTurnTiming(turn);
    markVoiceTiming(voiceTurnTimingRef.current, 'send_start');
    voiceLog('send_message', {
      fromVoice,
      textLen: text.length,
      preview: text.length > 48 ? `${text.slice(0, 45)}…` : text,
    });
    logVoiceSnapshot('send_start');
    chatInFlightRef.current = true;

    if (
      voiceEnabledRef.current &&
      (voicePhaseRef.current === 'idle' ||
        voicePhaseRef.current === 'listening' ||
        voicePhaseRef.current === 'thinking')
    ) {
      setVoicePhaseTransition('thinking', { reason: 'send_message' });
    }

    const streamHandlerGen = voiceSessionRef.current.streamHandlerGen;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text,
    };
    const assistantId = `${Date.now()}-assistant`;
    activeAssistantIdRef.current = assistantId;
    streamVoiceBufferRef.current = '';
    streamTtsRawRef.current = '';
    pendingStreamTextRef.current = '';
    resetStreamTts();
    clearStreamUiFlush();
    rhythmMetaRef.current = null;
    serverSpeechChunksRef.current = null;
    ttsExpressStyleRef.current = null;
    ttsEmotionHintRef.current = null;

    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    ensureTtsAbortSignal();

    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);
    if (messageText === undefined) setInput('');
    setLoading(true);
    setIsStreaming(false);
    scrollToEnd();

    let streamFinished = false;
    let replyForTts = '';

    try {
      await streamChatMessage(
        API_URL,
        text,
        {
          onStart: (meta) => {
            if (abortController.signal.aborted) return;
            if (!isActiveStreamHandler(voiceSessionRef.current, streamHandlerGen)) return;
            if (!isActiveVoiceTurn(turn)) return;
            markVoiceTiming(voiceTurnTimingRef.current, 'stream_start');
            rhythmMetaRef.current = meta?.rhythm ?? null;
            setLoading(false);
            setIsStreaming(true);
            if (voiceEnabledRef.current) {
              setVoicePhaseTransition('streaming', { reason: 'stream_start' });
            }
            const ack = meta?.rhythm?.fast_ack;
            if (
              ack &&
              voiceEnabledRef.current &&
              !useConversationSingleClipTts() &&
              !fastAckAlreadyInReply(streamVoiceBufferRef.current, ack)
            ) {
              void playFastAckLine(ack, turn, voiceSessionRef.current.speakGeneration);
            }
          },
          onText: (chunk) => {
            if (abortController.signal.aborted) return;
            if (!isActiveStreamHandler(voiceSessionRef.current, streamHandlerGen)) return;
            if (!isActiveVoiceTurn(turn)) return;
            markVoiceTiming(voiceTurnTimingRef.current, 'first_token');
            streamVoiceBufferRef.current += chunk;
            streamTtsRawRef.current += chunk;
            appendAssistantChunk(chunk);
            if (
              !streamTtsDoneRef.current &&
              !useSingleClipStreamTts(streamTtsRawRef.current) &&
              shouldStreamTtsWhileOpen(
                voiceEnabledRef.current,
                naturalVoiceEnabledRef.current,
                rhythmMetaRef.current,
              )
            ) {
              feedIncrementalTtsFromStream(turn, voiceSessionRef.current.speakGeneration);
            }
          },
          onDoneMeta: (meta: ChatStreamDoneMeta) => {
            if (abortController.signal.aborted) return;
            if (!isActiveStreamHandler(voiceSessionRef.current, streamHandlerGen)) return;
            if (!isActiveVoiceTurn(turn)) return;
            ttsExpressStyleRef.current = meta.express_style ?? null;
            ttsEmotionHintRef.current = meta.emotion_hint ?? null;
            if (meta.speech_chunks?.length) {
              serverSpeechChunksRef.current = meta.speech_chunks;
            }
          },
          onDone: (reply) => {
            if (abortController.signal.aborted) return reply;
            if (!isActiveStreamHandler(voiceSessionRef.current, streamHandlerGen)) return reply;
            if (!isActiveVoiceTurn(turn)) return reply;
            if (streamFinished) return reply;
            streamFinished = true;
            streamTtsDoneRef.current = true;
            markVoiceTiming(voiceTurnTimingRef.current, 'stream_done');
            const rawReply = (reply || streamTtsRawRef.current || streamVoiceBufferRef.current).trim();
            voiceLog('stream_on_done', {
              rawLen: rawReply.length,
              singleClip: useSingleClipStreamTts(rawReply),
              preview:
                rawReply.length > 56 ? `${rawReply.slice(0, 53)}…` : rawReply,
            });
            logVoiceSnapshot('stream_on_done');
            streamTtsRawRef.current = rawReply;
            lastAssistantTtsTextRef.current = rawReply;
            if (
              shouldStreamTtsWhileOpen(
                voiceEnabledRef.current,
                naturalVoiceEnabledRef.current,
                rhythmMetaRef.current,
              ) &&
              !useSingleClipStreamTts(rawReply)
            ) {
              feedIncrementalTtsFromStream(
                turn,
                voiceSessionRef.current.speakGeneration,
                true,
              );
            }
            const displayReply = formatAssistantReply(rawReply);
            streamVoiceBufferRef.current = displayReply;
            pendingStreamTextRef.current = displayReply;
            clearStreamUiFlush();
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, text: displayReply, streaming: false }
                  : message,
              ),
            );
            setIsStreaming(false);
            scrollToEnd(false);
            replyForTts = rawReply;

            if (!voiceEnabledRef.current && fromVoice) {
              setVoicePhaseTransition('idle');
              prewarmVoiceMicIfIdle();
            }

            return displayReply;
          },
          onError: () => {
            // streamChatMessage rejects; do not throw from stream callbacks.
          },
        },
        abortController.signal,
        getDeviceTimezone(),
      );

      if (voiceEnabledRef.current && replyForTts.trim() && isActiveVoiceTurn(turn)) {
        await runTtsForReply(replyForTts, turn);
      } else if (
        voicePhaseRef.current === 'thinking' ||
        voicePhaseRef.current === 'streaming'
      ) {
        if (conversationSessionRef.current && voiceInputModeRef.current === 'conversation') {
          setVoicePhaseTransition('idle', { reason: 'no_tts_after_stream' });
          scheduleConversationListen();
        } else {
          releaseVoiceUi('no_tts_after_stream');
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        logVoiceState('stream_abort', { turn });
        finalizeInterruptedTurn(assistantId);
        ensureUiUnlocked();
        const keepConversation =
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation';
        if (!keepConversation) {
          releaseVoiceUi('stream_abort');
        } else {
          setVoicePhaseTransition('idle', { force: true, reason: 'stream_abort' });
          scheduleConversationListen(120);
        }
        return;
      }
      const errText =
        error instanceof Error ? error.message : 'Something went wrong';
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, text: `Error: ${errText}`, streaming: false }
            : item,
        ),
      );
      if (
        conversationSessionRef.current &&
        voiceInputModeRef.current === 'conversation'
      ) {
        setVoicePhaseTransition('idle');
        scheduleConversationListen();
      } else {
        releaseVoiceUi();
      }
    } finally {
      if (!isActiveVoiceTurn(turn)) {
        logVoiceState('send_message_stale_finally', { turn });
        return;
      }
      void fetchCompanionFromHealth().then((name) => {
        if (name) setCompanionName(name);
      });
      clearStreamUiFlush();
      chatInFlightRef.current = false;
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
      }
      activeAssistantIdRef.current = null;
      ensureUiUnlocked();
      if (
        (voicePhaseRef.current === 'thinking' ||
          voicePhaseRef.current === 'streaming') &&
        !speakInFlightRef.current &&
        streamTtsQueueRef.current.length === 0 &&
        !streamTtsDrainingRef.current
      ) {
        setVoicePhaseTransition('idle', { reason: 'send_finally_idle' });
        if (
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation'
        ) {
          scheduleConversationListen();
        }
      }
      if (!streamFinished && !abortController.signal.aborted) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId && message.streaming
              ? {
                  ...message,
                  streaming: false,
                  text: message.text.trim() || 'No response — try again.',
                }
              : message,
          ),
        );
      }
      logVoiceTurnSummary(voiceTurnTimingRef.current);
      logVoiceSnapshot('send_finally');
      voiceTurnTimingRef.current = null;
    }
  };

  const busy = loading || isStreaming;
  const voiceBusy =
    voicePhase !== 'idle' &&
    !(voicePhase === 'listening' && voiceInputMode === 'conversation');
  const inputLocked =
    busy ||
    voicePhase === 'thinking' ||
    voicePhase === 'streaming' ||
    voicePhase === 'speaking' ||
    voicePhase === 'interrupting' ||
    voicePhase === 'recording';
  const phaseLabel = voicePhaseLabel(voicePhase, isStreaming, conversationSession);
  const phaseHint = voicePhaseHint(voicePhase, isStreaming, conversationSession);
  const conversationCanInterrupt =
    voiceInputMode === 'conversation' &&
    conversationSession &&
    isAssistantActivePhase(voicePhase);
  const micShowSpinner =
    voicePhase === 'thinking' ||
    voicePhase === 'streaming' ||
    (busy && voicePhase !== 'recording' && voicePhase !== 'listening');
  const micConversationActive =
    voiceInputMode === 'conversation' &&
    (conversationSession || voicePhase === 'listening');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>{companionName}</Text>
        <Text style={styles.nameHint}>Say &quot;call you …&quot; to rename her</Text>
        <View style={styles.voiceRow}>
          <Text style={styles.voiceLabel}>Enable voice</Text>
          <Switch
            value={voiceEnabled}
            onValueChange={onVoiceToggle}
            trackColor={{ false: '#cccccc', true: '#007aff' }}
            thumbColor="#ffffff"
          />
        </View>
        <View style={[styles.voiceRow, !voiceEnabled && styles.voiceRowDisabled]}>
          <Text style={[styles.voiceLabel, !voiceEnabled && styles.voiceLabelDisabled]}>
            Voice tone
          </Text>
          <View style={styles.voiceToneRow}>
            <Text
              style={[
                styles.voiceToneChip,
                voiceGender === 'female' && styles.voiceToneChipActive,
                !voiceEnabled && styles.voiceToneChipDisabled,
              ]}
              onPress={() => voiceEnabled && setVoiceGender('female')}
            >
              Female
            </Text>
            <Text
              style={[
                styles.voiceToneChip,
                voiceGender === 'male' && styles.voiceToneChipActive,
                !voiceEnabled && styles.voiceToneChipDisabled,
              ]}
              onPress={() => voiceEnabled && setVoiceGender('male')}
            >
              Male
            </Text>
          </View>
        </View>
        <View style={[styles.voiceRow, !voiceEnabled && styles.voiceRowDisabled]}>
          <Text style={[styles.voiceLabel, !voiceEnabled && styles.voiceLabelDisabled]}>
            Mic mode
          </Text>
          <View style={styles.voiceToneRow}>
            <Text
              style={[
                styles.voiceToneChip,
                voiceInputMode === 'ptt' && styles.voiceToneChipActive,
                !voiceEnabled && styles.voiceToneChipDisabled,
              ]}
              onPress={() => voiceEnabled && onVoiceInputModeChange('ptt')}
            >
              Push-to-talk
            </Text>
            <Text
              style={[
                styles.voiceToneChip,
                voiceInputMode === 'conversation' && styles.voiceToneChipActive,
                !voiceEnabled && styles.voiceToneChipDisabled,
              ]}
              onPress={() => voiceEnabled && onVoiceInputModeChange('conversation')}
            >
              Conversation
            </Text>
          </View>
        </View>
        <View style={[styles.voiceRow, !voiceEnabled && styles.voiceRowDisabled]}>
          <Text style={[styles.voiceLabel, !voiceEnabled && styles.voiceLabelDisabled]}>
            Shorter replies (2 sentences max)
          </Text>
          <Switch
            value={naturalVoiceEnabled}
            onValueChange={onNaturalVoiceToggle}
            disabled={!voiceEnabled}
            trackColor={{ false: '#cccccc', true: '#007aff' }}
            thumbColor="#ffffff"
          />
        </View>
        {voiceEnabled ? (
          <Pressable
            onPress={() => {
              if (conversationCanInterrupt) {
                interruptConversationAssistant();
              }
            }}
            disabled={!conversationCanInterrupt}
            style={({ pressed }) => [
              styles.voiceStatusBar,
              conversationCanInterrupt && pressed && styles.voiceStatusBarPressable,
            ]}
          >
            <View
              style={[
                styles.voiceStatusDot,
                (voicePhase === 'recording' || voicePhase === 'listening') &&
                  styles.voiceStatusDotRecording,
                (voicePhase === 'thinking' || voicePhase === 'streaming') &&
                  (isStreaming
                    ? styles.voiceStatusDotGenerating
                    : styles.voiceStatusDotProcessing),
                voicePhase === 'speaking' && styles.voiceStatusDotSpeaking,
                voicePhase === 'interrupting' && styles.voiceStatusDotProcessing,
              ]}
            />
            <View style={styles.voiceStatusText}>
              <Text style={styles.voiceStatusLabel}>{phaseLabel}</Text>
              <Text style={styles.voiceStatusHint}>{phaseHint}</Text>
              <Text style={styles.clockTzHint}>
                {deviceTimezone
                  ? `Your clock: ${deviceTimezone}`
                  : 'Clock zone not detected — restart app; server fallback may be wrong'}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {voiceEnabled ? (
          <TouchableOpacity
            onPress={() => {
              if (voicePhase !== 'idle' || isStreaming || busy) {
                if (conversationCanInterrupt) {
                  interruptConversationAssistant();
                } else {
                  interruptAssistant();
                }
                return;
              }
              void speakReply('Hello. Voice is working.', { forTest: true }).catch(() => {
                releaseVoiceUi();
              });
            }}
          >
            <Text style={styles.voiceHint}>
              {voicePlaybackError
                ? `Voice error: ${voicePlaybackError} · tap to reset`
                : conversationCanInterrupt
                  ? voicePhase === 'speaking'
                    ? 'Speaking… tap Mic to interrupt'
                    : 'Thinking… tap Mic to interrupt, then speak'
                  : voicePhase === 'speaking'
                    ? 'Speaking… tap to stop'
                    : isStreaming ||
                      voicePhase === 'thinking' ||
                      voicePhase === 'streaming'
                      ? 'Working… tap to stop'
                      : voiceInputMode === 'conversation'
                        ? `${formatVoiceStatusLine(voiceName)} · Tap Mic to start conversation`
                        : `${formatVoiceStatusLine(voiceName)} · Tap to test · Hold Mic below to talk`}
            </Text>
          </TouchableOpacity>
        ) : null}
        {voiceInputError ? (
          <Text style={styles.voiceError}>Voice: {voiceInputError}</Text>
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => scrollToEnd(false)}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.assistantBubble,
              item.streaming ? styles.streamingBubble : null,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                item.role === 'user' ? styles.userText : styles.assistantText,
              ]}
            >
              {item.streaming && !item.text ? '…' : item.text}
              {item.streaming && item.text ? ' ▋' : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Say hello to {companionName}.</Text>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.inputRow}>
          <Pressable
            style={({ pressed }) => [
              styles.micButton,
              ((voicePhase === 'recording' ||
                voicePhase === 'listening' ||
                micConversationActive) ||
                pressed) &&
                styles.micButtonActive,
              !voiceEnabled && styles.micButtonDisabled,
            ]}
            onPressIn={() => {
              if (!voiceEnabled || voiceInputMode === 'conversation') return;
              void onMicPressIn().catch(() => {});
            }}
            onPressOut={() => {
              if (voiceInputMode === 'conversation') return;
              void onMicPressOut().catch(() => {});
            }}
            onPress={() => {
              if (voiceInputMode !== 'conversation') return;
              onConversationMicPress();
            }}
            disabled={!voiceEnabled}
          >
            {micShowSpinner ? (
              <ActivityIndicator color="#007aff" size="small" />
            ) : (
              <Text style={styles.micLabel}>
                {voicePhase === 'listening' &&
                voiceInputMode === 'conversation' &&
                conversationSession
                  ? 'Stop'
                  : voicePhase === 'recording' || voicePhase === 'listening'
                    ? '···'
                    : voiceInputMode === 'conversation' && conversationSession
                      ? voicePhase === 'idle'
                        ? 'Listen'
                        : '···'
                      : voiceInputMode === 'conversation'
                        ? 'Start'
                        : 'Mic'}
              </Text>
            )}
          </Pressable>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            onFocus={() => {
              if (voicePhaseRef.current === 'listening') {
                stopConversationListening();
              }
            }}
            placeholder={
              voicePhase === 'listening'
                ? 'Listening…'
                : voicePhase === 'recording'
                  ? 'Recording…'
                  : voicePhase === 'thinking' || voicePhase === 'streaming'
                    ? conversationSession
                      ? 'Thinking…'
                      : 'Processing…'
                    : voicePhase === 'speaking'
                      ? 'Speaking…'
                      : voiceInputMode === 'conversation'
                        ? conversationSession
                          ? voicePhase === 'idle'
                            ? 'Tap Mic (Listen) · or type below'
                            : 'Type below anytime'
                          : 'Type or tap Mic to converse'
                        : 'Type or hold Mic to talk'
            }
            placeholderTextColor="#888888"
            multiline
            editable={!inputLocked}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (loading ||
                voicePhase === 'thinking' ||
                voicePhase === 'streaming') &&
                styles.sendDisabled,
            ]}
            onPress={() => void sendMessage().catch(() => {})}
            disabled={
              voicePhase === 'recording' ||
              (voicePhase === 'listening' && !input.trim()) ||
              !input.trim()
            }
          >
            {loading &&
            voicePhase !== 'thinking' &&
            voicePhase !== 'streaming' ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.sendLabel}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 4,
  },
  nameHint: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 8,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  voiceRowDisabled: {
    opacity: 0.45,
  },
  voiceLabel: { fontSize: 16, color: '#000000' },
  voiceLabelDisabled: { color: '#888888' },
  voiceToneRow: { flexDirection: 'row', gap: 8 },
  voiceToneChip: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#e8e8e8',
    color: '#333333',
  },
  voiceToneChipActive: { backgroundColor: '#007aff', color: '#ffffff', fontWeight: '600' },
  voiceToneChipDisabled: { opacity: 0.45 },
  voiceHint: { fontSize: 12, color: '#666666', marginTop: 6 },
  voiceStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dddddd',
  },
  voiceStatusBarPressable: {
    backgroundColor: '#f0f7ff',
    borderColor: '#007aff',
  },
  voiceStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#9e9e9e',
    marginRight: 10,
  },
  voiceStatusDotRecording: { backgroundColor: '#d32f2f' },
  voiceStatusDotProcessing: { backgroundColor: '#f57c00' },
  voiceStatusDotGenerating: { backgroundColor: '#7b1fa2' },
  voiceStatusDotSpeaking: { backgroundColor: '#007aff' },
  voiceStatusText: { flex: 1 },
  voiceStatusLabel: { fontSize: 14, fontWeight: '600', color: '#000000' },
  voiceStatusHint: { fontSize: 12, color: '#666666', marginTop: 2 },
  clockTzHint: { fontSize: 11, color: '#888888', marginTop: 4 },
  voiceError: { fontSize: 12, color: '#c62828', marginTop: 4 },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#007aff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  micButtonActive: {
    backgroundColor: '#e3f2fd',
    borderColor: '#0056b3',
  },
  micButtonDisabled: {
    opacity: 0.45,
  },
  micLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007aff',
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 8 },
  empty: {
    color: '#666666',
    textAlign: 'center',
    marginTop: 24,
    fontSize: 16,
  },
  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  streamingBubble: {
    borderColor: '#007aff',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#007aff',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dddddd',
  },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  userText: { color: '#ffffff' },
  assistantText: { color: '#000000' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 8,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#dddddd',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#000000',
    backgroundColor: '#ffffff',
  },
  sendButton: {
    backgroundColor: '#007aff',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.6 },
  sendLabel: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
});
