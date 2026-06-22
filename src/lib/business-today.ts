/**
 * The ONE sanctioned wall-clock read for business "today" (DECISIONS #58).
 *
 * Precedence:
 *   1. DEMO_TODAY (if set) — pins the date for tests and any explicitly-pinned
 *      demo deployment. Every golden/known-answer test sets this, so this module
 *      can never change their behavior.
 *   2. The seeded DEMO user — its dataset is anchored at the seed asOf
 *      (DEFAULT_AS_OF), so "today" stays coherent with the curated demo even in a
 *      production deploy where DEMO_TODAY is unset.
 *   3. Everyone else (real signed-up users) — the REAL system clock, formatted to
 *      a calendar date once, right here. This is the fix for the prior bug where a
 *      deploy with DEMO_TODAY unset froze every user's "today" at the seed date,
 *      corrupting days-until-due, reminders, and the net-worth "today" point.
 *
 * Keeping the clock read in this single module preserves the "no ad-hoc new Date()
 * in business logic" rule everywhere else — call sites pass the userId and get a
 * pure ISODate back.
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { DEFAULT_AS_OF } from '@/lib/seed/build';
import { DEMO_USER_ID } from '@/auth.config';

/** Real local calendar date (single sanctioned wall-clock read). */
function realClockToday(): ISODate {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return isoDate(`${y}-${m}-${day}`);
}

export function businessToday(userId?: string): ISODate {
  const pinned = process.env.DEMO_TODAY;
  if (pinned) return isoDate(pinned);
  if (userId === DEMO_USER_ID) return isoDate(DEFAULT_AS_OF);
  return realClockToday();
}
