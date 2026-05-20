import { Audio, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** LAN URL of the FastAPI backend (same Wi‑Fi as the phone). Override in `.env`: EXPO_PUBLIC_API_BASE */
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.178:8000';
const API_URL = `${API_BASE}/chat`;
const TTS_URL = `${API_BASE}/tts`;

const SILENT_SOUND = require('../assets/silent.wav');

const FILLER_PHRASES = ['Hmm...', 'I see...', 'Interesting...'] as const;

/** Optional filler when natural voice mode is on (~30–40% of replies). */
const FILLER_CHANCE = 0.35;
const RECENT_FILLER_MEMORY = 2;

/** Brief pause before first chunk (after Azure round-trip). */
const PRE_SPEAK_MS = 80;

/** Chunk size: larger = fewer round-trips (slightly snappier overall). */
const CHUNK_MAX_CHARS = 120;

type SpeakPartKind = 'filler' | 'chunk' | 'test';

type SpeakPart = {
  text: string;
  kind: SpeakPartKind;
};

type AzureTtsStatus = {
  ready?: boolean;
  voice?: string;
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

async function fetchAzureVoiceLabel(): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return 'Azure (check backend)';
    const data = (await response.json()) as { azure_tts?: AzureTtsStatus };
    const azure = data.azure_tts;
    if (azure?.ready && azure.voice) return azure.voice;
    if (azure?.hint) {
      const h = azure.hint;
      return h.length > 100 ? `${h.slice(0, 97)}…` : h;
    }
    return 'Azure not configured';
  } catch {
    return 'Azure (offline)';
  }
}

