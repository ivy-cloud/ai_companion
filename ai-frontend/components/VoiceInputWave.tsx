import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { barHeightsFromLevel, VOICE_WAVE_BAR_COUNT } from '../lib/voiceMeterLevel';

type VoiceInputWaveProps = {
  /** Normalized meter level 0…1. */
  level: number;
  /** Show animated bars (listening / recording). */
  visible: boolean;
  /** Lower amplitude — barge-in monitor while assistant speaks. */
  subtle?: boolean;
};

const MIN_PX = 3;
const MAX_PX = 18;

export function VoiceInputWave({ level, visible, subtle = false }: VoiceInputWaveProps) {
  const animRefs = useRef(
    Array.from({ length: VOICE_WAVE_BAR_COUNT }, () => new Animated.Value(MIN_PX)),
  ).current;

  useEffect(() => {
    if (!visible) {
      animRefs.forEach((anim) => {
        Animated.timing(anim, {
          toValue: MIN_PX,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      });
      return;
    }

    const now = Date.now();
    const amp = subtle ? Math.min(1, level * 0.4 + 0.06) : level;
    const heights = barHeightsFromLevel(amp, VOICE_WAVE_BAR_COUNT, now);
    animRefs.forEach((anim, i) => {
      const px = MIN_PX + heights[i]! * (MAX_PX - MIN_PX);
      Animated.timing(anim, {
        toValue: px,
        duration: 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    });
  }, [level, visible, subtle, animRefs]);

  if (!visible && level < 0.02) {
    return null;
  }

  const opacity = subtle ? 0.45 + level * 0.2 : 0.55 + level * 0.35;

  return (
    <View style={styles.container} pointerEvents="none" accessibilityElementsHidden>
      {animRefs.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.bar,
            subtle && styles.barSubtle,
            {
              height: anim,
              opacity,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: MAX_PX,
    marginTop: 4,
    marginBottom: 2,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: '#c97b84',
  },
  barSubtle: {
    backgroundColor: '#b0a4c9',
  },
});
