import { Audio, InterruptionModeIOS } from 'expo-av';
import * as Speech from 'expo-speech';
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

const API_URL = 'http://192.168.0.178:8000/chat';

// iOS (incl. Expo Go): playing this once per utterance activates the speaker route for TTS.
const SILENT_SOUND = require('../assets/silent.wav');

const SPEECH_OPTIONS: Speech.SpeechOptions = {
  language: 'en-US',
  pitch: 1.0,
  rate: Platform.select({ ios: 0.5, android: 1.0, default: 1.0 }),
  // false = dedicated speech session (works better with silent-sound priming on iOS).
  ...(Platform.OS === 'ios' ? { useApplicationAudioSession: false } : {}),
};

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

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceEnabledRef = useRef(true);
  const primeSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  useEffect(() => {
    let mounted = true;
    let loadedSound: Audio.Sound | null = null;

    const prepareAudio = async () => {
      try {
        await configureAudioMode();
        if (!mounted) return;

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
        // TTS may still work without the prime clip.
      }
    };

    void prepareAudio();
    return () => {
      mounted = false;
      void loadedSound?.unloadAsync();
      primeSoundRef.current = null;
    };
  }, []);

  const primeIosSpeaker = async () => {
    if (Platform.OS !== 'ios') return;

    await configureAudioMode();
    const sound = primeSoundRef.current;
    if (!sound) return;

    try {
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch {
      // Continue to TTS even if priming playback fails.
    }
  };

  const speakReply = async (text: string) => {
    if (!voiceEnabledRef.current || !text.trim()) return;

    const trimmed = text.trim();
    const speaking = await Speech.isSpeakingAsync();
    if (speaking) {
      Speech.stop();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    await primeIosSpeaker();
    if (Platform.OS === 'ios') {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    Speech.speak(trimmed, {
      ...SPEECH_OPTIONS,
      onStart: () => setIsSpeaking(true),
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  const onVoiceToggle = (enabled: boolean) => {
    setVoiceEnabled(enabled);
    voiceEnabledRef.current = enabled;
    if (!enabled) {
      Speech.stop();
      setIsSpeaking(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Request failed (${response.status})`);
      }

      const data: { reply: string } = await response.json();
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        text: data.reply,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      InteractionManager.runAfterInteractions(() => {
        void speakReply(data.reply);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Something went wrong';
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-error`,
          role: 'assistant',
          text: `Error: ${message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

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
        {voiceEnabled ? (
          <TouchableOpacity
            onPress={() => void speakReply('Hello. Voice is working.')}
            disabled={isSpeaking}
          >
            <Text style={styles.voiceHint}>
              {isSpeaking
                ? 'Speaking…'
                : 'Tap here to test voice · Raise volume · Turn silent switch off'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <FlatList
        style={styles.list}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                item.role === 'user' ? styles.userText : styles.assistantText,
              ]}
            >
              {item.text}
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
            editable={!loading}
          />
          <TouchableOpacity
            style={[styles.sendButton, loading && styles.sendDisabled]}
            onPress={sendMessage}
            disabled={loading || !input.trim()}
          >
            {loading ? (
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
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
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
  },
  voiceLabel: {
    fontSize: 16,
    color: '#000000',
  },
  voiceHint: {
    fontSize: 12,
    color: '#666666',
    marginTop: 6,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
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
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: '#ffffff',
  },
  assistantText: {
    color: '#000000',
  },
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
  sendDisabled: {
    opacity: 0.6,
  },
  sendLabel: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
});
