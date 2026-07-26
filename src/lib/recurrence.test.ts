import { describe, it, expect } from 'vitest';
import { getEventInstances } from './recurrence';
import { Event } from '../types';

const base: Event = {
  id: 'e1',
  title: 'T',
  description: '',
  date: '2026-01-01T12:00:00.000Z',
  createdBy: 'u',
  authorName: 'A',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('getEventInstances', () => {
  it('returns a single non-recurring event inside the range', () => {
    const res = getEventInstances(
      { ...base, recurrence: 'none' },
      new Date('2025-12-01'),
      new Date('2026-02-01'),
    );
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('e1');
  });

  it('excludes a non-recurring event outside the range', () => {
    const res = getEventInstances(
      { ...base, recurrence: 'none' },
      new Date('2026-03-01'),
      new Date('2026-04-01'),
    );
    expect(res).toHaveLength(0);
  });

  it('steps a weekly event by 7 days', () => {
    const res = getEventInstances(
      { ...base, recurrence: 'weekly' },
      new Date('2026-01-01'),
      new Date('2026-02-01'),
    );
    // Jan 1, 8, 15, 22, 29
    expect(res).toHaveLength(5);
  });

  it('gives every instance a unique id derived from the parent', () => {
    const res = getEventInstances(
      { ...base, recurrence: 'weekly' },
      new Date('2026-01-01'),
      new Date('2026-01-22'),
    );
    const ids = new Set(res.map(r => r.id));
    expect(ids.size).toBe(res.length);
    expect(res.every(r => r.id!.startsWith('e1-'))).toBe(true);
  });

  it('caps runaway expansion at the safety limit', () => {
    const res = getEventInstances(
      { ...base, recurrence: 'daily' },
      new Date('2026-01-01'),
      new Date('2200-01-01'),
    );
    expect(res.length).toBeLessThanOrEqual(3000);
  });
});
