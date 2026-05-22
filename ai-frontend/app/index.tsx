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
  configureConversationBargeInAudioMode,
  configurePlaybackAudioMode,
  discardPrewarm,
  ensureMicrophonePermission,
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
  BARGE_IN_TTS_GRACE_MS,
  createBargeInMeterState,
  createConversationMeterState,
  METERING_INTERVAL_MS,
  tickConversationBargeIn,
  tickConversationMeter,
  type BargeInMeterState,
  type ConversationMeterState,
} from '../lib/conversationMode';
import {
  buildSpeechUtterances,
  formatReplyForUi,
  pauseBetweenUtterances,
  MAX_SPOKEN_CHARS,
  MAX_SPOKEN_CHARS_CASUAL,
  MAX_SPOKEN_SENTENCES,
  MAX_SPOKEN_SENTENCES_CASUAL,
  replyTrimOptions,
  trimReplyForDisplay,
  type SpeechTrimOptions,
} from '../lib/speechPlayback';
import { isAbortError } from '../lib/abortError';
import { streamChatMessage, type ChatStreamDoneMeta } from '../lib/chatStream';
import {
  buildFinalTtsUtterances,
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
  canEnterPhase,
  voicePhaseHint,
  voicePhaseLabel,
  type VoicePhase,
} from '../lib/voiceFlow';

/** LAN URL of the FastAPI backend (same Wi‑Fi as the phone). Override in `.env`: EXPO_PUBLIC_API_BASE */
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.178:8000';
const API_URL = `${API_BASE}/chat`;
const TTS_URL = `${API_BASE}/tts`;

