import { describe, expect, it } from 'vitest';

import { formatDeckTime } from '../src/lib/deckTime';

describe('formatDeckTime', () => {
  it('uses Auckland daylight time and the next local date', () => {
    expect(formatDeckTime('2026-11-18T19:20:17.169Z')).toBe('19 Nov 2026, 08:20:17 NZDT');
  });

  it('uses Auckland standard time for a winter timestamp in milliseconds', () => {
    expect(formatDeckTime(Date.UTC(2026, 6, 1))).toBe('01 Jul 2026, 12:00:00 NZST');
  });

  it('uses the supplied fallback for missing or invalid timestamps', () => {
    for (const value of [undefined, null, '', 'not a date', Number.NaN]) {
      expect(formatDeckTime(value)).toBe('—');
      expect(formatDeckTime(value, 'Unknown')).toBe('Unknown');
    }
  });
});
