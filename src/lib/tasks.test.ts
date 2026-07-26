import { describe, it, expect } from 'vitest';
import { isRepeating, nextDueDate } from './tasks';
import { Task } from '../types';

const task = (over: Partial<Task>): Task => ({
  id: '1',
  title: 'x',
  assignee: 'Matt',
  isCompleted: false,
  createdBy: 'u',
  authorName: 'A',
  createdAt: '',
  ...over,
});
describe('isRepeating', () => {
  it('is false for none or undefined', () => {
    expect(isRepeating(task({ repeat: 'none' }))).toBe(false);
    expect(isRepeating(task({}))).toBe(false);
  });

  it('is true for a real repeat value', () => {
    expect(isRepeating(task({ repeat: 'weekly' }))).toBe(true);
  });
});

describe('nextDueDate', () => {
  it('adds the right interval to a future due date', () => {
    expect(nextDueDate('daily', '2099-01-01')).toBe('2099-01-02');
    expect(nextDueDate('weekly', '2099-01-01')).toBe('2099-01-08');
    expect(nextDueDate('monthly', '2099-01-01')).toBe('2099-02-01');
  });

  it('catches up from today when the due date is overdue', () => {
    // A long-past due date should reschedule into the future, not stay in 2000.
    expect(nextDueDate('daily', '2000-01-01') > '2025-01-01').toBe(true);
  });
});
