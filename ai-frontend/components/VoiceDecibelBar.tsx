import { StyleSheet, Text, View } from 'react-native';
import { dbfsToBarPercent, formatDbfsLabel } from '../lib/voiceMeterLevel';
import { SPEECH_LEVEL_DB } from '../lib/conversationMode';

type VoiceDecibelBarProps = {
  /** Raw dBFS from expo-av recording metering. */
  dbfs: number | null;
  visible: boolean;
  /** dBFS above which the bar turns green (speech threshold). */
  thresholdDb?: number;
  /** Optional hint shown below the bar (e.g. "Speak louder"). */
  hint?: string | null;
};

export function VoiceDecibelBar({
  dbfs,
  visible,
  thresholdDb = SPEECH_LEVEL_DB,
  hint = null,
}: VoiceDecibelBarProps) {
  if (!visible) return null;

  const percent = dbfsToBarPercent(dbfs);
  const aboveThreshold =
    dbfs !== null && !Number.isNaN(dbfs) && dbfs > thresholdDb;

  const label = formatDbfsLabel(dbfs);

  return (
    <View
      style={styles.wrap}
      accessibilityLabel={`Voice level ${label}`}
      accessibilityRole="text"
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${percent}%` },
            aboveThreshold ? styles.fillSpeech : styles.fillQuiet,
          ]}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 340,
    marginTop: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7a6e72',
    textAlign: 'center',
    marginBottom: 4,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e8ddd8',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
    minWidth: 2,
  },
  fillSpeech: {
    backgroundColor: '#5a9e6f',
  },
  fillQuiet: {
    backgroundColor: '#c4a882',
  },
  hint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#b85c4a',
    textAlign: 'center',
    marginTop: 4,
  },
});
