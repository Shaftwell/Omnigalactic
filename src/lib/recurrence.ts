import { isSameDay, isAfter, isBefore, addDays, addWeeks, addMonths, addYears, parseISO } from 'date-fns';
import { Event } from '../types';

/**
 * Expands an event into its visible instances within [start, end],
 * following its recurrence rule. Instance ids are `${id}-${timestamp}`.
 */
export function getEventInstances(event: Event, start: Date, end: Date): Event[] {
  const eventDate = parseISO(event.date);

  if (!event.recurrence || event.recurrence === 'none') {
    if (isSameDay(eventDate, start) || isSameDay(eventDate, end) || (isAfter(eventDate, start) && isBefore(eventDate, end))) {
      return [event];
    }
    return [];
  }

  const instances: Event[] = [];
  let currentInstanceDate = eventDate;

  // Safety: don't calculate unbounded instances (3000 daily steps ≈ 8 years of reach)
  let count = 0;
  const maxInstances = 3000;

  while ((isBefore(currentInstanceDate, end) || isSameDay(currentInstanceDate, end)) && count < maxInstances) {
    if (isSameDay(currentInstanceDate, start) || isSameDay(currentInstanceDate, end) || (isAfter(currentInstanceDate, start) && isBefore(currentInstanceDate, end))) {
      instances.push({
        ...event,
        date: currentInstanceDate.toISOString(),
        id: `${event.id}-${currentInstanceDate.getTime()}` // Unique ID for instances
      });
    }

    switch (event.recurrence) {
      case 'daily':
        currentInstanceDate = addDays(currentInstanceDate, 1);
        break;
      case 'weekly':
        currentInstanceDate = addWeeks(currentInstanceDate, 1);
        break;
      case 'monthly':
        currentInstanceDate = addMonths(currentInstanceDate, 1);
        break;
      case 'bi-monthly':
        currentInstanceDate = addMonths(currentInstanceDate, 2);
        break;
      case 'semi-annually':
        currentInstanceDate = addMonths(currentInstanceDate, 6);
        break;
      case 'annually':
        currentInstanceDate = addYears(currentInstanceDate, 1);
        break;
      default:
        return instances;
    }
    count++;
  }

  return instances;
}
