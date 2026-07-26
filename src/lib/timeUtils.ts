import { TimeFormat } from '../types';

/**
 * Formats a date string or Date object to Eastern Time (America/New_York)
 * with the specified format (Standard or Military).
 */
export function formatToET(date: string | Date | undefined | null, format: TimeFormat = 'standard'): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === 'standard',
  };

  return new Intl.DateTimeFormat('en-US', options).format(d);
}

/**
 * Formats a date string or Date object to Eastern Time (America/New_York)
 * including the date part.
 */
export function formatFullToET(date: string | Date | undefined | null, format: TimeFormat = 'standard'): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === 'standard',
  };

  return new Intl.DateTimeFormat('en-US', options).format(d);
}

/**
 * Converts a date to a string suitable for datetime-local input,
 * but adjusted to Eastern Time.
 */
export function toETInputString(date: string | Date | undefined | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  // Get components in ET
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value;

  // Format: YYYY-MM-DDTHH:mm
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');

  if (!year || !month || !day || !hour || !minute) return '';

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Returns a Date whose local fields read as Eastern Time. Use this for
 * wall-clock/day calculations only: the represented instant is wrong when
 * the runtime is outside Eastern Time, so never persist its toISOString().
 */
export function getNowInET(): Date {
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString);
}

/**
 * Converts a datetime-local input string (assumed to be in ET)
 * back to a UTC ISO string.
 */
export function fromETInputString(input: string): string {
  if (!input) return new Date().toISOString();
  
  // Create a date object from the input string (interpreted as local time)
  const localDate = new Date(input);
  if (isNaN(localDate.getTime())) return new Date().toISOString();
  
  // We need to find the UTC time that, when converted to ET, matches the input.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // We want to find UTC such that formatter.format(UTC) == input
  const parts = formatter.formatToParts(localDate);
  const getPart = (p: Intl.DateTimeFormatPart[], type: string) => p.find(part => part.type === type)?.value;
  
  const etYear = parseInt(getPart(parts, 'year') || '0');
  const etMonth = parseInt(getPart(parts, 'month') || '0') - 1;
  const etDay = parseInt(getPart(parts, 'day') || '0');
  const etHour = parseInt(getPart(parts, 'hour') || '0');
  const etMinute = parseInt(getPart(parts, 'minute') || '0');
  
  const etDateAsLocal = new Date(etYear, etMonth, etDay, etHour, etMinute);
  const offset = etDateAsLocal.getTime() - localDate.getTime();
  
  return new Date(localDate.getTime() - offset).toISOString();
}