/** Remove emoji and symbols so TTS does not read them aloud. */
function stripEmojisAndSymbols(text: string): string {
  let cleaned = text;

  try {
    cleaned = cleaned.replace(/\p{Extended_Pictographic}+/gu, '');
    cleaned = cleaned.replace(/\p{Emoji}+/gu, '');
  } catch {
    cleaned = cleaned.replace(
      /(?:\uD83C[\uD000-\uDFFF]|\uD83D[\uD000-\uDFFF]|\uD83E[\uD000-\uDFFF]|[\u2600-\u27BF])/g,
      '',
    );
  }

  return cleaned
    .replace(/[@#$%^&*+=|\\<>~`[\]{}©®™°§¶•·/]/g, '')
    .replace(/[\u200B-\u200D\uFEFF\uFE0F]/g, '')
    .replace(/[*_#`]/g, '');
}

function prepareTextForSpeech(text: string): string {
  return stripEmojisAndSymbols(text)
    .replace(/\s+/g, ' ')
    .replace(/…/g, '.')
    .trim();
}

function splitLongSegment(segment: string): string[] {
  const words = segment.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  let buffer = '';

  for (const word of words) {
    const next = buffer ? `${buffer} ${word}` : word;
    if (next.length > CHUNK_MAX_CHARS && buffer) {
      parts.push(buffer);
      buffer = word;
    } else {
      buffer = next;
    }
  }

  if (buffer) parts.push(buffer);
  return parts;
}

/** Split at punctuation, then cap length — avoids one long continuous utterance. */
function splitIntoSpeechChunks(text: string): string[] {
  const cleaned = prepareTextForSpeech(text);
  const segments = cleaned
    .split(/(?<=[.!?;:,])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const chunks: string[] = [];
  for (const segment of segments) {
    if (segment.length <= CHUNK_MAX_CHARS) {
      chunks.push(segment);
    } else {
      chunks.push(...splitLongSegment(segment));
    }
  }

  const nonEmpty = chunks.filter((chunk) => /[a-zA-Z0-9]/.test(chunk));
  return nonEmpty.length > 0 ? nonEmpty : cleaned && /[a-zA-Z0-9]/.test(cleaned) ? [cleaned] : [];
}

function pauseAfterChunk(part: SpeakPart, hasMore: boolean): number {
  if (!hasMore) return 0;
  if (part.kind === 'filler') return 45;

  const t = part.text.trim();
  if (/[.!?]$/.test(t)) return 160;
  if (t.endsWith(',')) return 110;
  if (/[:;]$/.test(t)) return 130;
  return 75;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
};

type StreamEvent =
  | { start: true }
  | { text: string }
  | { done: true; reply: string }
  | { error: string };

function pickFillerPhrase(recentFillers: string[]): string | null {
  if (Math.random() > FILLER_CHANCE) return null;

  const pool = FILLER_PHRASES.filter((phrase) => !recentFillers.includes(phrase));
  const choices = pool.length > 0 ? pool : [...FILLER_PHRASES];
  return choices[Math.floor(Math.random() * choices.length)] ?? null;
}

async function configureAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

function parseNdjsonLines(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: StreamEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // Partial line; keep in buffer.
    }
  }

  return { events, rest };
}

function processStreamEvents(
  events: StreamEvent[],
  handlers: {
    onStart?: () => void;
    onText: (chunk: string) => void;
    onDone: (reply: string) => string;
    onError: (message: string) => void;
  },
): string | null {
  let full = '';

  for (const event of events) {
    if ('start' in event && event.start) {
      handlers.onStart?.();
    }
    if ('text' in event && event.text) {
      full += event.text;
      handlers.onText(event.text);
    }
    if ('error' in event && event.error) {
      handlers.onError(event.error);
      return null;
    }
    if ('done' in event && event.done) {
      return handlers.onDone(event.reply || full);
    }
  }

  return full || null;
}

/** XHR progressive read — reliable on Expo Go / React Native. */
function streamChatWithXHR(
  message: string,
  handlers: {
    onStart?: () => void;
    onText: (chunk: string) => void;
    onDone: (reply: string) => string;
    onError: (message: string) => void;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLength = 0;
    let buffer = '';
    let full = '';

    const drainBuffer = (final = false) => {
      if (final && buffer.trim()) {
        buffer += '\n';
      }
      const { events, rest } = parseNdjsonLines(buffer);
      buffer = rest;

      for (const event of events) {
        if ('start' in event && event.start) {
          handlers.onStart?.();
        }
        if ('text' in event && event.text) {
          full += event.text;
          handlers.onText(event.text);
        }
        if ('error' in event && event.error) {
          handlers.onError(event.error);
          reject(new Error(event.error));
          return;
        }
        if ('done' in event && event.done) {
          const reply = handlers.onDone(event.reply || full);
          resolve(reply);
          return;
        }
      }
    };

    xhr.open('POST', API_URL);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/x-ndjson');

    xhr.onprogress = () => {
      const chunk = xhr.responseText.slice(lastLength);
      lastLength = xhr.responseText.length;
      if (!chunk) return;
      buffer += chunk;
      drainBuffer();
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `Request failed (${xhr.status})`));
        return;
      }
      const tail = xhr.responseText.slice(lastLength);
      if (tail) buffer += tail;
      drainBuffer(true);
      resolve(full);
    };

    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.send(JSON.stringify({ message }));
  });
}

async function streamChatWithFetch(
  message: string,
  handlers: {
    onStart?: () => void;
    onText: (chunk: string) => void;
    onDone: (reply: string) => string;
    onError: (message: string) => void;
  },
): Promise<string> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('ReadableStream not available');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseNdjsonLines(buffer);
    buffer = rest;

    const result = processStreamEvents(events, {
      ...handlers,
      onDone: (reply) => {
        full = reply;
        return reply;
      },
    });
    if (result !== null) return result;
  }

  if (buffer.trim()) {
    const { events } = parseNdjsonLines(buffer + '\n');
    const result = processStreamEvents(events, handlers);
    if (result !== null) return result;
  }

  return full;
}

