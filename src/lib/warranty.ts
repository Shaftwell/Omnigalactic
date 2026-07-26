// Warranty status is computed against a household "today" in Eastern Time so a
// warranty reads the same on every device regardless of that device's
// clock zone. All comparisons are on date-only YYYY-MM-DD strings (lexical),
// which sidesteps DST/instant ambiguity — a warranty expires on a calendar day,
// not at a wall-clock instant.

export type WarrantyStatus = 'none' | 'active' | 'expiring' | 'expired';

// Warranties within this many days of expiry are surfaced as "expiring".
const EXPIRING_WINDOW_DAYS = 60;

/**
 * Classifies a warranty by its expiry date relative to `today`.
 * - `none` when no (or blank/malformed) expiry is tracked
 * - `expired` when the expiry is before today's ET date
 * - `expiring` when the expiry is today..today+60 days (inclusive)
 * - `active` otherwise
 */
export function warrantyStatus(warrantyExpires: string | undefined, today: Date): WarrantyStatus {
  const expires = normalizeDateOnly(warrantyExpires);
  if (!expires) return 'none';
  const todayStr = etDateOnly(today);
  if (expires < todayStr) return 'expired';
  const windowEnd = addDaysToDateOnly(todayStr, EXPIRING_WINDOW_DAYS);
  if (expires <= windowEnd) return 'expiring';
  return 'active';
}

/**
 * Whole calendar days from today's ET date until `expires` (negative when past,
 * 0 when it is today). Returns null when the expiry is absent or malformed.
 */
export function daysUntil(expires: string | undefined, today: Date): number | null {
  const norm = normalizeDateOnly(expires);
  if (!norm) return null;
  const todayUtc = dateOnlyToUtc(etDateOnly(today));
  const expiresUtc = dateOnlyToUtc(norm);
  return Math.round((expiresUtc - todayUtc) / 86_400_000);
}

// Renders a Date as its YYYY-MM-DD calendar day in America/New_York, mirroring
// the ET-part approach used by src/lib/timeUtils.toETInputString.
function etDateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Validates and canonicalizes a date-only string. Returns the trimmed
// YYYY-MM-DD, or null for blank/mis-shaped/impossible dates (e.g. 2026-13-45).
function normalizeDateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow (e.g. month 13 / day 45 silently roll into the next unit).
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return trimmed;
}

// Calendar arithmetic on a validated YYYY-MM-DD. UTC midnight is used purely as
// a stable anchor for day math; no wall-clock/DST semantics are involved.
function addDaysToDateOnly(dateOnly: string, days: number): string {
  const dt = new Date(dateOnlyToUtc(dateOnly));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateOnlyToUtc(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}
