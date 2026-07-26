import { format, addDays, addMonths, parseISO } from 'date-fns';
import { doc, updateDoc } from 'firebase/firestore';
import { userRoot, db } from '../firebase';
import { Task } from '../types';
import { getNowInET } from './timeUtils';
import { trackWrite } from './syncStatus';

export type TaskRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

export const REPEAT_LABELS: Record<TaskRepeat, string> = {
  none: 'No repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export function isRepeating(task: Task): boolean {
  return !!task.repeat && task.repeat !== 'none';
}

/** Next due date after completing a repeating task (catches up if overdue). */
export function nextDueDate(repeat: TaskRepeat, from: string | null | undefined): string {
  const todayKey = format(getNowInET(), 'yyyy-MM-dd');
  const base = from && from >= todayKey ? parseISO(from) : getNowInET();
  const next = repeat === 'daily' ? addDays(base, 1)
    : repeat === 'weekly' ? addDays(base, 7)
    : addMonths(base, 1);
  return format(next, 'yyyy-MM-dd');
}

/**
 * Toggles a task. Completing a repeating task reschedules it to the next
 * cycle instead of marking it done (chores reappear automatically).
 */
export async function toggleTaskDoc(task: Task): Promise<void> {
  if (!task.id) return;
  const ref = doc(userRoot(), 'todos', task.id);
  if (!task.isCompleted && isRepeating(task)) {
    await trackWrite(updateDoc(ref, {
      dueDate: nextDueDate(task.repeat as TaskRepeat, task.dueDate),
      lastCompletedAt: new Date().toISOString()
    }));
  } else if (task.isCompleted) {
    await trackWrite(updateDoc(ref, { isCompleted: false, completedAt: '' }));
  } else {
    await trackWrite(updateDoc(ref, { isCompleted: true, completedAt: new Date().toISOString() }));
  }
}
