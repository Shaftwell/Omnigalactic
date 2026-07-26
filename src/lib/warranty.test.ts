import { describe, it, expect } from 'vitest';
import { warrantyStatus, daysUntil } from './warranty';

// Noon UTC on 2026-07-16 is 08:00 EDT — the same calendar day in ET, so the
// "today" anchor is unambiguous for the day-offset cases below.
const today = new Date('2026-07-16T16:00:00Z');

describe('warrantyStatus', () => {
  it('is "none" when no expiry is tracked', () => {
    expect(warrantyStatus(undefined, today)).toBe('none');
    expect(warrantyStatus('', today)).toBe('none');
    expect(warrantyStatus('   ', today)).toBe('none');
  });

  it('is "none" for malformed input', () => {
    expect(warrantyStatus('not-a-date', today)).toBe('none');
    expect(warrantyStatus('2026-7-1', today)).toBe('none');
    expect(warrantyStatus('2026-13-45', today)).toBe('none'); // impossible month/day
  });

  it('is "expiring" when the expiry is today', () => {
    expect(warrantyStatus('2026-07-16', today)).toBe('expiring');
  });

  it('is "expiring" at exactly +60 days (window is inclusive)', () => {
    expect(warrantyStatus('2026-09-14', today)).toBe('expiring');
  });

  it('is "active" at +61 days (just past the window)', () => {
    expect(warrantyStatus('2026-09-15', today)).toBe('active');
  });

  it('is "expired" when the expiry is in the past', () => {
    expect(warrantyStatus('2026-07-15', today)).toBe('expired');
    expect(warrantyStatus('2020-01-01', today)).toBe('expired');
  });

  it('derives "today" in Eastern Time, not UTC', () => {
    // 03:00Z on Jul 17 is 23:00 EDT on Jul 16 — still Jul 16 in ET, so a
    // warranty dated Jul 16 is expiring today, not expired.
    const lateNightEt = new Date('2026-07-17T03:00:00Z');
    expect(warrantyStatus('2026-07-16', lateNightEt)).toBe('expiring');
  });
});

describe('daysUntil', () => {
  it('returns 0 for today', () => {
    expect(daysUntil('2026-07-16', today)).toBe(0);
  });

  it('returns the positive day count for a future expiry', () => {
    expect(daysUntil('2026-09-14', today)).toBe(60);
    expect(daysUntil('2026-09-15', today)).toBe(61);
  });

  it('returns a negative day count for a past expiry', () => {
    expect(daysUntil('2026-07-15', today)).toBe(-1);
  });

  it('returns null for absent or malformed input', () => {
    expect(daysUntil(undefined, today)).toBeNull();
    expect(daysUntil('', today)).toBeNull();
    expect(daysUntil('2026-13-45', today)).toBeNull();
  });

  it('counts days from the ET calendar day', () => {
    const lateNightEt = new Date('2026-07-17T03:00:00Z'); // 23:00 EDT Jul 16
    expect(daysUntil('2026-07-16', lateNightEt)).toBe(0);
  });
});
