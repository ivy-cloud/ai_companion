import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
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
  turnNoResponseTimeoutMs,
  isEmptySttError,
  isLikelyAssistantEchoTranscript,
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
  canResumeConversationListen,
  IDLE_LISTEN_RECOVERY_MS,
  LISTEN_OPEN_GRACE_MS,
  LISTEN_RETRY_MAX_DELAY_MS,
  LISTEN_RETRY_MS,
  LISTENING_STUCK_MS,
  LISTEN_METER_BLOCKED_MS,
  MAX_LISTEN_SCHEDULE_RETRIES,
  MIN_SCHEDULE_LISTEN_MS,
  PHASE_OSCILLATION_COOLDOWN_MS,
  PHASE_OSCILLATION_MAX_FLIPS,
  PHASE_OSCILLATION_WINDOW_MS,
  POST_TTS_LISTEN_COOLDOWN_MS,
  PROACTIVE_IDLE_MS,
  PROACTIVE_MAX_PER_SESSION,
  PROACTIVE_MIN_GAP_MS,
  RECORDING_TAIL_MS,
  shouldForceIdleListeningWithoutRecording,
  shouldRecoverListeningMeterBlocked,
  shouldRecoverListenPausedStuck,
  WATCHDOG_RECOVERY_COOLDOWN_MS,
  createBargeInMeterState,
  createConversationMeterState,
  isSpeechLevel,
  METERING_INTERVAL_MS,
  shouldSecondChanceQuietListen,
  tickConversationBargeIn,
  tickConversationMeter,
  type BargeInMeterState,
  type ConversationMeterState,
  type QuietListenMeterMeta,
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
  buildFinalTtsUtterances,
  createIncrementalTtsState,
  pullSpeakableChunks,
  resetIncrementalTtsState,
  streamTtsAlreadyComplete,
  type IncrementalTtsState,
} from '../lib/incrementalTts';
import {
  playSettledForGeneration,
  shouldAutoRetryTts,
  shouldOfferTapToHear,
} from '../lib/ttsTurnGuard';
import {
  getDeviceTimezone,
} from '../lib/deviceTimezone';
import {
  computeListenLatencyGaps,
  createVoiceTurnTiming,
  logVoiceTurnSummary,
  markVoiceTiming,
  markVoiceChunkPlay,
  type VoiceTurnTiming,
} from '../lib/voiceLatency';
import {
  formatVoiceInputError,
  formatVoicePlaybackError,
} from '../lib/voiceErrors';
import {
  fetchHealthPreflight,
  formatHealthBanner,
} from '../lib/healthPreflight';
import { wearablesChatHeaders } from '../lib/wearablesAdapter';
import {
  ASSISTANT_STUCK_MS,
  SPEAKING_STUCK_MS,
  INTERRUPTING_STUCK_MS,
  THINKING_NO_STREAM_MS,
  TURN_NO_RESPONSE_MS,
  blocksRecordingPrewarm,
  canExitSpeakingPhaseNow,
  formatSendBlockBanner,
  getInputLockReason,
  getSendMessageSkipReason,
  hasAssistantReplyStarted,
  isAssistantActivePhase,
  isSpeakingPhaseBlocked,
  logVoiceState,
  shouldClearStaleChatInFlight,
  shouldRecoverStuckSpeakingPhase,
  shouldRecoverThinkingNoStream,
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
import { useAppSettings } from '../lib/appSettings';
import { registerConversationReset } from '../lib/conversationReset';
import { voicePhaseHint, voicePhaseLabel } from '../lib/voiceFlow';
import { VoiceHero } from '../components/VoiceHero';
import {
  dbfsToNormalized,
  VOICE_METER_UI_THROTTLE_MS,
} from '../lib/voiceMeterLevel';
import {
  flushVoiceLogNetwork,
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

/** Delay hiding voice hero when keyboard/focus opens (avoids iOS keyboard flicker). */
const VOICE_HERO_KEYBOARD_HIDE_MS = 300;
/** Keep hero visible through brief idle gaps between listen cycles. */
const VOICE_HERO_IDLE_HOLD_MS = 500;
const VOICE_WAVE_BARGE_SHOW_LEVEL = 0.05;
const VOICE_WAVE_BARGE_HIDE_LEVEL = 0.03;
/** Show "Speak louder" after dBFS stays below speech threshold this long. */
const SPEAK_LOUDER_HINT_MS = 3000;

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

async function fetchCompanionFromHealth(): Promise<{
  name: string | null;
  skillHints: string[];
}> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return { name: null, skillHints: [] };
    const data = (await response.json()) as {
      companion?: { name?: string; skill_hints?: string[] };
    };
    const hints = data.companion?.skill_hints;
    return {
      name: data.companion?.name?.trim() || null,
      skillHints: Array.isArray(hints) ? hints.filter((h) => typeof h === 'string') : [],
    };
  } catch {
    return { name: null, skillHints: [] };
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
  singing?: boolean;
};

export default function ChatScreen() {
  const { voiceEnabled, naturalVoiceEnabled, voiceGender, voiceInputMode } =
    useAppSettings();
  const [input, setInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [typingTextOnly, setTypingTextOnly] = useState(false);
  const [voiceHeroSessionHeld, setVoiceHeroSessionHeld] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [conversationSession, setConversationSession] = useState(false);
  const [companionName, setCompanionName] = useState('…');
  const [voiceName, setVoiceName] = useState('Loading voice…');
  const [voicePlaybackError, setVoicePlaybackError] = useState<string | null>(null);
  const [ttsTapToHearText, setTtsTapToHearText] = useState<string | null>(null);
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const [backendHealthBanner, setBackendHealthBanner] = useState<string | null>(
    null,
  );
  const [sendBlockBanner, setSendBlockBanner] = useState<string | null>(null);
  const [skillHints, setSkillHints] = useState<string[]>([]);
  const [voiceMeterLevel, setVoiceMeterLevel] = useState(0);
  const [voiceMeterDbfs, setVoiceMeterDbfs] = useState<number | null>(null);
  const [speakLouderHint, setSpeakLouderHint] = useState(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  const voicePhaseRef = useRef<VoicePhase>('idle');
  const voiceInputModeRef = useRef<VoiceInputMode>(voiceInputMode);
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
  /** Timestamp of the most recent "schedule_listen" attempt (preserved across 400ms retries). */
  const lastListenScheduleAtRef = useRef<number | null>(null);
  /** When the mic actually starts recording (for listen_ready latency). */
  const micOpenAtRef = useRef<number | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartedAtRef = useRef(0);
  const micPressRef = useRef(false);
  const voiceUtteranceRef = useRef(0);
  const voiceSendLockRef = useRef(false);
  /** One quiet-speech second-chance listen per successful user turn. */
  const quietListenRetryUsedRef = useRef(false);
  const lastVoiceTranscriptRef = useRef('');
  const naturalVoiceEnabledRef = useRef(naturalVoiceEnabled);
  const voiceGenderRef = useRef<VoiceGender>(voiceGender);
  const lastVoiceSendTextRef = useRef('');
  const ttsExpressStyleRef = useRef<string | null>(null);
  const ttsEmotionHintRef = useRef<string | null>(null);
  const primeSoundRef = useRef<Audio.Sound | null>(null);
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const voiceSessionRef = useRef(createVoiceSession());
  const phaseChangedAtRef = useRef(Date.now());
  const phaseFlipTimesRef = useRef<number[]>([]);
  const lastWatchdogRecoveryAtRef = useRef(0);
  const conversationListenRetryCountRef = useRef(0);
  const listenMeterBlockedSinceRef = useRef<number | null>(null);
  const phaseOscillationCooldownUntilRef = useRef(0);
  const conversationMeterTickInFlightRef = useRef(false);
  const conversationBargeMeterTickInFlightRef = useRef(false);
  const voiceMeterUiLastAtRef = useRef(0);
  const voiceMeterUiPendingRef = useRef<number | null>(null);
  const voiceMeterUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceMeterDbfsPendingRef = useRef<number | null>(null);
  const lowDbSinceRef = useRef<number | null>(null);
  const typingTextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceHeroHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceHeroSessionHeldRef = useRef(false);
  const voiceWaveBargeHeldRef = useRef(false);
  const prevVoiceInputModeRef = useRef<VoiceInputMode>(voiceInputMode);
  const prevVoiceEnabledRef = useRef(voiceEnabled);
  const pttMeterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pttMeterTickInFlightRef = useRef(false);
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
  const currentReplyIsSingingRef = useRef(false);
  const voiceTurnTimingRef = useRef<VoiceTurnTiming | null>(null);
  const voiceTurnSummaryPendingRef = useRef(false);
  const voiceTurnSummaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamTtsPrefetchRef = useRef<Promise<string | null> | null>(null);
  const iosSpeakerPrimedGenerationRef = useRef(-1);
  /** speakGeneration that completed at least one natural play_settle this turn. */
  const ttsPlaySettledGenRef = useRef(-1);
  const ttsRetryUsedTurnRef = useRef(-1);
  const proactiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProactiveAtRef = useRef(0);
  const proactiveSessionCountRef = useRef(0);
  const proactiveTurnActiveRef = useRef(false);
  const [proactiveTurnActive, setProactiveTurnActive] = useState(false);
  const proactiveBeatsRef = useRef<string[]>([]);
  const turnNoResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync settings + session refs every render — useEffect is too late after settings navigation.
  voiceEnabledRef.current = voiceEnabled;
  naturalVoiceEnabledRef.current = naturalVoiceEnabled;
  voiceGenderRef.current = voiceGender;
  voiceInputModeRef.current = voiceInputMode;
  conversationSessionRef.current = conversationSession;

  const refreshBackendHealth = async (): Promise<boolean> => {
    const result = await fetchHealthPreflight(API_BASE);
    const banner = formatHealthBanner(result);
    setBackendHealthBanner(banner);
    return result.reachable;
  };

  useEffect(() => {
    if (prevVoiceEnabledRef.current === voiceEnabled) return;
    prevVoiceEnabledRef.current = voiceEnabled;
    if (!voiceEnabled) {
      void stopPlayback().catch(() => {});
      interruptAssistant();
    } else {
      prewarmVoiceMicIfIdle();
    }
  }, [voiceEnabled]);

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
    if (
      prevVoiceInputModeRef.current !== voiceInputMode &&
      voiceInputMode === 'ptt'
    ) {
      endConversationSession();
    }
    prevVoiceInputModeRef.current = voiceInputMode;
  }, [voiceInputMode]);

  useEffect(() => {
    if (voiceEnabled) prewarmVoiceMicIfIdle();
  }, [voiceEnabled]);

  useEffect(() => {
    let mounted = true;
    let loadedSound: Audio.Sound | null = null;

    const prepareAudio = async () => {
      try {
        await configurePlaybackAudioMode();
        const [companionHealth, label] = await Promise.all([
          fetchCompanionFromHealth(),
          fetchAzureVoiceLabel(voiceGenderRef.current),
          refreshBackendHealth(),
        ]);
        if (!mounted) return;
        if (companionHealth.name) setCompanionName(companionHealth.name);
        setSkillHints(companionHealth.skillHints);
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

  useEffect(() => {
    try {
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
      const showSub = Keyboard.addListener(showEvent, () => {
        setKeyboardVisible(true);
        scrollToEnd(true);
      });
      const hideSub = Keyboard.addListener(hideEvent, () => {
        setKeyboardVisible(false);
      });
      return () => {
        showSub.remove();
        hideSub.remove();
      };
    } catch (err) {
      console.warn('[keyboard] listener setup failed', err);
      return undefined;
    }
  }, []);

  useEffect(() => {
    const rawTyping = inputFocused || keyboardVisible;
    if (rawTyping) {
      if (!typingTextDebounceRef.current) {
        typingTextDebounceRef.current = setTimeout(() => {
          setTypingTextOnly(true);
          typingTextDebounceRef.current = null;
        }, VOICE_HERO_KEYBOARD_HIDE_MS);
      }
      return;
    }
    if (typingTextDebounceRef.current) {
      clearTimeout(typingTextDebounceRef.current);
      typingTextDebounceRef.current = null;
    }
    setTypingTextOnly(false);
  }, [inputFocused, keyboardVisible]);

  useEffect(
    () => () => {
      if (typingTextDebounceRef.current) {
        clearTimeout(typingTextDebounceRef.current);
        typingTextDebounceRef.current = null;
      }
    },
    [],
  );

  const voiceSessionActive =
    conversationSession && voiceInputMode === 'conversation';

  useEffect(() => {
    if (voiceHeroHoldTimerRef.current) {
      clearTimeout(voiceHeroHoldTimerRef.current);
      voiceHeroHoldTimerRef.current = null;
    }
    if (!voiceSessionActive) {
      voiceHeroSessionHeldRef.current = false;
      setVoiceHeroSessionHeld(false);
      return;
    }
    voiceHeroSessionHeldRef.current = true;
    setVoiceHeroSessionHeld(true);
  }, [conversationSession, voiceInputMode, voiceSessionActive]);

  useEffect(() => {
    if (!voiceSessionActive) return;
    const voiceActive =
      voicePhase === 'listening' ||
      voicePhase === 'recording' ||
      voicePhase === 'speaking' ||
      voicePhase === 'thinking' ||
      voicePhase === 'streaming' ||
      voicePhase === 'interrupting';
    if (voiceActive) {
      if (voiceHeroHoldTimerRef.current) {
        clearTimeout(voiceHeroHoldTimerRef.current);
        voiceHeroHoldTimerRef.current = null;
      }
      voiceHeroSessionHeldRef.current = true;
      setVoiceHeroSessionHeld(true);
      return;
    }
    if (voicePhase !== 'idle' || !voiceHeroSessionHeldRef.current) return;
    voiceHeroHoldTimerRef.current = setTimeout(() => {
      voiceHeroHoldTimerRef.current = null;
      voiceHeroSessionHeldRef.current = false;
      setVoiceHeroSessionHeld(false);
    }, VOICE_HERO_IDLE_HOLD_MS);
    return () => {
      if (voiceHeroHoldTimerRef.current) {
        clearTimeout(voiceHeroHoldTimerRef.current);
        voiceHeroHoldTimerRef.current = null;
      }
    };
  }, [voiceSessionActive, voicePhase]);

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

  /** Prewarm conversation recorder even when phase blocks default prewarm (TTS fetch window). */
  const prewarmConversationMicAggressive = () => {
    if (!voiceEnabledRef.current) return;
    if (voiceInputModeRef.current !== 'conversation') return;
    if (!conversationSessionRef.current) return;
    if (voicePhaseRef.current === 'listening' && recordingRef.current) return;
    setRecordingPrewarmBlocked(false);
    prewarmRecordingPipeline();
    syncRecordingPrewarmBlock(voicePhaseRef.current);
  };

  const prewarmVoiceMicIfIdle = () => {
    if (
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation'
    ) {
      // Prewarm while LLM/TTS runs — overlaps fetch + post-TTS cooldown before mic open.
      if (
        voicePhaseRef.current === 'thinking' ||
        voicePhaseRef.current === 'streaming' ||
        voicePhaseRef.current === 'speaking'
      ) {
        prewarmConversationMicAggressive();
      }
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

  /** Prewarm during post-TTS cooldown so mic open overlaps the echo-decay window. */
  const prewarmConversationMicForListen = () => {
    if (!voiceEnabledRef.current) return;
    if (voiceInputModeRef.current !== 'conversation') return;
    if (!conversationSessionRef.current) return;
    if (voicePhaseRef.current === 'listening' && recordingRef.current) return;
    if (blocksRecordingPrewarm(voicePhaseRef.current)) {
      prewarmConversationMicAggressive();
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

  const noteConversationPhaseFlip = (from: VoicePhase, to: VoicePhase) => {
    if (!conversationSessionRef.current) return;
    const now = Date.now();
    const flips = phaseFlipTimesRef.current;
    flips.push(now);
    while (flips.length > 0 && flips[0] < now - PHASE_OSCILLATION_WINDOW_MS) {
      flips.shift();
    }
    if (flips.length < PHASE_OSCILLATION_MAX_FLIPS) return;
    const oscillating =
      (from === 'listening' && to === 'interrupting') ||
      (from === 'interrupting' && to === 'listening') ||
      (from === 'listening' && to === 'idle') ||
      (from === 'idle' && to === 'listening');
    if (oscillating) {
      phaseOscillationCooldownUntilRef.current =
        Date.now() + PHASE_OSCILLATION_COOLDOWN_MS;
      voiceLog('phase_oscillation', {
        from,
        to,
        flips: flips.length,
        windowMs: PHASE_OSCILLATION_WINDOW_MS,
        hasRecording: Boolean(recordingRef.current),
        ttsBlocked: isTtsBlockingConversationListen(),
      });
      flips.length = 0;
    }
  };

  const resetConversationListenRetries = () => {
    conversationListenRetryCountRef.current = 0;
  };

  const nextConversationListenRetryDelay = (): number => {
    const attempt = conversationListenRetryCountRef.current;
    if (attempt <= 1) return LISTEN_RETRY_MS;
    return Math.min(
      LISTEN_RETRY_MAX_DELAY_MS,
      LISTEN_RETRY_MS * Math.min(attempt, 6),
    );
  };

  const bumpConversationListenRetry = (): boolean => {
    conversationListenRetryCountRef.current += 1;
    if (
      conversationListenRetryCountRef.current <= MAX_LISTEN_SCHEDULE_RETRIES
    ) {
      return true;
    }
    if (
      conversationListenRetryCountRef.current ===
      MAX_LISTEN_SCHEDULE_RETRIES + 1
    ) {
      voiceLog('schedule_listen_give_up', {
        retries: MAX_LISTEN_SCHEDULE_RETRIES,
      });
    }
    return false;
  };

  const retryConversationListen = (minDelayMs = LISTEN_RETRY_MS) => {
    if (!bumpConversationListenRetry()) return;
    scheduleConversationListen(
      Math.max(minDelayMs, nextConversationListenRetryDelay()),
    );
  };

  const setVoicePhaseTransition = (
    next: VoicePhase,
    options?: { force?: boolean; reason?: string },
  ) => {
    const from = voicePhaseRef.current;
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
      if (from !== next) {
        noteConversationPhaseFlip(from, next);
        if (from === 'listening' && next !== 'listening') {
          stopConversationMetering();
        }
        if (from === 'speaking' && next !== 'speaking') {
          stopConversationBargeIn();
        }
        if (next === 'speaking') {
          prewarmVoiceMicIfIdle();
        }
      }
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

  const clearVoiceMeterLevel = () => {
    if (voiceMeterUiTimerRef.current) {
      clearTimeout(voiceMeterUiTimerRef.current);
      voiceMeterUiTimerRef.current = null;
    }
    voiceMeterUiPendingRef.current = null;
    voiceMeterDbfsPendingRef.current = null;
    lowDbSinceRef.current = null;
    setSpeakLouderHint(false);
    setVoiceMeterLevel(0);
    setVoiceMeterDbfs(null);
  };

  const updateSpeakLouderHint = (metering: number | undefined, now: number) => {
    const phase = voicePhaseRef.current;
    if (phase !== 'listening' && phase !== 'recording') {
      if (lowDbSinceRef.current !== null) {
        lowDbSinceRef.current = null;
        setSpeakLouderHint(false);
      }
      return;
    }
    if (metering === undefined || metering === null || Number.isNaN(metering)) {
      return;
    }
    if (isSpeechLevel(metering)) {
      lowDbSinceRef.current = null;
      setSpeakLouderHint(false);
      return;
    }
    if (lowDbSinceRef.current === null) {
      lowDbSinceRef.current = now;
      return;
    }
    if (now - lowDbSinceRef.current >= SPEAK_LOUDER_HINT_MS) {
      setSpeakLouderHint(true);
    }
  };

  const publishVoiceMeterLevel = (metering: number | undefined) => {
    const level = dbfsToNormalized(metering);
    const dbfs =
      metering === undefined || metering === null || Number.isNaN(metering)
        ? null
        : metering;
    const now = Date.now();
    updateSpeakLouderHint(metering, now);
    const elapsed = now - voiceMeterUiLastAtRef.current;
    if (elapsed >= VOICE_METER_UI_THROTTLE_MS) {
      voiceMeterUiLastAtRef.current = now;
      setVoiceMeterLevel(level);
      setVoiceMeterDbfs(dbfs);
      return;
    }
    voiceMeterUiPendingRef.current = level;
    voiceMeterDbfsPendingRef.current = dbfs;
    if (voiceMeterUiTimerRef.current) return;
    voiceMeterUiTimerRef.current = setTimeout(() => {
      voiceMeterUiTimerRef.current = null;
      if (voiceMeterUiPendingRef.current !== null) {
        voiceMeterUiLastAtRef.current = Date.now();
        setVoiceMeterLevel(voiceMeterUiPendingRef.current);
        setVoiceMeterDbfs(voiceMeterDbfsPendingRef.current);
        voiceMeterUiPendingRef.current = null;
        voiceMeterDbfsPendingRef.current = null;
      }
    }, VOICE_METER_UI_THROTTLE_MS - elapsed);
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

  const ensureIosSpeakerPrimed = async (generation: number) => {
    if (Platform.OS !== 'ios') return;
    if (iosSpeakerPrimedGenerationRef.current === generation) return;
    await primeIosSpeaker();
    iosSpeakerPrimedGenerationRef.current = generation;
  };

  const markTtsPlaybackFailed = (
    replyText: string,
    reason: string,
    extra?: Record<string, string | number | boolean>,
  ) => {
    voiceLog('tts_failed', { reason, ...extra });
    setVoicePlaybackError(
      formatVoicePlaybackError(
        'No audio heard — raise volume, silent switch off, tap above to hear.',
      ),
    );
    const trimmed = replyText.trim();
    if (trimmed) setTtsTapToHearText(trimmed);
  };

  const stopPttMetering = () => {
    if (pttMeterRef.current) {
      clearInterval(pttMeterRef.current);
      pttMeterRef.current = null;
    }
  };

  const beginPttMeter = () => {
    stopPttMetering();
    pttMeterRef.current = setInterval(() => {
      if (pttMeterTickInFlightRef.current) return;
      pttMeterTickInFlightRef.current = true;
      void (async () => {
        try {
          if (voicePhaseRef.current !== 'recording') return;
          const recording = recordingRef.current;
          if (!recording) return;
          let status: Awaited<ReturnType<Audio.Recording['getStatusAsync']>>;
          try {
            status = await recording.getStatusAsync();
          } catch {
            return;
          }
          if (!status.isRecording) return;
          publishVoiceMeterLevel(status.metering);
        } finally {
          pttMeterTickInFlightRef.current = false;
        }
      })();
    }, METERING_INTERVAL_MS);
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
        if (conversationBargeMeterTickInFlightRef.current) return;
        conversationBargeMeterTickInFlightRef.current = true;
        void (async () => {
          try {
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
          publishVoiceMeterLevel(status.metering);

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
          } finally {
            conversationBargeMeterTickInFlightRef.current = false;
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

  const endConversationSession = (reason = 'session_end') => {
    clearProactiveTimer();
    proactiveSessionCountRef.current = 0;
    lastProactiveAtRef.current = 0;
    proactiveTurnActiveRef.current = false;
    setProactiveTurnActive(false);
    proactiveBeatsRef.current = [];
    clearConversationListenResumeTimer();
    resetConversationListenRetries();
    conversationListenGenRef.current += 1;
    conversationSessionRef.current = false;
    setConversationSession(false);
    stopConversationBargeIn();
    stopConversationMetering();
    const rec = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    if (rec) void safeUnloadRecording(rec);
    cancelActiveStreamTtsDrain();
    abortTtsFetches(reason);
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    const assistantBusy =
      chatInFlightRef.current ||
      speakInFlightRef.current ||
      streamTtsDrainingRef.current ||
      streamTtsQueueRef.current.length > 0 ||
      isAssistantActivePhase(voicePhaseRef.current);
    if (assistantBusy) {
      releaseVoiceUi(reason);
    } else if (voicePhaseRef.current === 'listening') {
      setVoicePhaseTransition('idle', { reason });
      if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
    } else if (voicePhaseRef.current !== 'idle') {
      setVoicePhaseTransition('idle', { force: true, reason });
      if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
    }
  };

  const endConversationSessionManually = () => {
    if (!conversationSessionRef.current) return;
    logVoiceState('conversation_session_ended', { manual: true });
    void (async () => {
      const goodbye = await fetchSessionGoodbyeLine();
      endConversationSession('user_end_conversation');
      setVoiceInputError(null);
      if (goodbye && voiceEnabledRef.current) {
        await speakFarewell(goodbye);
      }
      prewarmVoiceMicIfIdle();
    })();
  };

  const clearProactiveTimer = () => {
    if (proactiveTimerRef.current) {
      clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }
  };

  const canFireProactiveTurn = (): boolean => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return false;
    }
    if (proactiveSessionCountRef.current >= PROACTIVE_MAX_PER_SESSION) return false;
    if (
      lastProactiveAtRef.current > 0 &&
      Date.now() - lastProactiveAtRef.current < PROACTIVE_MIN_GAP_MS
    ) {
      return false;
    }
    if (chatInFlightRef.current || voiceSendLockRef.current) return false;
    if (voicePhaseRef.current !== 'listening' || !recordingRef.current) return false;
    const meter = conversationMeterStateRef.current;
    if (meter?.sawSpeech) return false;
    return true;
  };

  const scheduleProactiveTurn = () => {
    clearProactiveTimer();
    if (!conversationSessionRef.current) return;
    proactiveTimerRef.current = setTimeout(() => {
      proactiveTimerRef.current = null;
      void fireProactiveTurnIfIdle();
    }, PROACTIVE_IDLE_MS);
  };

  const fireProactiveTurnIfIdle = async () => {
    if (!canFireProactiveTurn()) return;
    voiceLog('proactive_turn_start', {
      sessionCount: proactiveSessionCountRef.current,
      beatsQueued: proactiveBeatsRef.current.length,
    });
    proactiveTurnActiveRef.current = true;
    setProactiveTurnActive(true);
    lastProactiveAtRef.current = Date.now();
    proactiveSessionCountRef.current += 1;
    stopConversationMetering();
    const rec = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    if (rec) await safeUnloadRecording(rec);
    setVoicePhaseTransition('idle', { reason: 'proactive_handoff' });
    const threadBeat = proactiveBeatsRef.current[0];
    await sendMessage('', {
      proactive: true,
      threadBeat,
      skipUserBubble: true,
    });
  };

  const resetProactiveOnUserSpeech = () => {
    clearProactiveTimer();
    proactiveSessionCountRef.current = 0;
    lastProactiveAtRef.current = 0;
  };

  const beginConversationListenMeter = (listenGen: number) => {
    stopConversationMetering();
    conversationMeterRef.current = setInterval(() => {
      if (conversationMeterTickInFlightRef.current) return;
      conversationMeterTickInFlightRef.current = true;
      void (async () => {
        try {
        if (listenGen !== conversationListenGenRef.current) return;
        const recording = recordingRef.current;
        if (!recording || voicePhaseRef.current !== 'listening') return;
        const now = Date.now();
        await clearStaleActiveSoundIfIdle();
        if (
          streamTtsDrainingRef.current &&
          streamTtsQueueRef.current.length === 0 &&
          !speakInFlightRef.current
        ) {
          streamTtsDrainingRef.current = false;
        }
        if (speakInFlightRef.current && !chatInFlightRef.current && !activeSoundRef.current) {
          speakInFlightRef.current = false;
        }
        const listeningWithRecording =
          voicePhaseRef.current === 'listening' && Boolean(recordingRef.current);
        if (!listeningWithRecording && isTtsBlockingConversationListen()) {
          const blockedSince = listenMeterBlockedSinceRef.current ?? now;
          listenMeterBlockedSinceRef.current = blockedSince;
          const blockedMs = now - blockedSince;
          if (shouldRecoverListeningMeterBlocked(blockedMs, true)) {
            listenMeterBlockedSinceRef.current = null;
            await clearStaleTtsListenBlockers();
            if (isTtsBlockingConversationListen()) {
              voiceLog('listen_stuck_recovery', {
                reason: 'meter_tts_blocked',
                blockedMs,
                draining: streamTtsDrainingRef.current,
                queue: streamTtsQueueRef.current.length,
                speakInFlight: speakInFlightRef.current,
                activeSound: Boolean(activeSoundRef.current),
                listenGen,
              });
              stopConversationMetering();
              const rec = recordingRef.current;
              recordingRef.current = null;
              recordingStartedAtRef.current = 0;
              if (rec) await safeUnloadRecording(rec);
              setVoicePhaseTransition('idle', {
                force: true,
                reason: 'listen_meter_blocked',
              });
              ensureConversationListening('listen_meter_blocked');
            }
          }
          return;
        }
        if (listeningWithRecording) {
          await clearStaleTtsListenBlockers();
        }
        listenMeterBlockedSinceRef.current = null;

        let status: Awaited<ReturnType<Audio.Recording['getStatusAsync']>>;
        try {
          status = await recording.getStatusAsync();
        } catch {
          return;
        }
        if (!status.isRecording) return;

        const prev = conversationMeterStateRef.current ?? createConversationMeterState(now);
        const tick = tickConversationMeter(prev, status.metering, now);
        conversationMeterStateRef.current = tick.state;
        publishVoiceMeterLevel(status.metering);

        if (isSpeechLevel(status.metering)) {
          clearProactiveTimer();
        }

        if (tick.quietVoiceTimeout) {
          voiceLog('quiet_voice_timeout', {
            listenMs: now - tick.state.listenStartedAt,
            listenGen,
            hint: 'Speak closer or louder; check voice log for end_silence',
          });
        }

        if (tick.inactive) {
          endConversationSession();
          setVoiceInputError('Conversation ended — no speech heard.');
          prewarmVoiceMicIfIdle();
          return;
        }

        if (tick.endSilence) {
          voiceLog('end_silence', {
            speechMs: tick.speechDurationMs,
            silenceMs: tick.silenceDurationMs,
            listenGen,
          });
          clearProactiveTimer();
          stopConversationMetering();
          const active = recordingRef.current;
          recordingRef.current = null;
          if (!active) return;
          if (RECORDING_TAIL_MS > 0) {
            await new Promise((resolve) => setTimeout(resolve, RECORDING_TAIL_MS));
          }
          if (listenGen !== conversationListenGenRef.current) {
            try {
              await active.stopAndUnloadAsync();
            } catch {
              // ignore
            }
            return;
          }
          void finalizeConversationListenChunk(active, listenGen, {
            sawSpeech: tick.state.sawSpeech,
            peakMetering: tick.state.peakMetering,
            speechDurationMs: tick.speechDurationMs,
          });
        }
        } finally {
          conversationMeterTickInFlightRef.current = false;
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
        suppressInterruptingUi: true,
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
        peakMetering: null,
        quietVoiceTimeoutLogged: false,
      };

      resetProactiveOnUserSpeech();

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
    meterMeta?: QuietListenMeterMeta,
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
    voiceLog('stt_start', {
      listenGen,
      utteranceId,
      sawSpeech: meterMeta?.peakMetering != null || meterMeta?.speechDurationMs != null,
    });
    if (!setVoicePhaseTransition('thinking', { reason: 'end_silence_stt' })) {
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
      void processVoiceUtterance(uri, utteranceId, {
        fromConversation: true,
        meterMeta,
      });
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

  /** Force mic reopen when session is active but UI stuck on idle ("Listening paused"). */
  const recoverListenPausedIfStuck = async (reason: string, stuckMs: number) => {
    if (
      !conversationSessionRef.current ||
      voiceInputModeRef.current !== 'conversation' ||
      !voiceEnabledRef.current
    ) {
      return;
    }
    if (voicePhaseRef.current !== 'idle' || recordingRef.current) {
      return;
    }

    voiceLog('listen_paused_stuck', {
      reason,
      stuckMs,
      hasListenTimer: Boolean(conversationListenResumeTimerRef.current),
      chatInFlight: chatInFlightRef.current,
      voiceSendLock: voiceSendLockRef.current,
      ttsBlocked: isTtsBlockingConversationListen(),
      listenGen: conversationListenGenRef.current,
    });
    clearConversationListenResumeTimer();
    voiceSendLockRef.current = false;
    chatInFlightRef.current = false;
    ensureUiUnlocked();
    await clearStaleTtsListenBlockers();
    logVoiceState('watchdog_idle_reopen_listen', { stuckMs, reason });
    ensureConversationListening(reason);
  };

  /** Unstick conversation mode after a missed interrupt / stale STT / failed listen transition. */
  const ensureConversationListening = (reason = 'ensure_listen') => {
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
      const meterDead = !conversationMeterRef.current;
      const ttsBlocked = isTtsBlockingConversationListen();
      const blockedMs = listenMeterBlockedSinceRef.current
        ? Date.now() - listenMeterBlockedSinceRef.current
        : Date.now() - phaseChangedAtRef.current;
      if (!meterDead && !shouldRecoverListeningMeterBlocked(blockedMs, ttsBlocked)) {
        return;
      }
      voiceLog('listen_stuck_recovery', {
        reason,
        meterDead,
        ttsBlocked,
        blockedMs,
        listenGen: conversationListenGenRef.current,
      });
      if (meterDead) {
        beginConversationListenMeter(conversationListenGenRef.current);
        return;
      }
      stopConversationMetering();
      listenMeterBlockedSinceRef.current = null;
      const stuckRec = recordingRef.current;
      recordingRef.current = null;
      recordingStartedAtRef.current = 0;
      if (stuckRec) void safeUnloadRecording(stuckRec);
      setVoicePhaseTransition('idle', {
        force: true,
        reason: 'listen_stuck_recovery',
      });
    }
    if (voicePhaseRef.current === 'listening' && !recordingRef.current) {
      const msInPhase = Date.now() - phaseChangedAtRef.current;
      if (
        !shouldForceIdleListeningWithoutRecording(msInPhase, false)
      ) {
        voiceLog('listen_open_grace', { msInPhase, graceMs: LISTEN_OPEN_GRACE_MS });
        retryConversationListen();
        return;
      }
      logVoiceState('listen_without_recording', { phase: 'listening', msInPhase });
      // Keep listening phase — startConversationListening resumes without recorder.
    }
    void (async () => {
      await clearStaleTtsListenBlockers();
      const blocked = isTtsBlockingConversationListen();
      if (blocked) {
        voiceLog('listen_blocked', {
          reason,
          phase: voicePhaseRef.current,
          queue: streamTtsQueueRef.current.length,
          draining: streamTtsDrainingRef.current,
          activeSound: Boolean(activeSoundRef.current),
          speakInFlight: speakInFlightRef.current,
        });
        retryConversationListen();
        return;
      }
      logVoiceState('ensure_listen', { phase: voicePhaseRef.current, reason });
      await startConversationListening({ resumeAfterInterrupt: true });
    })();
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
    prewarmConversationMicForListen();
    if (Date.now() < phaseOscillationCooldownUntilRef.current) {
      delayMs = Math.max(delayMs, LISTEN_RETRY_MAX_DELAY_MS);
    }
    if (delayMs !== LISTEN_RETRY_MS && lastListenScheduleAtRef.current !== null) {
      const sinceLast = Date.now() - lastListenScheduleAtRef.current;
      if (sinceLast < MIN_SCHEDULE_LISTEN_MS) {
        delayMs = Math.max(delayMs, MIN_SCHEDULE_LISTEN_MS - sinceLast);
      }
    }
    const shouldPreserveScheduleForRetries =
      delayMs === LISTEN_RETRY_MS && lastListenScheduleAtRef.current !== null;
    if (!shouldPreserveScheduleForRetries) {
      lastListenScheduleAtRef.current = Date.now();
    }

    const hadPendingTimer = Boolean(conversationListenResumeTimerRef.current);
    clearConversationListenResumeTimer();
    if (!hadPendingTimer && delayMs !== LISTEN_RETRY_MS) {
      voiceLog('schedule_listen', { delayMs });
      logVoiceSnapshot('schedule_listen');
    }
    conversationListenResumeTimerRef.current = setTimeout(() => {
      conversationListenResumeTimerRef.current = null;
      void (async () => {
        if (chatInFlightRef.current || voiceSendLockRef.current) {
          voiceLog('schedule_listen_blocked', {
            reason: chatInFlightRef.current ? 'chat_in_flight' : 'voice_send_lock',
          });
          retryConversationListen();
          return;
        }
        await clearStaleTtsListenBlockers();
        if (isTtsBlockingConversationListen()) {
          voiceLog('schedule_listen_blocked', {
            reason: 'tts_blocked',
            queue: streamTtsQueueRef.current.length,
            draining: streamTtsDrainingRef.current,
            activeSound: Boolean(activeSoundRef.current),
            speakInFlight: speakInFlightRef.current,
          });
          retryConversationListen();
          return;
        }
        if (
          voicePhaseRef.current === 'speaking' &&
          isSpeakingPhaseBlocked(getSpeakingPhaseBlockers())
        ) {
          voiceLog('schedule_listen_blocked', { reason: 'still_speaking' });
          retryConversationListen();
          return;
        }
        resetConversationListenRetries();
        voiceLog('schedule_listen_open', { delayMs });
        ensureConversationListening('scheduled_open');
      })();
    }, delayMs);
  };

  const resumeConversationListeningAfterTurn = () => {
    scheduleConversationListen(POST_TTS_LISTEN_COOLDOWN_MS);
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
      const hasRecording = Boolean(recordingRef.current);
      const resumeAfterInterrupt = options?.resumeAfterInterrupt === true;
      if (
        !canResumeConversationListen(phase, hasRecording, resumeAfterInterrupt)
      ) {
        retryConversationListen();
        return;
      }
      if (
        !options?.resumeAfterInterrupt &&
        (chatInFlightRef.current || voiceSendLockRef.current)
      ) {
        voiceLog('listen_start_blocked', {
          reason: chatInFlightRef.current ? 'chat_in_flight' : 'voice_send_lock',
          phase: voicePhaseRef.current,
          resumeAfterInterrupt: options?.resumeAfterInterrupt === true,
        });
        retryConversationListen();
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
        retryConversationListen();
        return;
      }

      try {
        await releaseAllActiveRecorders();
        const recording = await startConversationRecording();
        if (listenGen !== conversationListenGenRef.current || !conversationSessionRef.current) {
          await safeUnloadRecording(recording);
          retryConversationListen();
          return;
        }

        recordingRef.current = recording;
        recordingStartedAtRef.current = Date.now();
        micOpenAtRef.current = Date.now();
        markVoiceTiming(voiceTurnTimingRef.current, 'mic_open');
        if (lastListenScheduleAtRef.current !== null) {
          voiceLog('mic_open', {
            dtSinceScheduleMs: Date.now() - lastListenScheduleAtRef.current,
          });
        }
        lastListenScheduleAtRef.current = null;

        if (!setVoicePhaseTransition('listening')) {
          recordingRef.current = null;
          await safeUnloadRecording(recording);
          retryConversationListen(300);
          return;
        }

        resetConversationListenRetries();
        conversationMeterStateRef.current = createConversationMeterState();
        beginConversationListenMeter(listenGen);
        scheduleProactiveTurn();
        if (micOpenAtRef.current !== null) {
          voiceLog('listen_ready', { dtSinceMicOpenMs: Date.now() - micOpenAtRef.current });
          markListenReadyTiming();
        }
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
              micOpenAtRef.current = Date.now();
              markVoiceTiming(voiceTurnTimingRef.current, 'mic_open');
              if (lastListenScheduleAtRef.current !== null) {
                voiceLog('mic_open', {
                  dtSinceScheduleMs: Date.now() - lastListenScheduleAtRef.current,
                });
              }
              lastListenScheduleAtRef.current = null;
              if (!setVoicePhaseTransition('listening')) {
                recordingRef.current = null;
                await safeUnloadRecording(recording);
                retryConversationListen(300);
                return;
              }
              resetConversationListenRetries();
              conversationMeterStateRef.current = createConversationMeterState();
              beginConversationListenMeter(listenGen);
              scheduleProactiveTurn();
              if (micOpenAtRef.current !== null) {
                voiceLog('listen_ready', {
                  dtSinceMicOpenMs: Date.now() - micOpenAtRef.current,
                });
                markListenReadyTiming();
              }
              return;
            }
            await safeUnloadRecording(recording);
          } catch {
            // fall through
          }
        }
        setVoiceInputError(formatVoiceInputError(raw, onlyOne));
        setVoicePhaseTransition('idle');
        ensureConversationListening();
      }
    });
  };

  const startConversationSession = async () => {
    if (!voiceEnabledRef.current) {
      setVoiceInputError('Turn on voice to use conversation mode.');
      return;
    }
    const preflight = await fetchHealthPreflight(API_BASE);
    const banner = formatHealthBanner(preflight);
    setBackendHealthBanner(banner);
    if (!preflight.reachable) {
      setVoiceInputError(
        banner ?? "Can't reach the backend — start ./start.sh on your Mac.",
      );
      return;
    }
    if (conversationSessionRef.current) {
      if (voicePhaseRef.current === 'idle') {
        ensureConversationListening('session_already_active');
      }
      return;
    }

    if (voicePhaseRef.current !== 'idle') {
      interruptAssistant({ keepConversationSession: true });
    }

    conversationSessionRef.current = true;
    setConversationSession(true);
    clearConversationListenResumeTimer();
    const openingLine = await fetchSessionOpeningLine();
    if (openingLine) {
      await speakSessionOpening(openingLine);
      // Opener schedules listen after TTS (or on failure); avoid racing mic open.
      return;
    }
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
      voiceLog('mic_tap_blocked', {
        reason: 'voice_disabled',
        mode: voiceInputModeRef.current,
        phase: voicePhaseRef.current,
        conversationSession: conversationSessionRef.current,
      });
      setVoiceInputError('Turn on voice to use the mic.');
      return;
    }

    voiceLog('mic_tap', {
      mode: 'conversation',
      phase: voicePhaseRef.current,
      conversationSession: conversationSessionRef.current,
      chatInFlight: chatInFlightRef.current,
      voiceSendLock: voiceSendLockRef.current,
    });

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
        ensureConversationListening('mic_tap_listen');
        return;
      }
      endConversationSession();
      interruptAssistant();
      prewarmVoiceMicIfIdle();
      return;
    }

    void startConversationSession();
  };

  const logMicTapBlocked = (
    reason: string,
    extra?: Record<string, string | number | boolean | null | undefined>,
  ) => {
    voiceLog('mic_tap_blocked', {
      reason,
      mode: voiceInputModeRef.current,
      phase: voicePhaseRef.current,
      conversationSession: conversationSessionRef.current,
      chatInFlight: chatInFlightRef.current,
      voiceSendLock: voiceSendLockRef.current,
      micPress: micPressRef.current,
      ...extra,
    });
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
    streamTtsPrefetchRef.current = null;
    resetIncrementalTtsState(streamTtsStateRef.current);
  };

  const useConversationSingleClipTts = () =>
    conversationSessionRef.current &&
    voiceInputModeRef.current === 'conversation';

  /** Short replies: one TTS clip at end — avoids last-sentence repeat loops. */
  const useSingleClipStreamTts = (raw: string) =>
    useConversationSingleClipTts() || prepareTextForSpeech(raw).length <= 400;

  const cancelActiveStreamTtsDrain = () => {
    voiceSessionRef.current.streamTtsDrainGen += 1;
    streamTtsQueueRef.current = [];
    streamTtsDrainingRef.current = false;
  };

  /** One Azure clip for the full reply — avoids last-sentence loop in conversation mode. */
  const flushVoiceTurnSummary = (reason: string) => {
    if (!voiceTurnSummaryPendingRef.current) return;
    const timing = voiceTurnTimingRef.current;
    if (!timing || timing.turn !== voiceSessionRef.current.turn) {
      voiceTurnSummaryPendingRef.current = false;
      if (voiceTurnSummaryTimerRef.current) {
        clearTimeout(voiceTurnSummaryTimerRef.current);
        voiceTurnSummaryTimerRef.current = null;
      }
      return;
    }
    voiceTurnSummaryPendingRef.current = false;
    if (voiceTurnSummaryTimerRef.current) {
      clearTimeout(voiceTurnSummaryTimerRef.current);
      voiceTurnSummaryTimerRef.current = null;
    }
    voiceLog('turn_summary_flush', { reason, turn: timing.turn });
    logVoiceTurnSummary(timing);
    voiceTurnTimingRef.current = null;
  };

  const scheduleVoiceTurnSummaryFallback = () => {
    if (voiceTurnSummaryTimerRef.current) {
      clearTimeout(voiceTurnSummaryTimerRef.current);
    }
    voiceTurnSummaryTimerRef.current = setTimeout(() => {
      voiceTurnSummaryTimerRef.current = null;
      flushVoiceTurnSummary('listen_timeout');
    }, POST_TTS_LISTEN_COOLDOWN_MS + LISTEN_OPEN_GRACE_MS + 800);
  };

  const markTtsPlaySettled = (generation: number) => {
    ttsPlaySettledGenRef.current = generation;
    setTtsTapToHearText(null);
    markVoiceTiming(voiceTurnTimingRef.current, 'play_settle');
    voiceLog('tts_play_settled', { generation });
  };

  const markListenReadyTiming = () => {
    markVoiceTiming(voiceTurnTimingRef.current, 'listen_ready');
    const gaps = computeListenLatencyGaps(voiceTurnTimingRef.current);
    if (gaps) voiceLog('listen_latency_gaps', gaps);
    flushVoiceTurnSummary('listen_ready');
  };

  const enqueueFinalStreamTtsIfNeeded = (
    reply: string,
    turn: number,
    generation: number,
  ) => {
    if (streamTtsAlreadyComplete(reply, streamTtsStateRef.current.spokenPrefix)) {
      return;
    }
    const trim = replyTrim();
    const parts = buildFinalTtsUtterances(
      reply,
      streamTtsStateRef.current,
      trim === false ? false : trim,
    );
    if (parts.length === 0) return;
    voiceLog('tts_final_enqueue', { parts: parts.length });
    enqueueStreamTtsChunks(parts, turn, generation);
  };

  const retryTtsPlaybackOnce = async (
    reply: string,
    turn: number,
    generation: number,
    streamMode: boolean,
  ) => {
    if (
      !shouldAutoRetryTts(
        ttsPlaySettledGenRef.current,
        generation,
        turn,
        ttsRetryUsedTurnRef.current,
        reply.trim().length,
      )
    ) {
      return;
    }
    if (!isActiveVoiceTurn(turn) || !isActiveSpeakGeneration(generation)) {
      voiceLog('tts_skip', { reason: 'inactive_before_retry', turn, generation });
      return;
    }

    ttsRetryUsedTurnRef.current = turn;
    voiceLog('tts_auto_retry', {
      turn,
      generation,
      streamMode,
      replyLen: reply.trim().length,
    });

    await clearStaleTtsListenBlockers();
    await stopPlayback();
    cancelActiveStreamTtsDrain();
    streamTtsEnqueuedKeysRef.current = new Set();
    lastPlayedTtsKeyRef.current = '';

    if (streamMode) {
      streamTtsRawRef.current = reply;
      await speakStreamReplyAsSingleClip(turn, generation);
      await waitStreamTtsQueueIdle();
      return;
    }

    const parts = buildSpeakParts(reply.trim(), false, serverSpeechChunksRef.current);
    if (parts.length === 0) return;
    setVoicePlaybackError(null);
    setVoicePhaseTransition('speaking', { reason: 'tts_auto_retry' });
    await prepareForTtsPlayback();
    await speakParts(parts);
  };

  const finishTtsTurnWithPlaybackCheck = async (
    reply: string,
    turn: number,
    generation: number,
    streamMode: boolean,
  ) => {
    if (
      shouldAutoRetryTts(
        ttsPlaySettledGenRef.current,
        generation,
        turn,
        ttsRetryUsedTurnRef.current,
        reply.trim().length,
      )
    ) {
      await retryTtsPlaybackOnce(reply, turn, generation, streamMode);
    }

    if (
      shouldOfferTapToHear(
        ttsPlaySettledGenRef.current,
        generation,
        reply.trim().length,
        ttsRetryUsedTurnRef.current,
        turn,
      )
    ) {
      markTtsPlaybackFailed(reply, 'no_play_after_retry', {
        turn,
        generation,
        replyLen: reply.trim().length,
      });
    } else if (playSettledForGeneration(ttsPlaySettledGenRef.current, generation)) {
      setTtsTapToHearText(null);
    }
  };

  const speakStreamReplyAsSingleClip = async (turn: number, generation: number) => {
    const raw = streamTtsRawRef.current.trim();
    const line = prepareTextForSpeech(raw);
    if (!line) {
      voiceLog('tts_skip', { reason: 'empty_single_clip', rawLen: raw.length });
      if (raw.length > 0 && isActiveSpeakGeneration(generation)) {
        markTtsPlaybackFailed(raw, 'empty_single_clip', { rawLen: raw.length });
      }
      return;
    }
    await clearStaleTtsListenBlockers();
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
    streamTtsPrefetchRef.current = prepareTtsClip(line, generation, {
      markFetchDone: !voiceTurnTimingRef.current?.marks.first_tts_fetch_done,
    });
    enqueueStreamTtsChunks([line], turn, generation);
  };

  const waitPlaybackFullyStopped = async () => {
    let stable = 0;
    for (let i = 0; i < 40; i += 1) {
      if (activeSoundRef.current) {
        // Expo/iOS can leave activeSoundRef set after playback finishes — clear early.
        await clearStaleActiveSoundIfIdle();
      }
      if (
        !activeSoundRef.current &&
        !streamTtsDrainingRef.current &&
        streamTtsQueueRef.current.length === 0 &&
        !speakInFlightRef.current
      ) {
        stable += 1;
        if (stable >= 2) return;
      } else {
        stable = 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  };

  const isLikelyAssistantEcho = (transcript: string): boolean =>
    isLikelyAssistantEchoTranscript(transcript, lastAssistantTtsTextRef.current, {
      playbackActive: Boolean(activeSoundRef.current),
      normalizeSpoken: (text) => prepareTextForSpeech(text).toLowerCase(),
      lastSentence: lastSentenceOf,
    });

  const streamTtsChunkKey = (text: string) => prepareTextForSpeech(text.trim());

  const logVoiceSnapshot = (label: string, extra?: Record<string, string | number | boolean>) => {
    voiceLogSnapshot(label, {
      phase: voicePhaseRef.current,
      hasRecording: Boolean(recordingRef.current),
      queue: streamTtsQueueRef.current.length,
      draining: streamTtsDrainingRef.current,
      streamDone: streamTtsDoneRef.current,
      activeSound: Boolean(activeSoundRef.current),
      speakInFlight: speakInFlightRef.current,
      chatInFlight: chatInFlightRef.current,
      hasListenTimer: Boolean(conversationListenResumeTimerRef.current),
      ttsBlocked: isTtsBlockingConversationListen(),
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

  const clearTurnNoResponseTimer = () => {
    if (turnNoResponseTimerRef.current) {
      clearTimeout(turnNoResponseTimerRef.current);
      turnNoResponseTimerRef.current = null;
    }
  };

  const scheduleTurnNoResponseTimer = (turn: number, utteranceText: string) => {
    clearTurnNoResponseTimer();
    const timeoutMs = turnNoResponseTimeoutMs(utteranceText, TURN_NO_RESPONSE_MS);
    const shortUtterance = timeoutMs < TURN_NO_RESPONSE_MS;
    const preview =
      utteranceText.length > 48 ? `${utteranceText.slice(0, 45)}…` : utteranceText;
    turnNoResponseTimerRef.current = setTimeout(() => {
      turnNoResponseTimerRef.current = null;
      if (!isActiveVoiceTurn(turn)) return;
      const timing = voiceTurnTimingRef.current;
      if (!timing || timing.turn !== turn) return;
      if (hasAssistantReplyStarted(timing.marks)) return;
      const sinceSend = Date.now() - (timing.marks.send_start ?? timing.t0);
      const logEvent = shortUtterance
        ? 'short_utterance_no_response'
        : 'turn_no_response';
      voiceLog(logEvent, {
        turn,
        sinceSendMs: sinceSend,
        timeoutMs,
        phase: voicePhaseRef.current,
        chatInFlight: chatInFlightRef.current,
        voiceSendLock: voiceSendLockRef.current,
        streamStarted: timing.marks.stream_start != null,
        textLen: utteranceText.trim().length,
        preview,
      });
      recoverThinkingStuck(logEvent, sinceSend);
    }, timeoutMs);
  };

  const recoverThinkingStuck = (reason: string, stuckMs: number) => {
    clearTurnNoResponseTimer();
    voiceLog('thinking_stuck_recovery', {
      reason,
      stuckMs,
      phase: voicePhaseRef.current,
      chatInFlight: chatInFlightRef.current,
      voiceSendLock: voiceSendLockRef.current,
    });
    setVoiceInputError('No response — check backend connection and try again.');
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatInFlightRef.current = false;
    voiceSendLockRef.current = false;
    ensureUiUnlocked();
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                streaming: false,
                text: message.text.trim() || 'No response — try again.',
              }
            : message,
        ),
      );
      activeAssistantIdRef.current = null;
    }
    const keepConversation =
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation';
    if (keepConversation) {
      setVoicePhaseTransition('idle', { force: true, reason });
      scheduleConversationListen(200);
    } else {
      releaseVoiceUi(reason);
    }
  };

  const releaseVoiceUi = (reason = 'release') => {
    cancelActiveStreamTtsDrain();
    bumpSpeakGeneration(voiceSessionRef.current, reason);
    void stopPlayback().catch(() => {});
    streamTtsDoneRef.current = false;
    resetStreamTts();
    chatInFlightRef.current = false;
    speakInFlightRef.current = false;
    ensureUiUnlocked();
    setVoicePhaseTransition('idle', { force: true, reason });
    if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
  };

  /** Hard reset chat + voice state — unsticks chatInFlight, voiceSendLock, and assistant phases. */
  const resetConversationState = (reason = 'user_reset') => {
    voiceLog('conversation_reset', { reason, phase: voicePhaseRef.current });
    clearProactiveTimer();
    proactiveSessionCountRef.current = 0;
    lastProactiveAtRef.current = 0;
    proactiveTurnActiveRef.current = false;
    setProactiveTurnActive(false);
    proactiveBeatsRef.current = [];
    clearConversationListenResumeTimer();
    clearTurnNoResponseTimer();
    resetConversationListenRetries();
    conversationListenGenRef.current += 1;
    conversationBargeGenRef.current += 1;
    stopConversationBargeIn();
    stopConversationMetering();
    stopPttMetering();
    clearVoiceMeterLevel();
    const rec = recordingRef.current;
    recordingRef.current = null;
    recordingStartedAtRef.current = 0;
    if (rec) void safeUnloadRecording(rec);
    cancelActiveStreamTtsDrain();
    abortTtsFetches(reason);
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    streamVoiceBufferRef.current = '';
    pendingStreamTextRef.current = '';
    resetStreamTts();
    clearStreamUiFlush();
    voiceSendLockRef.current = false;
    micPressRef.current = false;
    chatInFlightRef.current = false;
    speakInFlightRef.current = false;
    voiceTurnTimingRef.current = null;
    voiceTurnSummaryPendingRef.current = false;
    if (voiceTurnSummaryTimerRef.current) {
      clearTimeout(voiceTurnSummaryTimerRef.current);
      voiceTurnSummaryTimerRef.current = null;
    }
    activeAssistantIdRef.current = null;
    conversationSessionRef.current = false;
    setConversationSession(false);
    bumpTurn(voiceSessionRef.current, reason);
    bumpSpeakGeneration(voiceSessionRef.current, reason);
    bumpStreamHandlers(voiceSessionRef.current, reason);
    ensureUiUnlocked();
    setMessages([]);
    setInput('');
    setVoiceInputError(null);
    setSendBlockBanner(null);
    setTtsTapToHearText(null);
    setVoicePhaseTransition('idle', { force: true, reason });
    void stopPlayback().catch(() => {});
    void discardPrewarm();
    void refreshBackendHealth();
    if (voiceEnabledRef.current) prewarmVoiceMicIfIdle();
  };

  const maybeFinishStreamTtsIdle = (turn: number, generation: number) => {
    if (!isActiveVoiceTurn(turn) || !isActiveSpeakGeneration(generation)) return;
    if (!streamTtsDoneRef.current) return;
    if (streamTtsDrainingRef.current || streamTtsQueueRef.current.length > 0) return;
    if (speakInFlightRef.current) return;
    setVoicePhaseTransition('idle', { reason: 'stream_tts_queue_empty' });
    if (
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation'
    ) {
      scheduleConversationListen(POST_TTS_LISTEN_COOLDOWN_MS);
    }
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
        await clearStaleTtsListenBlockers();
        if (
          !isActiveVoiceTurn(turn) ||
          !isActiveSpeakGeneration(generation) ||
          !isActiveStreamTtsDrain(voiceSessionRef.current, drainGen)
        ) {
          logVoiceState('stream_tts_drain_cancel', { turn, generation });
          voiceLog('tts_skip', {
            reason: 'drain_cancelled',
            turn,
            generation,
            queueLeft: streamTtsQueueRef.current.length,
          });
          void recoverSpeakingPhaseIfIdle('drain_cancelled', {
            scheduleListen:
              conversationSessionRef.current &&
              voiceInputModeRef.current === 'conversation',
          });
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
            voiceLog('tts_skip', {
              reason: 'duplicate_play',
              preview: playKey.slice(0, 48),
            });
            continue;
          }
          lastPlayedTtsKeyRef.current = playKey;
          if (streamTtsPrefetchRef.current) {
            prefetch = streamTtsPrefetchRef.current;
            streamTtsPrefetchRef.current = null;
          } else {
            prefetch = prepareTtsClip(text.trim(), generation, {
              markFetchDone: !voiceTurnTimingRef.current?.marks.first_tts_fetch_done,
            });
          }
        }

        const path = await prefetch;
        prefetch = null;
        if (!path) {
          if (isActiveSpeakGeneration(generation)) {
            markTtsPlaybackFailed(
              lastAssistantTtsTextRef.current || streamTtsRawRef.current,
              'prepare_null',
              {
                turn,
                generation,
                activeGen: voiceSessionRef.current.speakGeneration,
              },
            );
            streamTtsQueueRef.current = [];
            return;
          }
          voiceLog('tts_skip', {
            reason: 'prepare_null_stale',
            turn,
            generation,
            activeGen: voiceSessionRef.current.speakGeneration,
          });
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
          setVoicePlaybackError(formatVoicePlaybackError(msg));
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
      } else {
        if (
          isActiveVoiceTurn(turn) &&
          isActiveSpeakGeneration(generation)
        ) {
          maybeFinishStreamTtsIdle(turn, generation);
        }
        void recoverSpeakingPhaseIfIdle('drain_end', {
          scheduleListen:
            conversationSessionRef.current &&
            voiceInputModeRef.current === 'conversation',
        });
      }
    }
  };

  const enqueueStreamTtsChunks = (chunks: string[], turn: number, generation: number) => {
    if (!voiceEnabledRef.current || chunks.length === 0) return;
    if (!isActiveVoiceTurn(turn) || !isActiveSpeakGeneration(generation)) {
      voiceLog('tts_skip', {
        reason: 'inactive_enqueue',
        turn,
        generation,
        currentGen: voiceSessionRef.current.speakGeneration,
      });
      return;
    }
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
    /** Barge handoff — skip brief Stopping… flash before listening again. */
    suppressInterruptingUi?: boolean;
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

    const showInterruptingUi =
      hadWork &&
      fromPhase !== 'interrupting' &&
      fromPhase !== 'listening' &&
      options?.suppressInterruptingUi !== true;

    if (showInterruptingUi) {
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
    ttsPlaySettledGenRef.current = -1;
    setTtsTapToHearText(null);
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

  /** Drop activeSoundRef when playback already finished (iOS can leave ref set). */
  const clearStaleActiveSoundIfIdle = async (): Promise<boolean> => {
    const sound = activeSoundRef.current;
    if (!sound) return false;
    try {
      const status = await sound.getStatusAsync();
      const statusAny = status as typeof status & {
        didJustFinish?: boolean;
        durationMillis?: number;
        positionMillis?: number;
      };
      const didJustFinish = Boolean(statusAny.didJustFinish);
      const durationMillis = statusAny.durationMillis ?? 0;
      const positionMillis = statusAny.positionMillis ?? 0;
      const nearEnd =
        durationMillis > 0 && positionMillis >= Math.max(0, durationMillis - 80);

      if (!status.isLoaded || !status.isPlaying || didJustFinish || nearEnd) {
        activeSoundRef.current = null;
        try {
          await sound.unloadAsync();
        } catch {
          // ignore
        }
        logVoiceState('clear_stale_active_sound', {});
        return true;
      }
    } catch {
      activeSoundRef.current = null;
      logVoiceState('clear_stale_active_sound', { error: true });
      return true;
    }
    return false;
  };

  const isTtsBlockingConversationListen = () =>
    streamTtsDrainingRef.current ||
    streamTtsQueueRef.current.length > 0 ||
    Boolean(activeSoundRef.current) ||
    speakInFlightRef.current;

  const clearStaleTtsListenBlockers = async () => {
    await clearStaleActiveSoundIfIdle();
    if (
      streamTtsDrainingRef.current &&
      streamTtsQueueRef.current.length === 0 &&
      !speakInFlightRef.current
    ) {
      streamTtsDrainingRef.current = false;
      logVoiceState('clear_stale_tts_draining', {});
    }
    if (
      speakInFlightRef.current &&
      !chatInFlightRef.current &&
      !activeSoundRef.current &&
      streamTtsQueueRef.current.length === 0
    ) {
      speakInFlightRef.current = false;
      logVoiceState('clear_stale_speak_in_flight', {});
    }
  };

  const getSpeakingPhaseBlockers = () => ({
    speakInFlight: speakInFlightRef.current,
    streamTtsDraining: streamTtsDrainingRef.current,
    streamTtsQueueLen: streamTtsQueueRef.current.length,
    activeSound: Boolean(activeSoundRef.current),
    chatInFlight: chatInFlightRef.current,
  });

  /** Leave speaking when playback ended/cancelled but phase was not updated. */
  const recoverSpeakingPhaseIfIdle = async (
    reason: string,
    options?: { scheduleListen?: boolean; force?: boolean },
  ) => {
    if (voicePhaseRef.current !== 'speaking') {
      if (
        options?.scheduleListen &&
        voicePhaseRef.current === 'idle' &&
        conversationSessionRef.current &&
        voiceInputModeRef.current === 'conversation' &&
        voiceEnabledRef.current
      ) {
        scheduleConversationListen(
          reason.includes('watchdog') ? 80 : POST_TTS_LISTEN_COOLDOWN_MS,
        );
      }
      return;
    }
    await clearStaleTtsListenBlockers();
    const blockers = getSpeakingPhaseBlockers();
    if (!canExitSpeakingPhaseNow(voicePhaseRef.current, blockers)) {
      voiceLog('speaking_phase_exit_blocked', {
        reason,
        phase: voicePhaseRef.current,
        speakInFlight: blockers.speakInFlight,
        draining: blockers.streamTtsDraining,
        queue: blockers.streamTtsQueueLen,
        activeSound: blockers.activeSound,
        chatInFlight: blockers.chatInFlight,
      });
      return;
    }
    const msInPhase = Date.now() - phaseChangedAtRef.current;
    voiceLog('speaking_stuck_recovery', {
      reason,
      msInPhase,
      speakInFlight: blockers.speakInFlight,
      draining: blockers.streamTtsDraining,
      queue: blockers.streamTtsQueueLen,
      activeSound: blockers.activeSound,
      chatInFlight: blockers.chatInFlight,
    });
    voiceLog('speaking_phase_exit', {
      reason,
      speakInFlight: blockers.speakInFlight,
      draining: blockers.streamTtsDraining,
      queue: blockers.streamTtsQueueLen,
      activeSound: blockers.activeSound,
      chatInFlight: blockers.chatInFlight,
    });
    stopConversationBargeIn();
    setVoicePhaseTransition('idle', {
      force: options?.force,
      reason,
    });
    if (
      options?.scheduleListen &&
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation' &&
      voiceEnabledRef.current
    ) {
      scheduleConversationListen(
        reason.includes('watchdog') ? 80 : POST_TTS_LISTEN_COOLDOWN_MS,
      );
    } else if (voiceEnabledRef.current) {
      prewarmVoiceMicIfIdle();
    }
  };

  const prepareTtsClip = async (
    text: string,
    generation: number,
    options?: { markFetchDone?: boolean },
  ): Promise<string | null> => {
    await clearStaleTtsListenBlockers();
    if (!isActiveSpeakGeneration(generation)) {
      voiceLog('tts_skip', {
        reason: 'stale_generation_fetch',
        generation,
        activeGen: voiceSessionRef.current.speakGeneration,
      });
      return null;
    }

    const spoken = prepareTextForSpeech(text.trim());
    if (!spoken) {
      voiceLog('tts_skip', { reason: 'empty_spoken', generation });
      return null;
    }

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
        voiceLog('tts_skip', { reason: 'fetch_aborted', generation });
        return null;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Voice timed out — check backend and Azure Speech');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!isActiveSpeakGeneration(generation)) {
      voiceLog('tts_skip', {
        reason: 'stale_generation_after_fetch',
        generation,
        activeGen: voiceSessionRef.current.speakGeneration,
      });
      return null;
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `TTS failed (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    if (!isActiveSpeakGeneration(generation)) {
      voiceLog('tts_skip', {
        reason: 'stale_generation_after_buffer',
        generation,
        activeGen: voiceSessionRef.current.speakGeneration,
      });
      return null;
    }

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
      await ensureIosSpeakerPrimed(generation);
      await clearStaleTtsListenBlockers();
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
        voiceLog('tts_skip', {
          reason: 'stale_generation_before_play',
          generation,
          activeGen: voiceSessionRef.current.speakGeneration,
        });
        await sound.unloadAsync();
        return;
      }

      activeSoundRef.current = sound;
      logVoiceState('tts_play_start', { generation });
      logVoiceSnapshot('play_start', { generation });
      await sound.setVolumeAsync(1.0);

      let settled = false;
      let naturalFinish = false;
      await new Promise<void>((resolve, reject) => {
        let interruptPollId: ReturnType<typeof setInterval> | null = null;
        const settle = (fn: () => void, finishedNaturally = false) => {
          if (settled) return;
          settled = true;
          if (finishedNaturally) naturalFinish = true;
          clearTimeout(timeoutId);
          if (interruptPollId) clearInterval(interruptPollId);
          try {
            sound!.setOnPlaybackStatusUpdate(null);
          } catch {
            // ignore
          }
          logVoiceSnapshot('play_settle', { naturalFinish: finishedNaturally });
          fn();
        };

        const timeoutId = setTimeout(() => {
          voiceLog('tts_failed', { reason: 'play_timeout', generation });
          settle(() =>
            reject(new Error('Playback timeout — try again or check device volume')),
          );
        }, 45_000);

        const checkFinished = (
          status: Awaited<ReturnType<Audio.Sound['getStatusAsync']>>,
        ) => {
          if (!isActiveSpeakGeneration(generation)) {
            voiceLog('tts_skip', {
              reason: 'play_interrupted_stale_gen',
              generation,
              activeGen: voiceSessionRef.current.speakGeneration,
            });
            settle(() => resolve());
            return;
          }
          if (activeSoundRef.current !== sound) {
            voiceLog('tts_skip', { reason: 'play_interrupted_sound_replaced', generation });
            settle(() => resolve());
            return;
          }
          if (!status.isLoaded) return;
          if ('error' in status && status.error) {
            voiceLog('tts_failed', {
              reason: 'play_status_error',
              generation,
              error: String(status.error),
            });
            settle(() => reject(new Error(String(status.error))));
            return;
          }
          if (status.didJustFinish) {
            settle(() => resolve(), true);
            return;
          }
          const duration = status.durationMillis ?? 0;
          const position = status.positionMillis ?? 0;
          if (duration > 0 && position >= duration - 80) {
            settle(() => resolve(), true);
          }
        };

        interruptPollId = setInterval(() => {
          if (!isActiveSpeakGeneration(generation) || activeSoundRef.current !== sound) {
            voiceLog('tts_skip', { reason: 'play_interrupted_poll', generation });
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
          const msg = e instanceof Error ? e.message : String(e);
          voiceLog('tts_failed', { reason: 'play_async_error', generation, error: msg });
          settle(() => reject(e));
        });
      });

      if (naturalFinish && isActiveSpeakGeneration(generation)) {
        markTtsPlaySettled(generation);
      }

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
      await ensureIosSpeakerPrimed(generation);

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
          setVoicePlaybackError(formatVoicePlaybackError(msg));
          return false;
        }
        if (!path) {
          if (!isActiveSpeakGeneration(generation)) return true;
          markTtsPlaybackFailed(parts.map((p) => p.text).join(' '), 'speak_parts_prepare_null', {
            generation,
            partIndex: index,
          });
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
          setVoicePlaybackError(formatVoicePlaybackError(msg));
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
      } else {
        void recoverSpeakingPhaseIfIdle('speak_parts_stale_gen', {
          scheduleListen:
            conversationSessionRef.current &&
            voiceInputModeRef.current === 'conversation',
        });
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
    const trimmedReply = reply.trim();
    if (!isActiveVoiceTurn(turn) || !voiceEnabledRef.current || !trimmedReply) {
      voiceLog('tts_skip', {
        reason: 'run_tts_no_reply',
        turn,
        voiceEnabled: voiceEnabledRef.current,
        replyLen: trimmedReply.length,
      });
      if (isActiveVoiceTurn(turn)) releaseVoiceUi();
      return;
    }

    const generation = voiceSessionRef.current.speakGeneration;
    const streamTts = shouldStreamTtsWhileOpen(
      voiceEnabledRef.current,
      naturalVoiceEnabledRef.current,
      rhythmMetaRef.current,
    );
    const scheduleListenAfter =
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation';

    markVoiceTiming(voiceTurnTimingRef.current, 'final_tts_start');

    try {
      /**
       * Stream TTS: onDone already flushed using streamTtsRawRef.
       * Do NOT re-flush formatted UI text — use raw reply and final utterance pass.
       */
      if (streamTts) {
        if (useSingleClipStreamTts(trimmedReply)) {
          voiceLog('run_tts_single_clip', { replyLen: trimmedReply.length });
          await speakStreamReplyAsSingleClip(turn, generation);
        } else {
          enqueueFinalStreamTtsIfNeeded(trimmedReply, turn, generation);
        }
        logVoiceSnapshot('before_wait_idle');
        await waitStreamTtsQueueIdle();
        logVoiceSnapshot('after_wait_idle');
        if (!isActiveVoiceTurn(turn)) return;
        await finishTtsTurnWithPlaybackCheck(trimmedReply, turn, generation, true);
        serverSpeechChunksRef.current = null;
        finishStreamTtsTurn(turn);
        return;
      }

      const parts = buildSpeakParts(trimmedReply, false, serverSpeechChunksRef.current);
      serverSpeechChunksRef.current = null;

      if (parts.length === 0) {
        voiceLog('tts_skip', { reason: 'no_speak_parts', replyLen: trimmedReply.length });
        if (trimmedReply.length > 0) {
          markTtsPlaybackFailed(trimmedReply, 'no_speak_parts', {
            replyLen: trimmedReply.length,
          });
        }
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

      await clearStaleTtsListenBlockers();
      await prepareForTtsPlayback();
      if (!isActiveVoiceTurn(turn)) return;
      let ok = await speakParts(parts);
      if (
        !ok &&
        shouldAutoRetryTts(
          ttsPlaySettledGenRef.current,
          generation,
          turn,
          ttsRetryUsedTurnRef.current,
          trimmedReply.length,
        )
      ) {
        await retryTtsPlaybackOnce(trimmedReply, turn, generation, false);
        ok = playSettledForGeneration(ttsPlaySettledGenRef.current, generation);
      }
      await finishTtsTurnWithPlaybackCheck(trimmedReply, turn, generation, false);

      if (!isActiveVoiceTurn(turn)) return;

      if (!isActiveSpeakGeneration(generation)) return;

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
    } finally {
      if (isActiveVoiceTurn(turn)) {
        await recoverSpeakingPhaseIfIdle('run_tts_finally', {
          scheduleListen: scheduleListenAfter,
        });
      }
    }
  };

  const fetchSessionGoodbyeLine = async (): Promise<string | null> => {
    try {
      const tz = getDeviceTimezone();
      const q = tz ? `?timezone=${encodeURIComponent(tz)}` : '';
      const response = await fetch(`${API_BASE}/companion/session-goodbye${q}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { line?: string | null };
      const line = data.line?.trim();
      return line || null;
    } catch {
      return null;
    }
  };

  const fetchSessionOpeningLine = async (): Promise<string | null> => {
    try {
      const tz = getDeviceTimezone();
      const q = tz ? `?timezone=${encodeURIComponent(tz)}` : '';
      const response = await fetch(`${API_BASE}/companion/session-open${q}`);
      if (!response.ok) return null;
      const data = (await response.json()) as { line?: string | null };
      const line = data.line?.trim();
      return line || null;
    } catch {
      return null;
    }
  };

  /** Warm farewell when the user taps End conversation. */
  const speakFarewell = async (text: string) => {
    if (!voiceEnabledRef.current || !text.trim()) return;

    const parts = buildSpeakParts(text.trim(), true);
    if (parts.length === 0) return;

    voiceLog('session_goodbye_start', {
      textLen: text.trim().length,
      phase: voicePhaseRef.current,
      speakGen: voiceSessionRef.current.speakGeneration,
    });

    await stopPlayback();
    cancelActiveStreamTtsDrain();
    await clearStaleTtsListenBlockers();
    if (voicePhaseRef.current !== 'idle') {
      voiceLog('session_goodbye_force_idle', { from: voicePhaseRef.current });
      setVoicePhaseTransition('idle', { force: true, reason: 'session_goodbye_prep' });
    }

    setVoicePlaybackError(null);
    setVoicePhaseTransition('speaking', { reason: 'session_goodbye' });
    const generation = voiceSessionRef.current.speakGeneration;
    await prepareForTtsPlayback();
    const ok = await speakParts(parts);
    if (!isActiveSpeakGeneration(generation)) {
      voiceLog('session_goodbye_stale_gen', {
        generation,
        activeGen: voiceSessionRef.current.speakGeneration,
      });
      void recoverSpeakingPhaseIfIdle('session_goodbye_stale_gen', { force: true });
      return;
    }
    if (ok) {
      void recoverSpeakingPhaseIfIdle('session_goodbye_done', { force: true });
    } else {
      voiceLog('session_goodbye_failed', { generation });
      releaseVoiceUi('session_goodbye_failed');
    }
  };

  /** Optional companion opener when a conversation session starts (backend decides ~38%). */
  const speakSessionOpening = async (text: string) => {
    if (!voiceEnabledRef.current || !text.trim()) return;
    if (voicePhaseRef.current !== 'idle') return;

    const parts = buildSpeakParts(text.trim(), true);
    if (parts.length === 0) return;

    setVoicePlaybackError(null);
    setVoicePhaseTransition('speaking', { reason: 'session_opening' });
    const generation = voiceSessionRef.current.speakGeneration;
    await stopPlayback();
    await prepareForTtsPlayback();
    const ok = await speakParts(parts);
    if (!isActiveSpeakGeneration(generation)) {
      void recoverSpeakingPhaseIfIdle('session_open_stale_gen', { scheduleListen: true });
      return;
    }
    if (ok) {
      if (voicePhaseRef.current === 'speaking') {
        void recoverSpeakingPhaseIfIdle('session_open_done', {
          scheduleListen: true,
          force: true,
        });
      } else {
        setVoicePhaseTransition('idle', { reason: 'session_open_done' });
        scheduleConversationListen(POST_TTS_LISTEN_COOLDOWN_MS);
      }
    } else {
      releaseVoiceUi('session_open_failed');
      if (conversationSessionRef.current) {
        scheduleConversationListen(POST_TTS_LISTEN_COOLDOWN_MS);
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
    } else {
      void recoverSpeakingPhaseIfIdle('speak_reply_stale_gen');
    }
  };

  useEffect(() => {
    return () => {
      clearConversationListenResumeTimer();
      conversationListenGenRef.current += 1;
      conversationBargeGenRef.current += 1;
      stopConversationMetering();
      stopConversationBargeIn();
      flushVoiceLogNetwork();
      if (voiceTurnSummaryTimerRef.current) {
        clearTimeout(voiceTurnSummaryTimerRef.current);
      }
      clearTurnNoResponseTimer();
    };
  }, []);

  useEffect(() => {
    return registerConversationReset(resetConversationState);
  }, []);

  /** Recover stale refs after HMR or interrupted async (chatInFlight with no active turn). */
  useEffect(() => {
    const timing = voiceTurnTimingRef.current;
    const sendStarted = timing?.marks?.send_start;
    if (
      chatInFlightRef.current &&
      (sendStarted == null ||
        shouldClearStaleChatInFlight(
          true,
          timing?.marks,
          Date.now(),
          sendStarted,
          5_000,
        ))
    ) {
      voiceLog('mount_stale_chat_cleared', {
        phase: voicePhaseRef.current,
        hadSendStart: sendStarted != null,
      });
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      chatInFlightRef.current = false;
      voiceSendLockRef.current = false;
      ensureUiUnlocked();
    }
    if (
      isAssistantActivePhase(voicePhaseRef.current) &&
      !chatInFlightRef.current &&
      !speakInFlightRef.current &&
      !streamTtsDrainingRef.current &&
      streamTtsQueueRef.current.length === 0 &&
      !activeSoundRef.current
    ) {
      voiceLog('mount_stale_phase_cleared', { phase: voicePhaseRef.current });
      setVoicePhaseTransition('idle', { force: true, reason: 'mount_recovery' });
    }
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

      if (
        phase === 'listening' &&
        conversationSessionRef.current &&
        voiceInputModeRef.current === 'conversation' &&
        stuckMs > LISTENING_STUCK_MS
      ) {
        const noRecording = !recordingRef.current;
        const msInPhase = stuckMs;
        if (
          noRecording &&
          !shouldForceIdleListeningWithoutRecording(msInPhase, false)
        ) {
          return;
        }
        const now = Date.now();
        if (now - lastWatchdogRecoveryAtRef.current < WATCHDOG_RECOVERY_COOLDOWN_MS) {
          return;
        }
        void clearStaleTtsListenBlockers().then(() => {
          const blocked = isTtsBlockingConversationListen();
          if (noRecording || blocked) {
            lastWatchdogRecoveryAtRef.current = Date.now();
            logVoiceState('watchdog_listening_stuck', {
              stuckMs,
              noRecording,
              blocked,
            });
            if (
              noRecording &&
              shouldForceIdleListeningWithoutRecording(msInPhase, false)
            ) {
              setVoicePhaseTransition('idle', {
                force: true,
                reason: 'watchdog_listen_no_rec',
              });
            }
            ensureConversationListening('watchdog_listening_stuck');
          }
        });
        return;
      }

      if (
        phase === 'idle' &&
        conversationSessionRef.current &&
        voiceInputModeRef.current === 'conversation' &&
        !recordingRef.current &&
        shouldRecoverListenPausedStuck(
          stuckMs,
          Boolean(conversationListenResumeTimerRef.current),
        )
      ) {
        const now = Date.now();
        if (now - lastWatchdogRecoveryAtRef.current < WATCHDOG_RECOVERY_COOLDOWN_MS) {
          return;
        }
        lastWatchdogRecoveryAtRef.current = now;
        void recoverListenPausedIfStuck('watchdog_idle_reopen', stuckMs);
        return;
      }

      if (phase === 'speaking') {
        void clearStaleTtsListenBlockers().then(() => {
          const blockers = getSpeakingPhaseBlockers();
          if (!shouldRecoverStuckSpeakingPhase(phase, blockers, stuckMs)) {
            return;
          }
          const now = Date.now();
          if (now - lastWatchdogRecoveryAtRef.current < WATCHDOG_RECOVERY_COOLDOWN_MS) {
            return;
          }
          lastWatchdogRecoveryAtRef.current = now;
          voiceLog('speaking_stuck', {
            stuckMs,
            thresholdMs: SPEAKING_STUCK_MS,
            speakInFlight: blockers.speakInFlight,
            draining: blockers.streamTtsDraining,
            queue: blockers.streamTtsQueueLen,
            activeSound: blockers.activeSound,
            chatInFlight: blockers.chatInFlight,
          });
          logVoiceState('watchdog_speaking_stuck', { stuckMs });
          void recoverSpeakingPhaseIfIdle('watchdog_speaking_stuck', {
            force: true,
            scheduleListen:
              conversationSessionRef.current &&
              voiceInputModeRef.current === 'conversation',
          });
        });
        return;
      }

      if (phase === 'thinking') {
        const timing = voiceTurnTimingRef.current;
        const currentTurn = voiceSessionRef.current.turn;
        const turnTiming = timing?.turn === currentTurn ? timing : null;
        const streamStarted = turnTiming?.marks.stream_start != null;
        const sendStarted = turnTiming?.marks.send_start != null;
        const thinkingThresholdMs = turnNoResponseTimeoutMs(
          lastVoiceSendTextRef.current,
          THINKING_NO_STREAM_MS,
        );
        if (
          shouldRecoverThinkingNoStream(
            phase,
            stuckMs,
            {
              sendStarted,
              streamStarted,
            },
            thinkingThresholdMs,
          )
        ) {
          const now = Date.now();
          if (now - lastWatchdogRecoveryAtRef.current < WATCHDOG_RECOVERY_COOLDOWN_MS) {
            return;
          }
          lastWatchdogRecoveryAtRef.current = now;
          recoverThinkingStuck('watchdog_thinking_no_stream', stuckMs);
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

  const processVoiceUtterance = async (
    uri: string,
    utteranceId: number,
    options?: { fromConversation?: boolean; meterMeta?: QuietListenMeterMeta },
  ) => {
    if (utteranceId !== voiceUtteranceRef.current) {
      voiceLog('voice_send_skipped', { reason: 'stale_utterance', utteranceId });
      return;
    }
    if (voiceSendLockRef.current) {
      voiceLog('voice_send_skipped', { reason: 'voice_send_lock', utteranceId });
      return;
    }

    voiceSendLockRef.current = true;
    const fromConversation =
      options?.fromConversation === true && conversationSessionRef.current;
    try {
      voiceLog('stt_transcribe_start', {
        utteranceId,
        fromConversation,
      });
      const transcript = await transcribeRecording(uri, API_BASE);
      voiceLog('stt_result', {
        fromConversation,
        len: transcript.length,
        preview:
          transcript.length > 60 ? `${transcript.slice(0, 57)}…` : transcript,
      });
      if (utteranceId !== voiceUtteranceRef.current) {
        voiceLog('voice_send_skipped', {
          reason: 'stale_utterance_after_stt',
          utteranceId,
        });
        if (fromConversation) {
          scheduleConversationListen(200);
        }
        return;
      }
      if (
        voicePhaseRef.current !== 'thinking' &&
        voicePhaseRef.current !== 'streaming'
      ) {
        voiceLog('voice_send_skipped', {
          reason: 'wrong_phase_after_stt',
          phase: voicePhaseRef.current,
          fromConversation,
        });
        setVoiceInputError('Could not send — try again.');
        if (fromConversation) {
          setVoicePhaseTransition('idle', { reason: 'wrong_phase_after_stt' });
          scheduleConversationListen(200);
        } else {
          setVoicePhaseTransition('idle', { reason: 'wrong_phase_after_stt' });
          prewarmVoiceMicIfIdle();
        }
        return;
      }
      if (
        fromConversation &&
        activeSoundRef.current
      ) {
        logVoiceState('stt_ignored_during_tts', {
          phase: voicePhaseRef.current,
          preview:
            transcript.length > 48 ? `${transcript.slice(0, 45)}…` : transcript,
          activeSound: true,
        });
        retryConversationListen();
        return;
      }

    if (fromConversation && isLikelyAssistantEcho(transcript)) {
        logVoiceState('echo_suppressed', {
          preview:
            transcript.length > 48 ? `${transcript.slice(0, 45)}…` : transcript,
          activeSound: Boolean(activeSoundRef.current),
        });
        setVoiceInputError('That was my voice — say yours again.');
        setVoicePhaseTransition('idle', { reason: 'echo_suppressed' });
        retryConversationListen(300);
        return;
      }
      if (!isSubstantiveTranscript(transcript)) {
        logVoiceState('stt_rejected_substantive', {
          preview:
            transcript.length > 48 ? `${transcript.slice(0, 45)}…` : transcript,
          len: transcript.length,
        });
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
      resetProactiveOnUserSpeech();
      quietListenRetryUsedRef.current = false;
      voiceSendLockRef.current = false;
      const sent = await sendMessage(transcript);
      if (!sent) {
        voiceLog('send_after_stt_skipped', {
          phase: voicePhaseRef.current,
          chatInFlight: chatInFlightRef.current,
          fromConversation,
          transcriptLen: transcript.length,
          preview:
            transcript.length > 60 ? `${transcript.slice(0, 57)}…` : transcript,
        });
        setVoiceInputError('Could not send — try again.');
        if (fromConversation) {
          setVoicePhaseTransition('idle', { reason: 'send_skipped_after_stt' });
          scheduleConversationListen(200);
        } else {
          setVoicePhaseTransition('idle', { reason: 'send_skipped_after_stt' });
          prewarmVoiceMicIfIdle();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice input failed';
      if (fromConversation && isEmptySttError(err)) {
        logVoiceState('stt_empty', {
          preview: msg.length > 80 ? `${msg.slice(0, 77)}…` : msg,
          phase: voicePhaseRef.current,
          peakDb: options?.meterMeta?.peakMetering ?? null,
          speechMs: options?.meterMeta?.speechDurationMs ?? 0,
        });
        const meta = options?.meterMeta;
        if (
          meta &&
          shouldSecondChanceQuietListen(meta) &&
          !quietListenRetryUsedRef.current
        ) {
          quietListenRetryUsedRef.current = true;
          voiceLog('quiet_listen_retry', {
            peakDb: meta.peakMetering,
            speechMs: meta.speechDurationMs,
          });
          setVoiceInputError('Speak a bit closer — listening again…');
          setVoicePhaseTransition('idle');
          scheduleConversationListen(100);
          return;
        }
      }
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
    if (micPressRef.current) {
      logMicTapBlocked('ptt_already_pressed');
      return;
    }
    if (!voiceEnabledRef.current) {
      logMicTapBlocked('voice_disabled', { gesture: 'press_in' });
      setVoiceInputError('Turn on voice to use the mic.');
      return;
    }

    voiceLog('mic_tap', {
      mode: 'ptt',
      gesture: 'press_in',
      phase: voicePhaseRef.current,
    });

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
        stopPttMetering();
        clearVoiceMeterLevel();
        setVoicePhaseTransition('idle');
        prewarmVoiceMicIfIdle();
        return;
      }
      recordingRef.current = recording;
      recordingStartedAtRef.current = Date.now();
      beginPttMeter();
    } catch (err) {
      stopPttMetering();
      clearVoiceMeterLevel();
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
    stopPttMetering();
    clearVoiceMeterLevel();
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

  const sendMessage = async (
    messageText?: string,
    sendOptions?: {
      proactive?: boolean;
      threadBeat?: string;
      skipUserBubble?: boolean;
    },
  ): Promise<boolean> => {
    const isProactive = sendOptions?.proactive === true;
    const text = (messageText ?? input).trim();
    const fromVoice = messageText !== undefined || isProactive;
    const conversationMode =
      conversationSessionRef.current &&
      voiceInputModeRef.current === 'conversation';

    const timing = voiceTurnTimingRef.current;
    const staleChatThresholdMs = turnNoResponseTimeoutMs(text, THINKING_NO_STREAM_MS);
    if (
      shouldClearStaleChatInFlight(
        chatInFlightRef.current,
        timing?.marks,
        Date.now(),
        timing?.marks.send_start,
        staleChatThresholdMs,
      )
    ) {
      voiceLog('send_message_stale_chat_cleared', {
        phase: voicePhaseRef.current,
        sinceSendMs: timing?.marks.send_start
          ? Date.now() - timing.marks.send_start
          : null,
        streamStarted: timing?.marks.stream_start != null,
        streamDone: timing?.marks.stream_done != null,
      });
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      chatInFlightRef.current = false;
    }

    // Typed send preempts a stuck or in-flight assistant turn before skip guards.
    if (!fromVoice && text) {
      if (voicePhaseRef.current === 'listening') {
        stopConversationListening();
      }
      if (
        chatInFlightRef.current ||
        voiceSendLockRef.current ||
        isAssistantActivePhase(voicePhaseRef.current)
      ) {
        if (conversationMode) {
          interruptConversationAssistant();
        } else {
          interruptAssistant();
        }
        voiceSendLockRef.current = false;
        chatInFlightRef.current = false;
        ensureUiUnlocked();
      }
    }

    const skipReason = getSendMessageSkipReason({
      text,
      isProactive,
      chatInFlight: chatInFlightRef.current,
      voiceSendLock: voiceSendLockRef.current,
      phase: voicePhaseRef.current,
      fromVoice,
      conversationMode: Boolean(conversationMode),
    });
    if (skipReason) {
      const banner = formatSendBlockBanner(skipReason, {
        phase: voicePhaseRef.current,
        chatInFlight: chatInFlightRef.current,
        voiceSendLock: voiceSendLockRef.current,
        fromVoice,
      });
      setSendBlockBanner(banner);
      voiceLog('send_blocked', {
        reason: skipReason,
        textLen: text.length,
        phase: voicePhaseRef.current,
        fromVoice,
        chatInFlight: chatInFlightRef.current,
        voiceSendLock: voiceSendLockRef.current,
      });
      voiceLog('send_message_skipped', {
        reason: skipReason,
        textLen: text.length,
        phase: voicePhaseRef.current,
        fromVoice,
        chatInFlight: chatInFlightRef.current,
      });
      if (!fromVoice && skipReason === 'chat_in_flight') {
        setVoiceInputError('Still working on the last message — tap Send again or tap Mic to interrupt.');
      }
      return false;
    }

    setSendBlockBanner(null);

    if (isProactive) {
      clearProactiveTimer();
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
    } else if (voiceEnabledRef.current && text) {
      bumpTurn(voiceSessionRef.current, 'typed_message');
      bumpSpeakGeneration(voiceSessionRef.current, 'typed_message');
      bumpStreamHandlers(voiceSessionRef.current, 'typed_message');
      abortTtsFetches('typed_message');
      cancelActiveStreamTtsDrain();
      streamVoiceBufferRef.current = '';
      pendingStreamTextRef.current = '';
      resetStreamTts();
      clearStreamUiFlush();
      await stopPlayback();
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    } else {
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) void rec.stopAndUnloadAsync().catch(() => {});
    }

    const turn = voiceSessionRef.current.turn;
    ttsPlaySettledGenRef.current = -1;
    ttsRetryUsedTurnRef.current = -1;
    setTtsTapToHearText(null);
    setVoiceLogContext(turn, voiceSessionRef.current.speakGeneration);
    if (voiceTurnSummaryPendingRef.current && voiceTurnTimingRef.current) {
      logVoiceTurnSummary(voiceTurnTimingRef.current);
    }
    voiceTurnSummaryPendingRef.current = false;
    if (voiceTurnSummaryTimerRef.current) {
      clearTimeout(voiceTurnSummaryTimerRef.current);
      voiceTurnSummaryTimerRef.current = null;
    }
    voiceTurnTimingRef.current = createVoiceTurnTiming(turn);
    markVoiceTiming(voiceTurnTimingRef.current, 'send_start');
    voiceLog('send_message', {
      fromVoice,
      proactive: isProactive,
      textLen: text.length,
      preview: text.length > 48 ? `${text.slice(0, 45)}…` : text,
    });
    logVoiceSnapshot('send_start');
    chatInFlightRef.current = true;
    if (text && (fromVoice || voiceEnabledRef.current)) {
      lastVoiceSendTextRef.current = text;
      scheduleTurnNoResponseTimer(turn, text);
    }

    if (voiceEnabledRef.current) {
      const phase = voicePhaseRef.current;
      if (
        phase === 'idle' ||
        phase === 'listening' ||
        phase === 'thinking' ||
        phase === 'streaming' ||
        phase === 'speaking'
      ) {
        setVoicePhaseTransition('thinking', {
          reason: 'send_message',
          force: phase === 'speaking' || phase === 'interrupting',
        });
      }
    }

    const streamHandlerGen = voiceSessionRef.current.streamHandlerGen;

    const userMessage: ChatMessage | null =
      sendOptions?.skipUserBubble || isProactive
        ? null
        : {
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
    currentReplyIsSingingRef.current = false;

    const abortController = new AbortController();
    chatAbortRef.current = abortController;
    ensureTtsAbortSignal();

    setMessages((prev) => [
      ...prev,
      ...(userMessage ? [userMessage] : []),
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);
    if (messageText === undefined) setInput('');
    setLoading(true);
    setIsStreaming(false);
    scrollToEnd();

    let streamFinished = false;
    let replyForTts = '';
    let sendSucceeded = true;

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
            clearTurnNoResponseTimer();
            rhythmMetaRef.current = meta?.rhythm ?? null;
            if (meta?.rhythm?.proactive_beats?.length) {
              proactiveBeatsRef.current = meta.rhythm.proactive_beats;
            }
            setLoading(false);
            setIsStreaming(true);
            if (voiceEnabledRef.current) {
              setVoicePhaseTransition('streaming', {
                reason: 'stream_start',
                force: voicePhaseRef.current === 'speaking',
              });
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
            clearTurnNoResponseTimer();
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
            if (meta.proactive_beats?.length) {
              proactiveBeatsRef.current = meta.proactive_beats;
            }
            currentReplyIsSingingRef.current = meta.singing === true;
          },
          onDone: (reply) => {
            if (abortController.signal.aborted) return reply;
            if (!isActiveStreamHandler(voiceSessionRef.current, streamHandlerGen)) return reply;
            if (!isActiveVoiceTurn(turn)) return reply;
            if (streamFinished) return reply;
            streamFinished = true;
            streamTtsDoneRef.current = true;
            markVoiceTiming(voiceTurnTimingRef.current, 'stream_done');
            clearTurnNoResponseTimer();
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
                  ? {
                      ...message,
                      text: displayReply,
                      streaming: false,
                      singing: currentReplyIsSingingRef.current,
                    }
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
        wearablesChatHeaders(),
        isProactive
          ? { proactive: true, threadBeat: sendOptions?.threadBeat }
          : undefined,
      );

      const ttsReply =
        replyForTts.trim() ||
        streamTtsRawRef.current.trim() ||
        streamVoiceBufferRef.current.trim();
      if (voiceEnabledRef.current && ttsReply) {
        if (isActiveVoiceTurn(turn)) {
          await runTtsForReply(ttsReply, turn);
        } else {
          voiceLog('tts_skip', {
            reason: 'stale_turn_after_stream',
            turn,
            activeTurn: voiceSessionRef.current.turn,
            replyLen: ttsReply.length,
          });
          markTtsPlaybackFailed(ttsReply, 'stale_turn_after_stream', {
            turn,
            activeTurn: voiceSessionRef.current.turn,
          });
          if (
            conversationSessionRef.current &&
            voiceInputModeRef.current === 'conversation'
          ) {
            setVoicePhaseTransition('idle', { reason: 'stale_turn_after_stream' });
            retryConversationListen();
          }
        }
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
      sendSucceeded = false;
      clearTurnNoResponseTimer();
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
        return false;
      }
      const errText =
        error instanceof Error ? error.message : 'Something went wrong';
      if (
        errText.toLowerCase().includes('network') ||
        errText.toLowerCase().includes('reachable') ||
        errText.toLowerCase().includes('fetch')
      ) {
        void refreshBackendHealth();
      }
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
      return false;
    } finally {
      if (!isActiveVoiceTurn(turn)) {
        logVoiceState('send_message_stale_finally', { turn });
        chatInFlightRef.current = false;
        voiceSendLockRef.current = false;
        clearTurnNoResponseTimer();
        if (chatAbortRef.current === abortController) {
          chatAbortRef.current = null;
        }
        ensureUiUnlocked();
        if (
          conversationSessionRef.current &&
          voiceInputModeRef.current === 'conversation' &&
          voicePhaseRef.current === 'idle'
        ) {
          retryConversationListen();
        }
        return false;
      }
      void fetchCompanionFromHealth().then((health) => {
        if (health.name) setCompanionName(health.name);
        setSkillHints(health.skillHints);
      });
      clearStreamUiFlush();
      chatInFlightRef.current = false;
      voiceSendLockRef.current = false;
      if (streamFinished || hasAssistantReplyStarted(voiceTurnTimingRef.current?.marks)) {
        clearTurnNoResponseTimer();
      }
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
      }
      activeAssistantIdRef.current = null;
      ensureUiUnlocked();
      if (
        (voicePhaseRef.current === 'thinking' ||
          voicePhaseRef.current === 'streaming' ||
          voicePhaseRef.current === 'speaking') &&
        !speakInFlightRef.current &&
        streamTtsQueueRef.current.length === 0 &&
        !streamTtsDrainingRef.current
      ) {
        if (voicePhaseRef.current === 'speaking') {
          void recoverSpeakingPhaseIfIdle('send_finally_speaking', {
            scheduleListen:
              conversationSessionRef.current &&
              voiceInputModeRef.current === 'conversation',
            force: true,
          }).then(() => {
            if (voicePhaseRef.current !== 'speaking') return;
            setVoicePhaseTransition('idle', {
              force: true,
              reason: 'send_finally_force',
            });
            if (
              conversationSessionRef.current &&
              voiceInputModeRef.current === 'conversation'
            ) {
              scheduleConversationListen();
            }
          });
        } else {
          setVoicePhaseTransition('idle', { reason: 'send_finally_idle' });
          if (
            conversationSessionRef.current &&
            voiceInputModeRef.current === 'conversation'
          ) {
            scheduleConversationListen();
          }
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
      const waitForListen =
        conversationSessionRef.current &&
        voiceInputModeRef.current === 'conversation' &&
        voiceEnabledRef.current;
      if (waitForListen && voiceTurnTimingRef.current) {
        voiceTurnSummaryPendingRef.current = true;
        scheduleVoiceTurnSummaryFallback();
      } else {
        logVoiceTurnSummary(voiceTurnTimingRef.current);
        voiceTurnTimingRef.current = null;
      }
      logVoiceSnapshot('send_finally');
      if (isProactive) {
        proactiveTurnActiveRef.current = false;
        setProactiveTurnActive(false);
      }
    }
    return sendSucceeded;
  };

  const pressSend = (source: 'send_button' | 'keyboard') => {
    const text = input.trim();
    voiceLog('send_button_pressed', {
      source,
      textLen: text.length,
      phase: voicePhaseRef.current,
      chatInFlight: chatInFlightRef.current,
      voiceSendLock: voiceSendLockRef.current,
      voiceEnabled: voiceEnabledRef.current,
      conversationSession: conversationSessionRef.current,
    });
    if (!text) {
      setSendBlockBanner('Send blocked: empty message');
      voiceLog('send_blocked', { reason: 'empty_text', source });
      return;
    }
    if (voicePhaseRef.current === 'recording') {
      setSendBlockBanner('Send blocked: finish recording before sending text');
      voiceLog('send_blocked', { reason: 'recording', source });
      setVoiceInputError('Finish recording before sending text.');
      return;
    }
    void sendMessage().catch((err) => {
      setSendBlockBanner(
        `Send failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      voiceLog('send_failed', {
        source,
        message: err instanceof Error ? err.message : 'unknown',
      });
    });
  };

  useEffect(() => {
    if (
      voicePhase !== 'listening' &&
      voicePhase !== 'recording' &&
      voicePhase !== 'speaking'
    ) {
      clearVoiceMeterLevel();
      stopPttMetering();
    } else if (voicePhase !== 'recording') {
      stopPttMetering();
    }
  }, [voicePhase]);

  const busy = loading || isStreaming;
  const inputLockReason = getInputLockReason(voicePhase);
  const inputLocked = inputLockReason === 'recording';
  const sendEnabled = input.trim().length > 0 && voicePhase !== 'recording';
  const phaseLabel = voicePhaseLabel(voicePhase, isStreaming, conversationSession, {
    proactive: proactiveTurnActive,
    companionName,
  });
  const phaseHint = voicePhaseHint(voicePhase, isStreaming, conversationSession);
  const voiceWaveInputVisible =
    voicePhase === 'listening' || voicePhase === 'recording';
  if (
    voicePhase === 'speaking' &&
    voiceSessionActive
  ) {
    if (voiceMeterLevel > VOICE_WAVE_BARGE_SHOW_LEVEL) {
      voiceWaveBargeHeldRef.current = true;
    } else if (voiceMeterLevel < VOICE_WAVE_BARGE_HIDE_LEVEL) {
      voiceWaveBargeHeldRef.current = false;
    }
  } else {
    voiceWaveBargeHeldRef.current = false;
  }
  const voiceWaveBargeVisible =
    voicePhase === 'speaking' && voiceSessionActive && voiceWaveBargeHeldRef.current;
  const voiceWaveVisible = voiceWaveInputVisible || voiceWaveBargeVisible;
  const voiceWaveSubtle = voiceWaveBargeVisible && !voiceWaveInputVisible;
  const voiceHeroVoiceActive =
    voicePhase === 'listening' ||
    voicePhase === 'recording' ||
    voicePhase === 'speaking' ||
    voicePhase === 'thinking' ||
    voicePhase === 'streaming' ||
    voicePhase === 'interrupting';
  const showVoiceHero =
    voiceEnabled &&
    (voiceWaveInputVisible ||
      (voiceSessionActive && (!typingTextOnly || voiceHeroSessionHeld)) ||
      (!typingTextOnly && voiceHeroVoiceActive && !voiceSessionActive));
  const voiceHeroCompact =
    showVoiceHero &&
    !voiceSessionActive &&
    !voiceWaveInputVisible &&
    voicePhase !== 'speaking' &&
    voicePhase !== 'thinking' &&
    voicePhase !== 'streaming' &&
    voicePhase !== 'interrupting';
  const voiceWaveAmbient = showVoiceHero && !voiceWaveVisible;
  const conversationCanInterrupt =
    voiceInputMode === 'conversation' &&
    conversationSession &&
    isAssistantActivePhase(voicePhase);
  const voiceStatusHint = ttsTapToHearText
    ? 'No audio heard · Tap to hear'
    : voicePlaybackError
      ? `${voicePlaybackError} · tap to hear`
      : phaseHint;
  const handleVoiceStatusTap = () => {
    if (ttsTapToHearText?.trim()) {
      const replay = ttsTapToHearText;
      setTtsTapToHearText(null);
      setVoicePlaybackError(null);
      void speakReply(replay).catch(() => {
        releaseVoiceUi();
      });
      return;
    }
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
  };
  const voiceHeroProps = {
    companionName,
    phaseLabel,
    phaseHint: voiceStatusHint,
    level: voiceMeterLevel,
    meterDbfs: voiceMeterDbfs,
    meterVisible: voiceWaveInputVisible,
    speakLouderHint,
    waveVisible: voiceWaveVisible,
    waveSubtle: voiceWaveSubtle,
    ambient: voiceWaveAmbient,
    compact: voiceHeroCompact,
  };
  const micShowSpinner =
    voicePhase === 'thinking' ||
    voicePhase === 'streaming' ||
    (busy &&
      voicePhase !== 'idle' &&
      voicePhase !== 'recording' &&
      voicePhase !== 'listening');
  const micConversationActive =
    voiceInputMode === 'conversation' &&
    (conversationSession || voicePhase === 'listening');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitles}>
            <Text style={styles.title}>{companionName}</Text>
            <Text style={styles.nameHint}>Say &quot;call you …&quot; to rename her</Text>
          </View>
          <Link href="/settings" asChild>
            <Pressable
              style={({ pressed }) => [styles.settingsButton, pressed && styles.settingsButtonPressed]}
              accessibilityLabel="Open settings"
            >
              <Text style={styles.settingsIcon}>⚙</Text>
            </Pressable>
          </Link>
        </View>
        {skillHints.length > 0 ? (
          <Text style={styles.skillHintsLine}>{skillHints.join(' · ')}</Text>
        ) : null}
        {backendHealthBanner ? (
          <Text style={styles.healthBanner}>{backendHealthBanner}</Text>
        ) : null}
        {sendBlockBanner ? (
          <Pressable
            onPress={() => resetConversationState('banner_tap_reset')}
            style={({ pressed }) => [
              styles.sendBlockBanner,
              pressed && styles.sendBlockBannerPressed,
            ]}
            accessibilityLabel="Send blocked — tap to reset conversation"
          >
            <Text style={styles.sendBlockBannerText}>{sendBlockBanner}</Text>
            <Text style={styles.sendBlockBannerHint}>Tap to reset conversation</Text>
          </Pressable>
        ) : null}
        {inputLockReason === 'recording' ? (
          <Text style={styles.sendBlockBannerText}>
            Text input paused while recording — release Mic to type
          </Text>
        ) : null}
        {conversationSession && voiceInputMode === 'conversation' ? (
          <Pressable
            onPress={endConversationSessionManually}
            style={({ pressed }) => [
              styles.endConversationButton,
              pressed && styles.endConversationButtonPressed,
            ]}
            accessibilityLabel="End conversation"
          >
            <Text style={styles.endConversationLabel}>End conversation</Text>
          </Pressable>
        ) : null}
        {voiceEnabled && !showVoiceHero ? (
          <TouchableOpacity onPress={handleVoiceStatusTap}>
            <Text style={styles.voiceHint}>
              {ttsTapToHearText
                ? 'No audio heard · Tap to hear'
                : voicePlaybackError
                  ? `${voicePlaybackError} · tap to hear`
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

      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {showVoiceHero ? (
          <Pressable
            onPress={handleVoiceStatusTap}
            style={({ pressed }) => [pressed && styles.voiceHeroPressed]}
            accessibilityRole="button"
            accessibilityLabel={
              ttsTapToHearText
                ? 'No audio heard. Tap to hear the reply.'
                : voicePlaybackError
                  ? `${voicePlaybackError}. Tap to hear or interrupt.`
                  : 'Voice status. Tap to test or interrupt.'
            }
          >
            <VoiceHero {...voiceHeroProps} />
          </Pressable>
        ) : null}

        <FlatList
          ref={listRef}
          style={styles.list}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => scrollToEnd(false)}
          onLayout={() => scrollToEnd(false)}
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
                {item.role === 'assistant' && item.singing ? '♪ ' : ''}
                {item.streaming && !item.text ? '…' : item.text}
                {item.streaming && item.text ? ' ▋' : ''}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Say hello to {companionName}.</Text>
          }
        />

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
              if (!voiceEnabled) {
                logMicTapBlocked('voice_disabled', { gesture: 'press_in' });
                return;
              }
              if (voiceInputMode === 'conversation') return;
              void onMicPressIn().catch(() => {});
            }}
            onPressOut={() => {
              if (voiceInputMode === 'conversation') return;
              void onMicPressOut().catch(() => {});
            }}
            onPress={() => {
              if (!voiceEnabled) {
                logMicTapBlocked('voice_disabled', { gesture: 'press' });
                setVoiceInputError('Turn on voice to use the mic.');
                return;
              }
              if (voiceInputMode === 'conversation') {
                onConversationMicPress();
                return;
              }
              logMicTapBlocked('ptt_use_hold', { gesture: 'press' });
            }}
            disabled={!voiceEnabled}
            accessibilityState={{ disabled: !voiceEnabled }}
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
            onChangeText={(value) => {
              setInput(value);
              if (sendBlockBanner) setSendBlockBanner(null);
            }}
            onFocus={() => {
              setInputFocused(true);
              scrollToEnd(true);
              if (voicePhaseRef.current === 'listening') {
                stopConversationListening();
              }
            }}
            onBlur={() => setInputFocused(false)}
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
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => pressSend('keyboard')}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              !sendEnabled && styles.sendDisabled,
              (loading ||
                voicePhase === 'thinking' ||
                voicePhase === 'streaming') &&
                styles.sendDisabled,
            ]}
            onPress={() => pressSend('send_button')}
            disabled={!sendEnabled}
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
  container: { flex: 1, backgroundColor: '#faf7f5' },
  chatArea: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ead9d4',
    backgroundColor: '#faf7f5',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitles: { flex: 1 },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ead9d4',
  },
  settingsButtonPressed: { backgroundColor: '#f3ebe8' },
  settingsIcon: { fontSize: 20, color: '#9a8ab0' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#4a3f42',
    marginBottom: 4,
  },
  nameHint: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 8,
  },
  skillHintsLine: {
    fontSize: 11,
    color: '#888888',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  healthBanner: {
    fontSize: 12,
    color: '#b45309',
    marginBottom: 8,
    lineHeight: 16,
  },
  sendBlockBanner: {
    backgroundColor: '#fecaca',
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  sendBlockBannerPressed: {
    backgroundColor: '#fca5a5',
  },
  sendBlockBannerText: {
    fontSize: 12,
    color: '#991b1b',
    fontWeight: '600',
    lineHeight: 16,
  },
  sendBlockBannerHint: {
    fontSize: 11,
    color: '#b91c1c',
    marginTop: 4,
  },
  endConversationButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#eeeeee',
    borderWidth: 1,
    borderColor: '#cccccc',
  },
  endConversationButtonPressed: {
    backgroundColor: '#e0e0e0',
  },
  endConversationLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
  },
  voiceHint: { fontSize: 12, color: '#7a6e72', marginTop: 6 },
  voiceHeroPressed: { opacity: 0.92 },
  voiceError: { fontSize: 12, color: '#c62828', marginTop: 4 },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#c97b84',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  micButtonActive: {
    backgroundColor: '#f8ecee',
    borderColor: '#a8616a',
  },
  micButtonDisabled: {
    opacity: 0.45,
  },
  micLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#c97b84',
  },
  list: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 8 },
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
