import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from './quickAdd';

describe('parseQuickAdd', () => {
  it('extracts a weekly recurrence and cleans the title', () => {
    const r = parseQuickAdd('Trash pickup every monday');
    expect(r.recurrence).toBe('weekly');
    expect(r.title).toBe('Trash pickup');
  });

  it('detects monthly recurrence', () => {
    expect(parseQuickAdd('Pay rent monthly').recurrence).toBe('monthly');
  });

  it('detects annual recurrence', () => {
    expect(parseQuickAdd('Renew passport every year').recurrence).toBe('annually');
  });

  it('leaves a plain title untouched with no recurrence or date', () => {
    const r = parseQuickAdd('Dinner with Mom');
    expect(r.recurrence).toBe('none');
    expect(r.title).toBe('Dinner with Mom');
    expect(r.dateISO).toBeNull();
  });

  it('capitalizes and strips trailing prepositions around a parsed date', () => {
    const r = parseQuickAdd('lunch tomorrow');
    expect(r.title).toBe('Lunch');
    expect(r.dateISO).not.toBeNull();
    expect(r.hasTime).toBe(false);
  });
});
