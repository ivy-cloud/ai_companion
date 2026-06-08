import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import {
  barHeightsFromLevel,
  VOICE_WAVE_BAR_COUNT,
  VOICE_WAVE_HERO_HEIGHT_PX,
} from '../lib/voiceMeterLevel';

type VoiceInputWaveProps = {
  /** Normalized meter level 0…1. */
  level: number;
  /** Show animated bars (listening / recording). */
  visible: boolean;
  /** Lower amplitude — barge-in monitor while assistant speaks. */
  subtle?: boolean;
  /** Compact status bar vs large hero wave. */
  variant?: 'compact' | 'hero';
  /** Gentle breathing animation when no live meter (thinking / speaking). */
  ambient?: boolean;
};

const COMPACT_MIN_PX = 3;
const COMPACT_MAX_PX = 18;
const HERO_MIN_PX = 8;
const HERO_MAX_PX = VOICE_WAVE_HERO_HEIGHT_PX;

function barColor(index: number, barCount: number, subtle: boolean): string {
  if (subtle) return '#b0a4c9';
  const t = barCount <= 1 ? 0.5 : index / (barCount - 1);
  if (t < 0.45) return '#c97b84';
  if (t < 0.75) return '#d4a0a6';
  return '#b0a4c9';
}

export function VoiceInputWave({
  level,
  visible,
  subtle = false,
  variant = 'compact',
  ambient = false,
}: VoiceInputWaveProps) {
  const hero = variant === 'hero';
  const barCount = hero ? VOICE_WAVE_BAR_COUNT : 5;
  const minPx = hero ? HERO_MIN_PX : COMPACT_MIN_PX;
  const maxPx = hero ? HERO_MAX_PX : COMPACT_MAX_PX;

  const animRefs = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(minPx)),
  ).current;

  useEffect(() => {
    if (!visible) {
      animRefs.forEach((anim) => {
        Animated.timing(anim, {
          toValue: minPx,
          duration: hero ? 280 : 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      });
      return;
    }

    const now = Date.now();
    const amp = ambient
      ? 0.14 + Math.sin(now / 520) * 0.06
      : subtle
        ? Math.min(1, level * 0.4 + 0.06)
        : level;
    const heights = barHeightsFromLevel(amp, barCount, now);
    animRefs.forEach((anim, i) => {
      const px = minPx + heights[i]! * (maxPx - minPx);
      Animated.timing(anim, {
        toValue: px,
        duration: hero ? 110 : 90,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    });
  }, [level, visible, subtle, ambient, hero, barCount, minPx, maxPx, animRefs]);

  if (!visible && level < 0.02) {
    return null;
  }

  const opacity = ambient
    ? 0.5
    : subtle
      ? 0.45 + level * 0.2
      : 0.55 + level * 0.35;

  return (
    <View
      style={[styles.container, hero && styles.containerHero]}
      pointerEvents="none"
      accessibilityElementsHidden
    >
      {animRefs.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            hero ? styles.barHero : styles.bar,
            {
              height: anim,
              opacity,
              backgroundColor: barColor(i, barCount, subtle && !hero),
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
    justifyContent: 'center',
    gap: 3,
    height: COMPACT_MAX_PX,
    marginTop: 4,
    marginBottom: 2,
  },
  containerHero: {
    gap: 4,
    height: VOICE_WAVE_HERO_HEIGHT_PX,
    marginTop: 0,
    marginBottom: 0,
    width: '100%',
    maxWidth: 340,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
  barHero: {
    flex: 1,
    maxWidth: 8,
    borderRadius: 4,
  },
});
