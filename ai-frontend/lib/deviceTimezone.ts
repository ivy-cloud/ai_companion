/**
 * IANA timezone from the device (e.g. America/New_York).
 * expo-localization is primary; Intl is fallback (often UTC on RN without it).
 */

import { getCalendars } from 'expo-localization';

const IANA_TZ =
  /^(?:UTC|GMT|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]+)+)$/;

let cached: string | undefined;

function pickValidTimezone(candidate: string | undefined | null): string | undefined {
  const tz = candidate?.trim();
  if (tz && IANA_TZ.test(tz)) return tz;
  return undefined;
}

/** Clear cache when app returns to foreground (user may have changed zone). */
export function refreshDeviceTimezoneCache(): void {
  cached = undefined;
}

export function getDeviceTimezone(): string | undefined {
  if (cached !== undefined) return cached || undefined;

  const fromCalendars = pickValidTimezone(getCalendars()[0]?.timeZone);
  if (fromCalendars) {
    cached = fromCalendars;
    return fromCalendars;
  }

  try {
    const fromIntl = pickValidTimezone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    if (fromIntl) {
      cached = fromIntl;
      return fromIntl;
    }
  } catch {
    // ignore
  }

  cached = '';
  return undefined;
}
