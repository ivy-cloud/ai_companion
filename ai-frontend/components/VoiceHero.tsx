import { StyleSheet, Text, View } from 'react-native';
import { VoiceInputWave } from './VoiceInputWave';

type VoiceHeroProps = {
  companionName: string;
  phaseLabel: string;
  phaseHint: string;
  level: number;
  waveVisible: boolean;
  waveSubtle?: boolean;
  ambient?: boolean;
  onInterrupt?: () => void;
  interruptEnabled?: boolean;
};

export function VoiceHero({
  companionName,
  phaseLabel,
  phaseHint,
  level,
  waveVisible,
  waveSubtle = false,
  ambient = false,
}: VoiceHeroProps) {
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
});