async function streamChatMessage(
  message: string,
  handlers: {
    onStart?: () => void;
    onText: (chunk: string) => void;
    onDone: (reply: string) => string;
    onError: (message: string) => void;
  },
): Promise<string> {
  try {
    return await streamChatWithFetch(message, handlers);
  } catch {
    return streamChatWithXHR(message, handlers);
  }
}

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [naturalVoiceEnabled, setNaturalVoiceEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceName, setVoiceName] = useState('Loading voice…');
  const [voicePlaybackError, setVoicePlaybackError] = useState<string | null>(null);
  const voiceEnabledRef = useRef(true);
  const naturalVoiceEnabledRef = useRef(true);
  const primeSoundRef = useRef<Audio.Sound | null>(null);
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const speakGenerationRef = useRef(0);
  const recentFillersRef = useRef<string[]>([]);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const pendingTextRef = useRef('');
  const flushFrameRef = useRef<number | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    naturalVoiceEnabledRef.current = naturalVoiceEnabled;
  }, [naturalVoiceEnabled]);

  useEffect(() => {
    let mounted = true;
    let loadedSound: Audio.Sound | null = null;

    const prepareAudio = async () => {
      try {
        await configureAudioMode();
        const label = await fetchAzureVoiceLabel();
        if (!mounted) return;
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

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  };

  const flushPendingText = () => {
    const assistantId = activeAssistantIdRef.current;
    const pending = pendingTextRef.current;
    if (!assistantId || !pending) return;

    pendingTextRef.current = '';
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, text: message.text + pending }
          : message,
      ),
    );
    scrollToEnd();
  };

  const queueTextChunk = (chunk: string) => {
    pendingTextRef.current += chunk;
    if (flushFrameRef.current !== null) return;

    flushFrameRef.current = requestAnimationFrame(() => {
      flushFrameRef.current = null;
      flushPendingText();
    });
  };

  const primeIosSpeaker = async () => {
    if (Platform.OS !== 'ios') return;
    await configureAudioMode();
    const sound = primeSoundRef.current;
    if (!sound) return;
    try {
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch {
      // continue
    }
  };

  const buildSpeakParts = (
    mainText: string,
    useNaturalFillers: boolean,
    forTest: boolean,
  ): SpeakPart[] => {
    const parts: SpeakPart[] = [];

    if (useNaturalFillers) {
      const filler = pickFillerPhrase(recentFillersRef.current);
      if (filler) {
        recentFillersRef.current = [
          filler,
          ...recentFillersRef.current.filter((item) => item !== filler),
        ].slice(0, RECENT_FILLER_MEMORY);
        parts.push({ text: filler, kind: 'filler' });
      }
    }

    const kind: SpeakPartKind = forTest ? 'test' : 'chunk';
    const chunks = forTest
      ? [prepareTextForSpeech(mainText)]
      : splitIntoSpeechChunks(mainText);
    for (const chunk of chunks) {
      parts.push({ text: chunk, kind });
    }

    return parts;
  };

  const stopActiveSpeech = async () => {
    speakGenerationRef.current += 1;
    const sound = activeSoundRef.current;
    activeSoundRef.current = null;
    if (!sound) {
      setIsSpeaking(false);
      return;
    }
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // ignore
    }
    setIsSpeaking(false);
  };

  const playAzureChunk = async (
    text: string,
    style: 'default' | 'filler',
    generation: number,
  ): Promise<void> => {
    const response = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style }),
    });

    if (generation !== speakGenerationRef.current) return;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `TTS failed (${response.status})`);
    }

    const buffer = await response.arrayBuffer();
    if (generation !== speakGenerationRef.current) return;

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

    let sound: Audio.Sound | null = null;
    try {
      const created = await Audio.Sound.createAsync(
        { uri: path },
        { shouldPlay: false, volume: 1.0, isMuted: false },
      );
      sound = created.sound;

      if (generation !== speakGenerationRef.current) {
        await sound.unloadAsync();
        sound = null;
        return;
      }

      activeSoundRef.current = sound;
      setIsSpeaking(true);

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Playback timeout — try again or check device volume'));
        }, 45_000);

        sound!.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if ('error' in status && status.error) {
            clearTimeout(timeoutId);
            reject(new Error(String(status.error)));
            return;
          }
          if (status.didJustFinish) {
            clearTimeout(timeoutId);
            resolve();
          }
        });
        void sound!.playAsync().catch((e) => {
          clearTimeout(timeoutId);
          reject(e);
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

  const speakParts = async (parts: SpeakPart[]) => {
    const generation = ++speakGenerationRef.current;

    for (let index = 0; index < parts.length; index += 1) {
      if (generation !== speakGenerationRef.current) return;

      const part = parts[index];
      const hasMore = index < parts.length - 1;
      const style = part.kind === 'filler' ? 'filler' : 'default';

      try {
        await playAzureChunk(part.text, style, generation);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : typeof err === 'string' ? err : 'Voice failed';
        setVoicePlaybackError(msg.length > 140 ? `${msg.slice(0, 137)}…` : msg);
        setIsSpeaking(false);
        return;
      }

      if (generation !== speakGenerationRef.current) return;

      const delay = pauseAfterChunk(part, hasMore);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (generation === speakGenerationRef.current) setIsSpeaking(false);
  };

  const speakReply = async (text: string, options?: { useFiller?: boolean }) => {
    if (!voiceEnabledRef.current || !text.trim()) return;

    const trimmed = text.trim();
    const forTest = options?.useFiller === false;
    const useNaturalFillers =
      !forTest &&
      (options?.useFiller ??
        (naturalVoiceEnabledRef.current && voiceEnabledRef.current));

    await stopActiveSpeech();
    setVoicePlaybackError(null);

    const parts = buildSpeakParts(trimmed, useNaturalFillers, forTest);
    if (parts.length === 0) return;

    void primeIosSpeaker().then(() => {
      setTimeout(() => {
        void speakParts(parts);
      }, PRE_SPEAK_MS);
    });
  };

  const onVoiceToggle = (enabled: boolean) => {
    setVoiceEnabled(enabled);
    voiceEnabledRef.current = enabled;
    if (!enabled) void stopActiveSpeech();
  };

  const onNaturalVoiceToggle = (enabled: boolean) => {
    setNaturalVoiceEnabled(enabled);
    naturalVoiceEnabledRef.current = enabled;
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text,
    };
    const assistantId = `${Date.now()}-assistant`;
    activeAssistantIdRef.current = assistantId;
    pendingTextRef.current = '';

    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: 'assistant', text: '', streaming: true },
    ]);
    setInput('');
    setLoading(true);
    setIsStreaming(false);
    scrollToEnd();

    try {
      const fullReply = await streamChatMessage(text, {
        onStart: () => {
          setLoading(false);
          setIsStreaming(true);
        },
        onText: (chunk) => queueTextChunk(chunk),
        onDone: (reply) => {
          flushPendingText();
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, text: reply, streaming: false }
                : message,
            ),
          );
          setIsStreaming(false);
          return reply;
        },
        onError: (err) => {
          throw new Error(err);
        },
      });

      InteractionManager.runAfterInteractions(() => {
        void speakReply(fullReply);
      });
    } catch (error) {
      flushPendingText();
      const errText =
        error instanceof Error ? error.message : 'Something went wrong';
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? { ...item, text: `Error: ${errText}`, streaming: false }
            : item,
        ),
      );
    } finally {
      setLoading(false);
      setIsStreaming(false);
      activeAssistantIdRef.current = null;
    }
  };

  const busy = loading || isStreaming;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>AI Companion</Text>
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
            Natural voice mode
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
          <TouchableOpacity
            onPress={() =>
              void speakReply('Hello. Voice is working.', { useFiller: false })
            }
            disabled={isSpeaking || busy}
          >
            <Text style={styles.voiceHint}>
              {voicePlaybackError
                ? `Voice error: ${voicePlaybackError}`
                : isSpeaking
                  ? 'Speaking…'
                  : isStreaming
                    ? 'Reply streaming…'
                    : `Azure: ${voiceName} · Tap to test · Raise volume · Silent mode: use switch`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={scrollToEnd}
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
          <Text style={styles.empty}>Say hello to your AI companion.</Text>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor="#888888"
            multiline
            editable={!busy}
          />
          <TouchableOpacity
            style={[styles.sendButton, busy && styles.sendDisabled]}
            onPress={sendMessage}
            disabled={busy || !input.trim()}
          >
            {busy ? (
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
  voiceHint: { fontSize: 12, color: '#666666', marginTop: 6 },
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
