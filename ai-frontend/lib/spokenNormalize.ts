/**
 * Mirror backend spoken_text.py — natural words for TTS, not spelled fragments.
 */

const ORDINAL_WORDS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
  11: 'eleventh',
  12: 'twelfth',
  13: 'thirteenth',
  14: 'fourteenth',
  15: 'fifteenth',
  16: 'sixteenth',
  17: 'seventeenth',
  18: 'eighteenth',
  19: 'nineteenth',
  20: 'twentieth',
  21: 'twenty-first',
  22: 'twenty-second',
  23: 'twenty-third',
  24: 'twenty-fourth',
  25: 'twenty-fifth',
  26: 'twenty-sixth',
  27: 'twenty-seventh',
  28: 'twenty-eighth',
  29: 'twenty-ninth',
  30: 'thirtieth',
  31: 'thirty-first',
};

const CARDINAL_WORDS: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
  16: 'sixteen',
  17: 'seventeen',
  18: 'eighteen',
  19: 'nineteen',
  20: 'twenty',
  30: 'thirty',
  40: 'forty',
  50: 'fifty',
};

function cardinalWord(n: number): string {
  if (CARDINAL_WORDS[n] !== undefined) return CARDINAL_WORDS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    if (ones === 0) return CARDINAL_WORDS[tens] ?? String(n);
    return `${CARDINAL_WORDS[tens] ?? tens} ${CARDINAL_WORDS[ones] ?? ones}`;
  }
  return String(n);
}

function ordinalWord(day: number): string {
  return ORDINAL_WORDS[day] ?? `${day}th`;
}

function normalizeOrdinals(text: string): string {
  let cleaned = text.replace(/(\d+)\s+(st|nd|rd|th)\b/gi, '$1$2');
  cleaned = cleaned.replace(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (_, d) => {
    return `the ${cardinalWord(Number(d))}s`;
  });
  cleaned = cleaned.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, (_, d) => ordinalWord(Number(d)));
  cleaned = cleaned.replace(/\b(st|nd|rd|th)\b/gi, (match, offset, str) => {
    const before = offset > 0 ? str[offset - 1] : '';
    return before && /\d/.test(before) ? match : '';
  });
  return cleaned;
}

function normalizeFragments(text: string): string {
  return text.replace(/\b([stnrl])\s+([hdts])\b/gi, '$1$2');
}

function normalizeTime(text: string): string {
  return text.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => {
    const hour = Number(h);
    const minute = Number(m);
    const hour12 = hour % 12 || 12;
    const hw = cardinalWord(hour12);
    if (minute === 0) return hw;
    if (minute < 10) return `${hw} oh ${cardinalWord(minute)}`;
    if (minute === 15) return `quarter past ${hw}`;
    if (minute === 30) return `half past ${hw}`;
    if (minute === 45) {
      const next = cardinalWord(hour12 % 12 + 1 === hour12 ? 12 : (hour12 % 12) + 1);
      return `quarter to ${next}`;
    }
    return `${hw} ${cardinalWord(minute)}`;
  });
}

function normalizeSmallNumbers(text: string): string {
  return text.replace(/\b(\d{1,2})(?!'s\b)/g, (_, d) => cardinalWord(Number(d)));
}

function applyPhraseMap(text: string): string {
  return text
    .replace(/\bok\b/gi, 'okay')
    .replace(/\bPDT\b/g, '')
    .replace(/\bPST\b/g, '')
    .replace(/\bEST\b/g, '')
    .replace(/\bEDT\b/g, '')
    .replace(/\bCST\b/g, '')
    .replace(/\bMDT\b/g, '')
    .replace(/\bUTC\b/g, '')
    .replace(/\bAM\b/gi, '')
    .replace(/\bPM\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Full spoken-text normalization (keep in sync with ai-backend/spoken_text.py). */
export function normalizeForSpeech(text: string): string {
  let cleaned = text
    .replace(/[@#$%^&*+=|\\<>~`[\]{}©®™°§¶•·/]/g, '')
    .replace(/[—–]/g, ' ')
    .replace(/…+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = normalizeOrdinals(cleaned);
  cleaned = normalizeFragments(cleaned);
  cleaned = normalizeTime(cleaned);
  cleaned = normalizeSmallNumbers(cleaned);
  cleaned = applyPhraseMap(cleaned);
  cleaned = normalizeFragments(cleaned);

  return cleaned.replace(/\s+/g, ' ').trim();
}