/** Mid-stream TTS can stack failures (e.g. Azure 400) and lock the UI in Speaking. */
const STREAM_TTS_WHILE_OPEN = false;
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
  const speakGenerationRef = useRef(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const streamVoiceBufferRef = useRef('');
  const speakInFlightRef = useRef(false);
  const chatInFlightRef = useRef(false);
  const voiceTurnRef = useRef(0);
  const pendingStreamTextRef = useRef('');
  const streamUiFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTtsStateRef = useRef<IncrementalTtsState>(createIncrementalTtsState());
  const streamTtsQueueRef = useRef<string[]>([]);
  const streamTtsDrainingRef = useRef(false);
  const streamTtsDoneRef = useRef(false);

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
    if (voiceEnabled) prewarmRecordingPipeline();
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

  const setVoicePhaseTransition = (next: VoicePhase) => {
    const prev = voicePhaseRef.current;
    if (!canEnterPhase(prev, next)) {
      return false;
    }
    voicePhaseRef.current = next;
    setVoicePhase(next);
    return true;
  };

  const stopConversationMetering = () => {
    if (conversationMeterRef.current) {
      clearInterval(conversationMeterRef.current);
      conversationMeterRef.current = null;
    }
    conversationMeterStateRef.current = null;
  };

  const stopConversationBargeIn = () => {
    conversationBargeGenRef.current += 1;
    if (conversationBargeMeterRef.current) {
      clearInterval(conversationBargeMeterRef.current);
      conversationBargeMeterRef.current = null;
    }
    conversationBargeStateRef.current = null;
    conversationBargeGraceUntilRef.current = 0;
    const rec = conversationBargeRecordingRef.current;
    conversationBargeRecordingRef.current = null;
    if (rec) void rec.stopAndUnloadAsync().catch(() => {});
  };

  const refreshConversationBargeInGrace = (forTts = false) => {
    const graceMs = forTts ? BARGE_IN_TTS_GRACE_MS : BARGE_IN_GRACE_MS;
    conversationBargeGraceUntilRef.current = Date.now() + graceMs;
    conversationBargeStateRef.current = createBargeInMeterState();
  };

  const startConversationBargeIn = async (options?: { forTts?: boolean }) => {
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
            stopConversationBargeIn();
            interruptConversationAssistant();
          }
        })();
      }, METERING_INTERVAL_MS);
    } catch {
      if (bargeGen === conversationBargeGenRef.current) {
        stopConversationBargeIn();
      }
    }
  };

  const endConversationSession = () => {
    conversationListenGenRef.current += 1;
    conversationSessionRef.current = false;
    setConversationSession(false);
    stopConversationBargeIn();
    stopConversationMetering();
    const rec = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    if (voicePhaseRef.current === 'listening') {
      setVoicePhaseTransition('idle');
      if (voiceEnabledRef.current) prewarmRecordingPipeline();
    }
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
    if (!setVoicePhaseTransition('processing')) {
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      return;
    }

    try {
      const uri = await stopRecordingToUri(recording);
      void processVoiceUtterance(uri, utteranceId, { fromConversation: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      setVoiceInputError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
      if (conversationSessionRef.current) {
        void startConversationListening();
      } else {
        setVoicePhaseTransition('idle');
        prewarmRecordingPipeline();
      }
    }
  };

  /** Resume listen loop after a conversation voice turn (call after voiceSendLock is cleared). */
  const resumeConversationListeningAfterTurn = () => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return;
    }
    if (chatInFlightRef.current || voiceSendLockRef.current) {
      return;
    }
    const phase = voicePhaseRef.current;
    if (
      phase !== 'idle' &&
      phase !== 'speaking' &&
      phase !== 'processing'
    ) {
      return;
    }
    void startConversationListening({ resumeAfterInterrupt: true });
  };

  const startConversationListening = async (options?: {
    /** After interrupt or failed transcript — allow processing → listening. */
    resumeAfterInterrupt?: boolean;
  }) => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return;
    }
    const phase = voicePhaseRef.current;
    if (options?.resumeAfterInterrupt) {
      if (phase !== 'idle' && phase !== 'speaking' && phase !== 'processing') {
        return;
      }
    } else if (phase !== 'idle' && phase !== 'speaking') {
      return;
    }
    if (chatInFlightRef.current || voiceSendLockRef.current) {
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
      return;
    }

    try {
      const recording = await startConversationRecording();
      if (listenGen !== conversationListenGenRef.current || !conversationSessionRef.current) {
        await recording.stopAndUnloadAsync();
        return;
      }

      recordingRef.current = recording;
      recordingStartedAtRef.current = Date.now();
      conversationMeterStateRef.current = createConversationMeterState();

      conversationMeterRef.current = setInterval(() => {
        void (async () => {
          if (listenGen !== conversationListenGenRef.current) return;
          if (!recordingRef.current || voicePhaseRef.current !== 'listening') return;

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
            prewarmRecordingPipeline();
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not start listening';
      setVoiceInputError(msg);
      endConversationSession();
      prewarmRecordingPipeline();
    }
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
    void startConversationListening();
  };

  const interruptConversationAssistant = () => {
    interruptAssistant({
      keepConversationSession: true,
      resumeListening: true,
    });
  };

  const onConversationMicPress = () => {
    if (!voiceEnabledRef.current) {
      setVoiceInputError('Turn on voice to use the mic.');
      return;
    }

    if (voicePhaseRef.current === 'processing' || voicePhaseRef.current === 'speaking') {
      interruptConversationAssistant();
      return;
    }

    if (conversationSessionRef.current) {
      endConversationSession();
      if (voicePhaseRef.current !== 'idle') {
        interruptAssistant();
      }
      prewarmRecordingPipeline();
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
    resetIncrementalTtsState(streamTtsStateRef.current);
  };

  const ensureUiUnlocked = () => {
    setLoading(false);
    setIsStreaming(false);
  };

  const releaseVoiceUi = () => {
    streamTtsQueueRef.current = [];
    streamTtsDrainingRef.current = false;
    streamTtsDoneRef.current = false;
    resetStreamTts();
    chatInFlightRef.current = false;
    ensureUiUnlocked();
    voicePhaseRef.current = 'idle';
    setVoicePhase('idle');
    if (voiceEnabledRef.current) prewarmRecordingPipeline();
  };

  const maybeFinishStreamTtsIdle = (turn: number, generation: number) => {
    if (turn !== voiceTurnRef.current || generation !== speakGenerationRef.current) return;
    if (!streamTtsDoneRef.current) return;
    if (streamTtsDrainingRef.current || streamTtsQueueRef.current.length > 0) return;
    setVoicePhaseTransition('idle');
    if (voiceEnabledRef.current) prewarmRecordingPipeline();
  };

  const drainStreamTtsQueue = async (turn: number, generation: number) => {
    if (streamTtsDrainingRef.current) return;
    streamTtsDrainingRef.current = true;

    try {
      while (streamTtsQueueRef.current.length > 0) {
        if (turn !== voiceTurnRef.current || generation !== speakGenerationRef.current) return;

        setVoicePlaybackError(null);
        setVoicePhaseTransition('speaking');
        const text = streamTtsQueueRef.current.shift()!;
        const ok = await speakParts([{ text }]);
        if (!ok) {
          streamTtsQueueRef.current = [];
          releaseVoiceUi();
          return;
        }
      }
    } finally {
      streamTtsDrainingRef.current = false;
      if (streamTtsQueueRef.current.length > 0) {
        void drainStreamTtsQueue(turn, generation);
      } else {
        maybeFinishStreamTtsIdle(turn, generation);
      }
    }
  };

  const enqueueStreamTtsChunks = (chunks: string[], turn: number, generation: number) => {
    if (!voiceEnabledRef.current || chunks.length === 0) return;
    if (turn !== voiceTurnRef.current || generation !== speakGenerationRef.current) return;
    streamTtsQueueRef.current.push(...chunks);
    void drainStreamTtsQueue(turn, generation);
  };

  const feedIncrementalTtsFromStream = (
    turn: number,
    generation: number,
    flush = false,
  ) => {
    if (!voiceEnabledRef.current) return;
    const chunks = pullSpeakableChunks(
      streamTtsStateRef.current,
      streamVoiceBufferRef.current,
      flush,
    );
    enqueueStreamTtsChunks(chunks, turn, generation);
  };

  const interruptAssistant = (options?: {
    keepConversationSession?: boolean;
    resumeListening?: boolean;
  }) => {
    if (!options?.keepConversationSession) {
      endConversationSession();
    } else {
      conversationListenGenRef.current += 1;
      stopConversationBargeIn();
      stopConversationMetering();
      const rec = recordingRef.current;
      recordingRef.current = null;
      recordingStartedAtRef.current = 0;
      if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    }

    voiceUtteranceRef.current += 1;
    voiceTurnRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    speakGenerationRef.current += 1;
    streamVoiceBufferRef.current = '';
    pendingStreamTextRef.current = '';
    resetStreamTts();
    clearStreamUiFlush();
    voiceSendLockRef.current = false;
    lastVoiceTranscriptRef.current = '';
    micPressRef.current = false;
    chatInFlightRef.current = false;
    ensureUiUnlocked();
    void stopPlayback().catch(() => {});
    void discardPrewarm();

    const resumeConversation =
      options?.keepConversationSession &&
      options?.resumeListening !== false &&
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation' &&
      voiceEnabledRef.current;

    if (resumeConversation) {
      void startConversationListening({ resumeAfterInterrupt: true });
    } else {
      voicePhaseRef.current = 'idle';
      setVoicePhase('idle');
      if (voiceEnabledRef.current) prewarmRecordingPipeline();
    }
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
    if (conversationBargeRecordingRef.current) {
      await configureConversationBargeInAudioMode();
    } else {
      await configurePlaybackAudioMode();
    }
    const sound = primeSoundRef.current;
    if (!sound) return;
    try {
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

  const buildSpeakParts = (mainText: string, forTest: boolean): SpeakPart[] => {
    const trim = replyTrim(forTest) ?? {
      maxSentences: MAX_SPOKEN_SENTENCES,
      maxChars: MAX_SPOKEN_CHARS,
    };
    const utterances = buildSpeechUtterances(mainText, trim);
    return utterances.filter(Boolean).map((text) => ({ text }));
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
  ): Promise<string | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          style: 'default',
          voice_gender: voiceGenderRef.current,
          ...(ttsExpressStyleRef.current
            ? { express_style: ttsExpressStyleRef.current }
            : {}),
          ...(ttsEmotionHintRef.current ? { emotion_hint: ttsEmotionHintRef.current } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Voice timed out — check backend and Azure Speech');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (generation !== speakGenerationRef.current) return null;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `TTS failed (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    if (generation !== speakGenerationRef.current) return null;

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

    return path;
  };

  const playTtsClip = async (path: string, generation: number): Promise<void> => {
    let sound: Audio.Sound | null = null;
    try {
      const created = await Audio.Sound.createAsync(
        { uri: path },
        { shouldPlay: false, volume: 1.0, isMuted: false },
      );
      sound = created.sound;

      if (generation !== speakGenerationRef.current) {
        await sound.unloadAsync();
        return;
      }

      activeSoundRef.current = sound;

      let settled = false;
      await new Promise<void>((resolve, reject) => {
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          fn();
        };

        const timeoutId = setTimeout(() => {
          settle(() => reject(new Error('Playback timeout — try again or check device volume')));
        }, 45_000);

        const checkFinished = (status: Audio.AVPlaybackStatus) => {
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

        sound!.setProgressUpdateIntervalAsync(250).catch(() => {});
        sound!.setOnPlaybackStatusUpdate(checkFinished);

        void sound!.playAsync().then(async () => {
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

    const generation = speakGenerationRef.current;
    speakInFlightRef.current = true;

    try {
      void primeIosSpeaker();

      let nextPathPromise: Promise<string | null> | null = prepareTtsClip(
        parts[0].text,
        generation,
      );

      for (let index = 0; index < parts.length; index += 1) {
        if (generation !== speakGenerationRef.current) return true;

        let path: string | null;
        try {
          path = await nextPathPromise;
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Voice failed';
          setVoicePlaybackError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
          return false;
        }
        if (!path) return false;

        if (index + 1 < parts.length) {
          nextPathPromise = prepareTtsClip(parts[index + 1].text, generation);
        } else {
          nextPathPromise = null;
        }

        try {
          await playTtsClip(path, generation);
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : typeof err === 'string' ? err : 'Voice failed';
          setVoicePlaybackError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
          return false;
        }

        const pauseMs = pauseBetweenUtterances(index + 1 < parts.length);
        if (pauseMs > 0 && generation === speakGenerationRef.current) {
          await new Promise((resolve) => setTimeout(resolve, pauseMs));
        }
      }
      return true;
    } finally {
      speakInFlightRef.current = false;
      if (generation === speakGenerationRef.current) {
        activeSoundRef.current = null;
      }
    }
  };

  const runTtsForReply = async (reply: string, turn: number) => {
    if (turn !== voiceTurnRef.current || !voiceEnabledRef.current || !reply.trim()) {
      if (turn === voiceTurnRef.current) releaseVoiceUi();
      return;
    }

    const parts = buildSpeakParts(reply.trim(), false);
    if (parts.length === 0) {
      if (!conversationSessionRef.current || voiceInputModeRef.current !== 'conversation') {
        setVoicePhaseTransition('idle');
        if (voiceEnabledRef.current) prewarmRecordingPipeline();
      } else {
        setVoicePhaseTransition('idle');
        resumeConversationListeningAfterTurn();
      }
      return;
    }

    setVoicePlaybackError(null);
    setVoicePhaseTransition('speaking');
    const generation = speakGenerationRef.current;

    if (
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation'
    ) {
      await startConversationBargeIn({ forTts: true });
      await configureConversationBargeInAudioMode();
    } else {
      void configurePlaybackAudioMode();
    }
    const ok = await speakParts(parts);

    if (generation === speakGenerationRef.current) {
      stopConversationBargeIn();
      if (ok) {
        if (!conversationSessionRef.current || voiceInputModeRef.current !== 'conversation') {
          setVoicePhaseTransition('idle');
          if (voiceEnabledRef.current) prewarmRecordingPipeline();
        } else {
          setVoicePhaseTransition('idle');
          resumeConversationListeningAfterTurn();
        }
      } else {
        releaseVoiceUi();
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
    const generation = speakGenerationRef.current;
    await stopPlayback();
    await configurePlaybackAudioMode();
    const ok = await speakParts(parts);
    if (generation === speakGenerationRef.current) {
      if (ok) {
        setVoicePhaseTransition('idle');
        prewarmRecordingPipeline();
      } else {
        releaseVoiceUi();
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
      prewarmRecordingPipeline();
    }
  };

  useEffect(() => {
    return () => {
      stopConversationMetering();
      stopConversationBargeIn();
    };
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
    try {
      const transcript = await transcribeRecording(uri, API_BASE);
      if (utteranceId !== voiceUtteranceRef.current) return;
      if (voicePhaseRef.current !== 'processing') return;
      if (!isSubstantiveTranscript(transcript)) {
        if (options?.fromConversation && conversationSessionRef.current) {
          setVoiceInputError('Didn’t catch that — try again.');
          setVoicePhaseTransition('idle');
        } else {
          setVoiceInputError(
            'Didn’t catch that — hold Mic a little longer, or say a short word like "why" clearly.',
          );
          setVoicePhaseTransition('idle');
          prewarmRecordingPipeline();
        }
        return;
      }
      if (transcript === lastVoiceTranscriptRef.current) {
        return;
      }
      lastVoiceTranscriptRef.current = transcript;
      await sendMessage(transcript);
    } catch (err) {
      if (utteranceId !== voiceUtteranceRef.current) return;
      const msg = err instanceof Error ? err.message : 'Voice input failed';
      setVoiceInputError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
      if (!options?.fromConversation || !conversationSessionRef.current) {
        setVoicePhaseTransition('idle');
        prewarmRecordingPipeline();
      }
    } finally {
      if (utteranceId === voiceUtteranceRef.current) {
        voiceSendLockRef.current = false;
        if (options?.fromConversation) {
          resumeConversationListeningAfterTurn();
        }
      }
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
        prewarmRecordingPipeline();
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
      prewarmRecordingPipeline();
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
      prewarmRecordingPipeline();
      return;
    }

    const utteranceId = ++voiceUtteranceRef.current;
    setVoicePhaseTransition('processing');

    const recording = recordingRef.current;
    recordingRef.current = null;
    const startedAt = recordingStartedAtRef.current;
    recordingStartedAtRef.current = 0;

    if (!recording) {
      setVoicePhaseTransition('idle');
      prewarmRecordingPipeline();
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
      prewarmRecordingPipeline();
      return;
    }

    try {
      const uri = await stopRecordingToUri(recording);
      void processVoiceUtterance(uri, utteranceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recording failed';
      setVoiceInputError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
      setVoicePhaseTransition('idle');
      prewarmRecordingPipeline();
    }
  };

  const sendMessage = async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if (!text || chatInFlightRef.current) return;
    if (voicePhaseRef.current === 'recording' || voicePhaseRef.current === 'listening') {
      return;
    }

    const fromVoice = messageText !== undefined;

    if (fromVoice) {
      voiceTurnRef.current += 1;
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      speakGenerationRef.current += 1;
      streamVoiceBufferRef.current = '';
      pendingStreamTextRef.current = '';
      resetStreamTts();
      clearStreamUiFlush();
      await stopPlayback();
    } else {
      interruptAssistant();
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    }

    const turn = voiceTurnRef.current;
    chatInFlightRef.current = true;

    if (voiceEnabledRef.current && voicePhaseRef.current === 'idle') {
      setVoicePhaseTransition('processing');
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text,
    };
    const assistantId = `${Date.now()}-assistant`;
    activeAssistantIdRef.current = assistantId;
    streamVoiceBufferRef.current = '';
    pendingStreamTextRef.current = '';
    resetStreamTts();
    clearStreamUiFlush();
    ttsExpressStyleRef.current = null;
    ttsEmotionHintRef.current = null;

    const abortController = new AbortController();
    chatAbortRef.current = abortController;

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
          onStart: () => {
            if (abortController.signal.aborted) return;
            setLoading(false);
            setIsStreaming(true);
          },
          onText: (chunk) => {
            if (abortController.signal.aborted) return;
            streamVoiceBufferRef.current += chunk;
            appendAssistantChunk(chunk);
            if (STREAM_TTS_WHILE_OPEN) {
              feedIncrementalTtsFromStream(turn, speakGenerationRef.current);
            }
          },
          onDoneMeta: (meta: ChatStreamDoneMeta) => {
            if (abortController.signal.aborted) return;
            ttsExpressStyleRef.current = meta.express_style ?? null;
            ttsEmotionHintRef.current = meta.emotion_hint ?? null;
          },
          onDone: (reply) => {
            if (abortController.signal.aborted) return reply;
            if (streamFinished) return reply;
            streamFinished = true;
            if (STREAM_TTS_WHILE_OPEN) {
              feedIncrementalTtsFromStream(turn, speakGenerationRef.current, true);
            }
            const displayReply = formatAssistantReply(reply);
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
            replyForTts = displayReply;

            if (!voiceEnabledRef.current && fromVoice) {
              setVoicePhaseTransition('idle');
              prewarmRecordingPipeline();
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

      if (voiceEnabledRef.current && replyForTts.trim()) {
        await runTtsForReply(replyForTts, turn);
      } else if (voicePhaseRef.current === 'processing') {
        if (conversationSessionRef.current && voiceInputModeRef.current === 'conversation') {
          setVoicePhaseTransition('idle');
        } else {
          releaseVoiceUi();
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        finalizeInterruptedTurn(assistantId);
        const keepConversation =
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation';
        if (!keepConversation) {
          releaseVoiceUi();
        } else {
          resumeConversationListeningAfterTurn();
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
      releaseVoiceUi();
    } finally {
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
    }
  };

  const busy = loading || isStreaming;
  const voiceBusy =
    voicePhase !== 'idle' &&
    !(voicePhase === 'listening' && voiceInputMode === 'conversation');
  const inputLocked =
    busy ||
    voicePhase === 'processing' ||
    voicePhase === 'speaking' ||
    voicePhase === 'recording';
  const phaseLabel = voicePhaseLabel(voicePhase, isStreaming, conversationSession);
  const phaseHint = voicePhaseHint(voicePhase, isStreaming, conversationSession);
  const conversationCanInterrupt =
    voiceInputMode === 'conversation' &&
    conversationSession &&
    (voicePhase === 'processing' || voicePhase === 'speaking');
  const micShowSpinner =
    voicePhase === 'processing' || (busy && voicePhase !== 'recording' && voicePhase !== 'listening');
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
                voicePhase === 'processing' &&
                  (isStreaming
                    ? styles.voiceStatusDotGenerating
                    : styles.voiceStatusDotProcessing),
                voicePhase === 'speaking' && styles.voiceStatusDotSpeaking,
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
                    ? 'Speaking… say something or tap Mic to interrupt'
                    : 'Thinking… say something or tap Mic to interrupt'
                  : voicePhase === 'speaking'
                    ? 'Speaking… tap to stop'
                    : isStreaming || voicePhase === 'processing'
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
                {voicePhase === 'recording' || voicePhase === 'listening'
                  ? '···'
                  : voiceInputMode === 'conversation' && conversationSession
                    ? 'Stop'
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
            placeholder={
              voicePhase === 'listening'
                ? 'Listening…'
                : voicePhase === 'recording'
                  ? 'Recording…'
                  : voicePhase === 'processing'
                    ? conversationSession
                      ? 'Thinking…'
                      : 'Processing…'
                    : voicePhase === 'speaking'
                      ? 'Speaking…'
                      : voiceInputMode === 'conversation'
                        ? 'Type or tap Mic to converse'
                        : 'Type or hold Mic to talk'
            }
            placeholderTextColor="#888888"
            multiline
            editable={!inputLocked}
          />
          <TouchableOpacity
            style={[styles.sendButton, (loading || voicePhase === 'processing') && styles.sendDisabled]}
            onPress={() => void sendMessage().catch(() => {})}
            disabled={
              voicePhase === 'recording' ||
              voicePhase === 'listening' ||
              !input.trim()
            }
          >
            {loading && voicePhase !== 'processing' ? (
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
