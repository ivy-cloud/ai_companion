import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VoiceDecibelBar } from './VoiceDecibelBar';
import { VoiceInputWave } from './VoiceInputWave';

type VoiceHeroProps = {
  companionName: string;
  phaseLabel: string;
  phaseHint: string;
  level: number;
  /** Raw dBFS for decibel bar (null when meter inactive). */
  meterDbfs?: number | null;
  meterVisible?: boolean;
  speakLouderHint?: boolean;
  doneSpeakingVisible?: boolean;
  onDoneSpeaking?: () => void;
  waveVisible: boolean;
  waveSubtle?: boolean;
  ambient?: boolean;
  compact?: boolean;
  onInterrupt?: () => void;
  interruptEnabled?: boolean;
};

export function VoiceHero({
  companionName,
  phaseLabel,
  phaseHint,
  level,
  meterDbfs = null,
  meterVisible = false,
  speakLouderHint = false,
  doneSpeakingVisible = false,
  onDoneSpeaking,
  waveVisible,
  waveSubtle = false,
  ambient = false,
  compact = false,
}: VoiceHeroProps) {
  const decibelHint = speakLouderHint ? 'Speak louder' : null;

  if (compact) {
    return (
      <View style={styles.compactHero} accessibilityRole="summary">
        <Text style={styles.compactPhaseLabel} numberOfLines={1}>
          {phaseLabel}
        </Text>
        <View style={styles.compactMeterCol}>
          {(waveVisible || ambient) && (
            <VoiceInputWave
              level={level}
              visible
              subtle={waveSubtle}
              variant="compact"
              ambient={ambient}
            />
          )}
          <VoiceDecibelBar
            dbfs={meterDbfs}
            visible={meterVisible}
            hint={decibelHint}
          />
          {doneSpeakingVisible && onDoneSpeaking ? (
            <Pressable
              style={({ pressed }) => [
                styles.doneSpeakingButton,
                pressed && styles.doneSpeakingPressed,
              ]}
              onPress={onDoneSpeaking}
              accessibilityRole="button"
              accessibilityLabel="Done speaking"
            >
              <Text style={styles.doneSpeakingLabel}>Done speaking</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.hero} accessibilityRole="summary">
      <Text style={styles.companionName}>{companionName}</Text>
      <Text style={styles.phaseLabel}>{phaseLabel}</Text>
      <VoiceInputWave
        level={level}
        visible={waveVisible || ambient}
        subtle={waveSubtle}
        variant="hero"
        ambient={ambient}
      />
      <VoiceDecibelBar
        dbfs={meterDbfs}
        visible={meterVisible}
        hint={decibelHint}
      />
      {doneSpeakingVisible && onDoneSpeaking ? (
        <Pressable
          style={({ pressed }) => [
            styles.doneSpeakingButton,
            pressed && styles.doneSpeakingPressed,
          ]}
          onPress={onDoneSpeaking}
          accessibilityRole="button"
          accessibilityLabel="Done speaking"
        >
          <Text style={styles.doneSpeakingLabel}>Done speaking</Text>
        </Pressable>
      ) : null}
      <Text style={styles.phaseHint}>{phaseHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    minHeight: 168,
    backgroundColor: '#faf7f5',
    borderBottomWidth: 1,
    borderBottomColor: '#ead9d4',
  },
  compactHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 44,
    backgroundColor: '#faf7f5',
    borderBottomWidth: 1,
    borderBottomColor: '#ead9d4',
  },
  compactPhaseLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#4a3f42',
  },
  compactMeterCol: {
    flexShrink: 1,
    alignItems: 'flex-end',
    maxWidth: '55%',
  },
  companionName: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#9a8ab0',
    marginBottom: 6,
  },
  phaseLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#4a3f42',
    marginBottom: 14,
    textAlign: 'center',
  },
  phaseHint: {
    fontSize: 13,
    color: '#7a6e72',
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  doneSpeakingButton: {
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#4a3f42',
  },
  doneSpeakingPressed: {
    opacity: 0.85,
  },
  doneSpeakingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#faf7f5',
  },
});
