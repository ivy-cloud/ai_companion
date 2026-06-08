/** Expo-av recording metering range (dBFS). */
export const METER_DBFS_MIN = -160;
export const METER_DBFS_MAX = 0;

/** Throttle meter → React state updates (~8–10 fps). */
export const VOICE_METER_UI_THROTTLE_MS = 100;

const BAR_COUNT = 28;

/** Hero wave canvas height (px). */
export const VOICE_WAVE_HERO_HEIGHT_PX = 96;

/**
 * Map dBFS (-160…0) to 0…1 for UI. Slight curve so quiet speech still reads.
 */
export function dbfsToNormalized(metering?: number | null): number {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return 0;
  }
  const clamped = Math.min(METER_DBFS_MAX, Math.max(METER_DBFS_MIN, metering));
  const linear = (clamped - METER_DBFS_MIN) / (METER_DBFS_MAX - METER_DBFS_MIN);
  return Math.pow(linear, 0.65);
}

/**
 * Per-bar height multipliers (0…1) for a soft wave driven by normalized level.
 */
export function barHeightsFromLevel(
  level: number,
  barCount = BAR_COUNT,
  phaseMs = Date.now(),
): number[] {
  const base = Math.min(1, Math.max(0, level));
  const minH = 0.1;
  const maxH = 1;
  const heights: number[] = [];
  for (let i = 0; i < barCount; i += 1) {
    const offset = Math.sin(phaseMs / 160 + i * 0.72) * 0.22;
    const edgeFade = 0.55 + 0.45 * Math.sin((Math.PI * i) / Math.max(1, barCount - 1));
    const scaled = base * (0.68 + offset) * edgeFade;
    heights.push(minH + scaled * (maxH - minH));
  }
  return heights;
}

export const VOICE_WAVE_BAR_COUNT = BAR_COUNT;
