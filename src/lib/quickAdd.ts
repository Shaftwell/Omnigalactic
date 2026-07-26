import * as chrono from 'chrono-node';
import { RecurrenceType } from '../types';
import { fromETInputString, getNowInET } from './timeUtils';

export interface QuickAddParse {
  title: string;
  dateISO: string | null; // UTC ISO; the typed time is interpreted as Eastern, matching the event modal
  hasTime: boolean;
  recurrence: RecurrenceType;
  dateText: string | null; // the fragment chrono matched, for preview highlighting
}

export const DEFAULT_EVENT_HOUR = 9;

// Order matters: more specific patterns first. "every monday" keeps the
// weekday word so chrono can anchor the start date on the next monday.
const RECURRENCE_PATTERNS: { regex: RegExp; recurrence: RecurrenceType; keepGroup?: boolean }[] = [
  { regex: /\bevery\s+other\s+month\b|\bbi-?monthly\b/i, recurrence: 'bi-monthly' },
  { regex: /\bevery\s+(?:6|six)\s+months\b|\bsemi-?annually\b|\btwice\s+a\s+year\b/i, recurrence: 'semi-annually' },
  { regex: /\bevery\s+year\b|\bannually\b|\byearly\b/i, recurrence: 'annually' },
  { regex: /\bevery\s+month\b|\bmonthly\b/i, recurrence: 'monthly' },
  { regex: /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i, recurrence: 'weekly', keepGroup: true },
  { regex: /\bevery\s+week\b|\bweekly\b/i, recurrence: 'weekly' },
  { regex: /\bevery\s+day\b|\bdaily\b/i, recurrence: 'daily' },
];

const FILLER_EDGE = /^(?:on|at|in|for|from|by|to|the|a|an)\s+|[\s,.;:-]+$|^[\s,.;:-]+|\s+(?:on|at|in|for|from|by|to)$/i;

function cleanTitle(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  // Strip leftover prepositions/punctuation that hugged the removed date text
  for (let i = 0; i < 4 && FILLER_EDGE.test(t); i++) {
    t = t.replace(FILLER_EDGE, '').trim();
  }
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Parses Fantastical-style input like "Dinner with Mom next Friday at 6pm"
 * or "Trash pickup every monday 8am" into event fields.
 */
export function parseQuickAdd(input: string): QuickAddParse {
  let working = input.trim();
  let recurrence: RecurrenceType = 'none';

  for (const pattern of RECURRENCE_PATTERNS) {
    const match = working.match(pattern.regex);
    if (match) {
      recurrence = pattern.recurrence;
      working = working.replace(pattern.regex, pattern.keepGroup ? match[1] ?? ' ' : ' ');
      break;
    }
  }

  // getNowInET yields a Date whose wall-clock fields read as Eastern time,
  // so chrono resolves "tomorrow"/"friday" relative to the app's home timezone.
  const results = chrono.parse(working, getNowInET(), { forwardDate: true });

  let dateISO: string | null = null;
  let hasTime = false;
  let dateText: string | null = null;

  if (results.length > 0) {
    const r = results[0];
    dateText = r.text;
    hasTime = r.start.isCertain('hour');

    const year = r.start.get('year');
    const month = r.start.get('month'); // chrono months are 1-based
    const day = r.start.get('day');
    const hour = hasTime ? r.start.get('hour') ?? DEFAULT_EVENT_HOUR : DEFAULT_EVENT_HOUR;
    const minute = hasTime ? r.start.get('minute') ?? 0 : 0;

    if (year != null && month != null && day != null) {
      dateISO = fromETInputString(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`);
    }

    working = `${working.slice(0, r.index)} ${working.slice(r.index + r.text.length)}`;
  }

  return { title: cleanTitle(working), dateISO, hasTime, recurrence, dateText };
}
