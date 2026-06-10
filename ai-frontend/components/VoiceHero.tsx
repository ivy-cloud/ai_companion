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
  /** ChatGPT-style mute while assistant TTS plays (conversation mode). */
  muteVisible?: boolean;
  ttsMuted?: boolean;
  onToggleMute?: () => void;
  /** Label override for the manual end-of-turn control (default: Done speaking). */
  doneSpeakingLabel?: string;
  /** Rolling partial STT while listening (conversation mode). */
  liveTranscript?: string | null;
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
  muteVisible = false,
  ttsMuted = false,
  onToggleMute,
  doneSpeakingLabel = 'Done speaking',
  liveTranscript = null,
  waveVisible,
  waveSubtle = false,
  ambient = false,
  compact = false,
}: VoiceHeroProps) {
  const decibelHint = speakLouderHint ? 'Speak louder' : null;

  if (compact) {
    return (
      <View style={styles.compactHero} accessibilityRole="summary">
        <View style={styles.compactLabelCol}>
          <Text style={styles.compactPhaseLabel} numberOfLines={1}>
            {phaseLabel}
          </Text>
          {liveTranscript ? (
            <Text style={styles.liveTranscriptCompact} numberOfLines={2}>
              {liveTranscript}
            </Text>
          ) : null}
        </View>
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
          <View style={styles.escapeRow}>
            {muteVisible && onToggleMute ? (
              <Pressable
                style={({ pressed }) => [
                  styles.escapeButton,
                  styles.escapeButtonSecondary,
                  pressed && styles.escapePressed,
                ]}
                onPress={onToggleMute}
                accessibilityRole="button"
                accessibilityLabel={ttsMuted ? 'Unmute assistant' : 'Mute assistant'}
              >
                <Text style={styles.escapeLabelSecondary}>
                  {ttsMuted ? 'Unmute' : 'Mute'}
                </Text>
              </Pressable>
            ) : null}
            {doneSpeakingVisible && onDoneSpeaking ? (
              <Pressable
                style={({ pressed }) => [
                  styles.escapeButton,
                  pressed && styles.escapePressed,
                ]}
                onPress={onDoneSpeaking}
                accessibilityRole="button"
                accessibilityLabel={doneSpeakingLabel}
              >
                <Text style={styles.escapeLabel}>{doneSpeakingLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.hero} accessibilityRole="summary">
      <Text style={styles.companionName}>{companionName}</Text>
      <Text style={styles.phaseLabel}>{phaseLabel}</Text>
      {liveTranscript ? (
        <Text style={styles.liveTranscript} numberOfLines={3}>
          {liveTranscript}
        </Text>
      ) : null}
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
      <View style={styles.escapeRow}>
        {muteVisible && onToggleMute ? (
          <Pressable
            style={({ pressed }) => [
              styles.escapeButton,
              styles.escapeButtonSecondary,
              pressed && styles.escapePressed,
            ]}
            onPress={onToggleMute}
            accessibilityRole="button"
            accessibilityLabel={ttsMuted ? 'Unmute assistant' : 'Mute assistant'}
          >
            <Text style={styles.escapeLabelSecondary}>
              {ttsMuted ? 'Unmute' : 'Mute'}
            </Text>
          </Pressable>
        ) : null}
        {doneSpeakingVisible && onDoneSpeaking ? (
          <Pressable
            style={({ pressed }) => [
              styles.escapeButton,
              pressed && styles.escapePressed,
            ]}
            onPress={onDoneSpeaking}
            accessibilityRole="button"
            accessibilityLabel={doneSpeakingLabel}
          >
            <Text style={styles.escapeLabel}>{doneSpeakingLabel}</Text>
          </Pressable>
        ) : null}
      </View>
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
  compactLabelCol: {
    flex: 1,
    minWidth: 0,
  },
  compactPhaseLabel: {
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
    marginBottom: 6,
    textAlign: 'center',
  },
  liveTranscript: {
    fontSize: 15,
    fontStyle: 'italic',
    color: '#6b5d60',
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  liveTranscriptCompact: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#6b5d60',
    marginTop: 2,
  },
  phaseHint: {
    fontSize: 13,
    color: '#7a6e72',
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  escapeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  escapeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#4a3f42',
  },
  escapeButtonSecondary: {
    backgroundColor: '#e8ddd8',
    borderWidth: 1,
    borderColor: '#c9b8b0',
  },
  escapePressed: {
    opacity: 0.85,
  },
  escapeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#faf7f5',
  },
  escapeLabelSecondary: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4a3f42',
  },
});
