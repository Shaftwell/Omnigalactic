import { describe, it, expect } from 'vitest';
import { formatToET, toETInputString, fromETInputString } from './timeUtils';

describe('Eastern Time formatting', () => {
  it('formats summer (EDT, UTC-4) time', () => {
    // 18:00Z on Jun 15 is 2:00 PM in New York
    expect(formatToET('2026-06-15T18:00:00Z', 'standard')).toBe('02:00 PM');
    expect(formatToET('2026-06-15T18:00:00Z', 'military')).toBe('14:00');
  });

  it('formats winter (EST, UTC-5) time', () => {
    // 18:00Z on Jan 15 is 1:00 PM in New York
    expect(formatToET('2026-01-15T18:00:00Z', 'military')).toBe('13:00');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatToET('not-a-date')).toBe('');
    expect(formatToET(null)).toBe('');
  });

  it('toETInputString yields the ET wall clock', () => {
    expect(toETInputString('2026-06-15T18:00:00Z')).toBe('2026-06-15T14:00');
  });

  it('fromETInputString round-trips back to the same instant', () => {
    const iso = fromETInputString('2026-06-15T14:00');
    expect(new Date(iso).toISOString()).toBe('2026-06-15T18:00:00.000Z');
  });
});
