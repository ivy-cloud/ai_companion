import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  patchAppSettings,
  useAppSettings,
  type VoiceGender,
  type VoiceInputMode,
} from '../lib/appSettings';
import { getDeviceTimezone } from '../lib/deviceTimezone';
import { fetchHealthDetails, type HealthDetails } from '../lib/healthInfo';
import { getWearablesAudioSource } from '../lib/wearablesAdapter';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.178:8000';

function SettingRow({
  label,
  hint,
  children,
  disabled = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ModeChip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        disabled && styles.chipDisabled,
        pressed && !disabled && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useAppSettings();
  const wearables = getWearablesAudioSource();
  let timezone: string | undefined;
  try {
    timezone = getDeviceTimezone();
  } catch {
    timezone = undefined;
  }
  const [health, setHealth] = useState<HealthDetails | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setHealthLoading(true);
    void fetchHealthDetails(API_BASE).then((details) => {
      if (mounted) {
        setHealth(details);
        setHealthLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const setGender = (voiceGender: VoiceGender) => {
    patchAppSettings({ voiceGender });
  };

  const setInputMode = (voiceInputMode: VoiceInputMode) => {
    patchAppSettings({ voiceInputMode });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          accessibilityLabel="Back to chat"
        >
          <Text style={styles.backLabel}>← Chat</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Voice</Text>
        <SettingRow label="Enable voice" hint="Turn off for text-only chat.">
          <Switch
            value={settings.voiceEnabled}
            onValueChange={(voiceEnabled) => patchAppSettings({ voiceEnabled })}
            trackColor={{ false: '#ddd5d0', true: '#c97b84' }}
            thumbColor="#ffffff"
          />
        </SettingRow>
        <SettingRow
          label="Natural voice"
          hint="Shorter replies — about two sentences max."
          disabled={!settings.voiceEnabled}
        >
          <Switch
            value={settings.naturalVoiceEnabled}
            onValueChange={(naturalVoiceEnabled) => patchAppSettings({ naturalVoiceEnabled })}
            disabled={!settings.voiceEnabled}
            trackColor={{ false: '#ddd5d0', true: '#c97b84' }}
            thumbColor="#ffffff"
          />
        </SettingRow>
        <SettingRow
          label="Voice tone"
          disabled={!settings.voiceEnabled}
        >
          <View style={styles.chipRow}>
            <ModeChip
              label="Female"
              active={settings.voiceGender === 'female'}
              disabled={!settings.voiceEnabled}
              onPress={() => setGender('female')}
            />
            <ModeChip
              label="Male"
              active={settings.voiceGender === 'male'}
              disabled={!settings.voiceEnabled}
              onPress={() => setGender('male')}
            />
          </View>
        </SettingRow>

        <Text style={styles.sectionTitle}>Mic mode</Text>
        <SettingRow
          label="Input style"
          hint="Push-to-talk: hold Mic. Conversation: tap Mic to start hands-free turns."
          disabled={!settings.voiceEnabled}
        >
          <View style={styles.chipRow}>
            <ModeChip
              label="Push-to-talk"
              active={settings.voiceInputMode === 'ptt'}
              disabled={!settings.voiceEnabled}
              onPress={() => setInputMode('ptt')}
            />
            <ModeChip
              label="Conversation"
              active={settings.voiceInputMode === 'conversation'}
              disabled={!settings.voiceEnabled}
              onPress={() => setInputMode('conversation')}
            />
          </View>
        </SettingRow>

        <Text style={styles.sectionTitle}>Backend</Text>
        <View style={styles.card}>
          {healthLoading ? (
            <ActivityIndicator color="#c97b84" />
          ) : health ? (
            <>
              <Text style={styles.cardLine}>
                Status:{' '}
                <Text style={health.status === 'ok' ? styles.statusOk : styles.statusWarn}>
                  {health.reachable ? health.status : 'unreachable'}
                </Text>
              </Text>
              {health.companionName ? (
                <Text style={styles.cardLine}>Companion: {health.companionName}</Text>
              ) : null}
              {health.skillHints.length > 0 ? (
                <Text style={styles.cardHint}>{health.skillHints.join(' · ')}</Text>
              ) : null}
              {health.llmProvider ? (
                <Text style={styles.cardLine}>
                  LLM: {health.llmProvider}
                  {health.model ? ` · ${health.model}` : ''}
                </Text>
              ) : null}
              {health.azureTtsVoice ? (
                <Text style={styles.cardLine}>Azure voice: {health.azureTtsVoice}</Text>
              ) : null}
              {health.localTime ? (
                <Text style={styles.cardLine}>Server clock: {health.localTime}</Text>
              ) : null}
              {health.hint ? <Text style={styles.cardWarn}>{health.hint}</Text> : null}
              <Text style={styles.cardMono}>{API_BASE}/health</Text>
            </>
          ) : (
            <>
              <Text style={styles.cardWarn}>
                {`Can't reach backend (${API_BASE}) — start server & same Wi‑Fi`}
              </Text>
              <Text style={styles.cardMono}>{API_BASE}/health</Text>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Device</Text>
        <View style={styles.card}>
          <Text style={styles.cardLine}>Wearables mode: {wearables.label}</Text>
          <Text style={styles.cardHint}>
            Read-only — set EXPO_PUBLIC_WEARABLES_MODE in ai-frontend/.env (phone or meta-stub).
          </Text>
          <Text style={styles.cardLine}>
            Your timezone: {timezone ?? 'Not detected — restart app if wrong'}
          </Text>
          <Text style={styles.cardHint}>
            Sent with chat requests so greetings match your local time.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Session log</Text>
        <View style={styles.card}>
          <Text style={styles.cardLine}>Voice debug events append to the backend session log.</Text>
          <Text style={styles.cardHint}>View on your Mac while testing on phone:</Text>
          <Text style={styles.cardMono}>tail -f ai-backend/data/session_log.jsonl</Text>
          <Text style={styles.cardMono}>
            curl -s &apos;http://127.0.0.1:8000/debug/session-log?limit=80&format=text&apos;
          </Text>
          <Text style={styles.cardHint}>
            To clear: stop the backend, delete session_log.jsonl, restart ./start.sh
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#faf7f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ead9d4',
    gap: 12,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backButtonPressed: { opacity: 0.6 },
  backLabel: { fontSize: 16, color: '#c97b84', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: '#4a3f42' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, gap: 4 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#9a8ab0',
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#efe6e2',
  },
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 16, color: '#4a3f42', fontWeight: '500' },
  rowLabelDisabled: { color: '#9a8f92' },
  rowHint: { fontSize: 12, color: '#7a6e72', marginTop: 4, lineHeight: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#efe6e2',
  },
  chipActive: { backgroundColor: '#c97b84' },
  chipDisabled: { opacity: 0.45 },
  chipPressed: { opacity: 0.85 },
  chipText: { fontSize: 13, color: '#5c5255', fontWeight: '500' },
  chipTextActive: { color: '#ffffff', fontWeight: '700' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ead9d4',
    padding: 14,
    gap: 8,
  },
  cardLine: { fontSize: 14, color: '#4a3f42', lineHeight: 20 },
  cardHint: { fontSize: 12, color: '#7a6e72', lineHeight: 17 },
  cardWarn: { fontSize: 13, color: '#b45309', lineHeight: 18 },
  cardMono: {
    fontSize: 11,
    color: '#6b5f63',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  statusOk: { color: '#2e7d4f', fontWeight: '700' },
  statusWarn: { color: '#b45309', fontWeight: '700' },
});
