/**
 * dates.ts — the ONLY date utilities for business logic.
 *
 * Business dates are calendar dates: `YYYY-MM-DD` strings (type ISODate).
 * No `Date` objects, no timezones, no `Date.now()` in business logic — all
 * arithmetic here is pure integer math on civil dates (days-from-civil
 * algorithm), so results are identical on every machine and in every TZ.
 */

export type ISODate = string & { __brand: 'iso-date' };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoDate(s: string): ISODate {
  const m = ISO_RE.exec(s);
  if (!m) throw new Error(`isoDate: malformed date "${s}"`);
  const [, y, mo, d] = m;
  const year = +y, month = +mo, day = +d;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`isoDate: invalid calendar date "${s}"`);
  }
  return s as ISODate;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

function parts(d: ISODate): { y: number; m: number; d: number } {
  return { y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) };
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function fromParts(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` as ISODate;
}

/** Days since 1970-01-01 (can be negative). Howard Hinnant's days_from_civil. */
export function toEpochDays(date: ISODate): number {
  const { y: yy, m, d } = parts(date);
  const y = m <= 2 ? yy - 1 : yy;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Inverse of toEpochDays (civil_from_days). */
export function fromEpochDays(z: number): ISODate {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return fromParts(m <= 2 ? y + 1 : y, m, d);
}

/** Lexicographic compare works for ISO dates; returned as -1 | 0 | 1. */
export function compareDates(a: ISODate, b: ISODate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromEpochDays(toEpochDays(date) + days);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return toEpochDays(to) - toEpochDays(from);
}

/**
 * Add months, clamping the day-of-month to the target month's length:
 * addMonthsClamped('2026-01-31', 1) → '2026-02-28'.
 */
export function addMonthsClamped(date: ISODate, months: number): ISODate {
  const { y, m, d } = parts(date);
  const zeroBased = y * 12 + (m - 1) + months;
  const ny = Math.floor(zeroBased / 12);
  const nm = (zeroBased % 12 + 12) % 12 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return fromParts(ny, nm, nd);
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday (4). */
export function dayOfWeek(date: ISODate): number {
  const z = toEpochDays(date);
  return ((z + 4) % 7 + 7) % 7;
}

export function isWeekend(date: ISODate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

/** nth (1-based) occurrence of a weekday (0=Sun..6=Sat) in a month. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): ISODate {
  const first = fromParts(year, month, 1);
  const offset = ((weekday - dayOfWeek(first)) % 7 + 7) % 7;
  return fromParts(year, month, 1 + offset + (nth - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): ISODate {
  const last = fromParts(year, month, daysInMonth(year, month));
  const offset = ((dayOfWeek(last) - weekday) % 7 + 7) % 7;
  return addDays(last, -offset);
}

/** Sat → observed Friday before; Sun → observed Monday after. */
function observed(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  if (dow === 6) return addDays(date, -1);
  if (dow === 0) return addDays(date, 1);
  return date;
}

/**
 * US federal holidays for a year, as OBSERVED dates (the dates banks and the
 * Federal Reserve actually close). Computed, not hardcoded, so any seed year works.
 */
export function usFederalHolidaysObserved(year: number): ISODate[] {
  const fixed = (m: number, d: number) => observed(fromParts(year, m, d));
  return [
    fixed(1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3), // MLK Day — 3rd Monday Jan
    nthWeekdayOfMonth(year, 2, 1, 3), // Washington's Birthday — 3rd Monday Feb
    lastWeekdayOfMonth(year, 5, 1), // Memorial Day — last Monday May
    fixed(6, 19), // Juneteenth
    fixed(7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1), // Labor Day — 1st Monday Sep
    nthWeekdayOfMonth(year, 10, 1, 2), // Columbus Day — 2nd Monday Oct
    fixed(11, 11), // Veterans Day
    nthWeekdayOfMonth(year, 11, 4, 4), // Thanksgiving — 4th Thursday Nov
    fixed(12, 25), // Christmas
  ];
}

/** Holiday table spanning [fromYear, toYear], for injection into engines. */
export function holidayTable(fromYear: number, toYear: number): ISODate[] {
  const out: ISODate[] = [];
  for (let y = fromYear; y <= toYear; y++) out.push(...usFederalHolidaysObserved(y));
  return out;
}

export function isBusinessDay(date: ISODate, holidays: readonly ISODate[]): boolean {
  return !isWeekend(date) && !holidays.includes(date);
}

/**
 * Walk BACK to the nearest business day if `date` falls on a weekend or
 * holiday (conservative rule for payment due dates: funds must arrive by the
 * prior business day). A business day passes through unchanged.
 */
export function priorBusinessDayIfNonBusiness(date: ISODate, holidays: readonly ISODate[]): ISODate {
  let d = date;
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

/** The business day strictly before `date` (for "transfer by" recommendations). */
export function previousBusinessDay(date: ISODate, holidays: readonly ISODate[]): ISODate {
  let d = addDays(date, -1);
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

/** First day of the month containing `date`. */
export function startOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return fromParts(y, m, 1);
}

/**
 * The calendar month a YYYY-MM-DD date falls in, as a "YYYY-MM" key — the grouping
 * key every monthly aggregation in the app uses.
 *
 * Trivial to inline, and that is exactly why six engines had each inlined their own
 * `const ym = (d: string) => d.slice(0, 7)` (2026-07-21 review, finding B4). It
 * belongs here with the rest of the date rules (CLAUDE.md rule 3: no ad-hoc date
 * math in business logic), so there is ONE place to look when the key format or
 * the timezone question comes up.
 *
 * Deliberately a pure string slice, NOT a Date conversion: business dates in this
 * app are calendar dates, so the month key must never depend on the runtime's
 * timezone. Input is a plain `string` rather than the branded `ISODate` because
 * every caller reads dates off already-validated rows; slicing a malformed string
 * yields a malformed key rather than throwing, which is the same behaviour the six
 * local copies had.
 */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * Month-key arithmetic: the "YYYY-MM" key `months` after `month` (negative goes
 * back). Five engines had wrapped `addMonthsClamped` this way under five names
 * (prevYm / nextMonth / priorYm); this is the shared one.
 *
 * Routes through the tested `addMonthsClamped` on the 1st of the month, so year
 * boundaries and the 12-month wrap are handled by the same code as every other
 * month step. Throws on a malformed key (via `isoDate`), matching the copies.
 */
export function addMonthsToMonthKey(month: string, months: number): string {
  return monthKey(addMonthsClamped(isoDate(`${month}-01`), months));
}

/**
 * Next calendar date with the given day-of-month, on/after `from` (clamped to
 * the month's length, so day 31 in a 30-day month lands on the 30th). The single
 * tested home for this rule — shared by the cash-needed assembler (card cycle/due
 * derivation) and the loan-obligation engine (rule #3: one date utility module).
 */
export function nextDayOfMonth(day: number, from: ISODate): ISODate {
  const y = +from.slice(0, 4);
  const m = +from.slice(5, 7);
  const clamped = Math.min(day, daysInMonth(y, m));
  const candidate = isoDate(`${from.slice(0, 7)}-${String(clamped).padStart(2, '0')}`);
  if (compareDates(candidate, from) >= 0) return candidate;
  const nm = addMonthsClamped(isoDate(`${from.slice(0, 7)}-01`), 1);
  const ny = +nm.slice(0, 4);
  const nmo = +nm.slice(5, 7);
  return isoDate(`${nm.slice(0, 7)}-${String(Math.min(day, daysInMonth(ny, nmo))).padStart(2, '0')}`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format a YYYY-MM month for humans: "Jun 2026" (long) or "Jun '26" (short). */
export function formatMonth(ym: string, style: 'long' | 'short' = 'long'): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) return ym; // out-of-range/malformed input passes through unchanged
  const name = MONTHS[+m[2] - 1];
  return style === 'long' ? `${name} ${m[1]}` : `${name} '${m[1].slice(2)}`;
}

/** Relative phrasing for a date vs "today": "today", "tomorrow", "in 3 days", "2 days ago". */
export function formatRelativeDays(today: ISODate, date: ISODate): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Format for display, e.g. "Mon, Jun 15". UI boundary only. */
export function formatISODate(date: ISODate, style: 'short' | 'long' = 'short'): string {
  const { y, m, d } = parts(date);
  const base = `${DOW[dayOfWeek(date)]}, ${MONTHS[m - 1]} ${d}`;
  return style === 'long' ? `${base}, ${y}` : base;
}
