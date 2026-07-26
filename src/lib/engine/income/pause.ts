/**
 * Income-Pause Radar (AI_DIFFERENTIATION_PLAN §Later #20, the ONE groundable
 * signature — DECISIONS #251). Pure and deterministic, NO LLM anywhere: a lapsed
 * recurring income series is a fact computable from the user's own history.
 *
 * Reads `detectRecurring` output — the same series every sibling consumer reads
 * (POSTED, non-split input predicate lives at the call site, see server/coach.ts).
 *
 * The lapse arithmetic deliberately does NOT read `nextExpectedAt`: that field is
 * forward-stepped past missed occurrences until it lands ≥ today (detect.ts), so it
 * structurally HIDES a lapse. The expectation here is the raw next date after the
 * last occurrence — `nextDate(lastSeenAt, cadence)` — the same single source of
 * cadence arithmetic the detector and renewals schedule use.
 *
 * Precision-first (the #231 failure-direction lesson, same stance as the anomaly
 * radar #249): "your income seems to have paused" is an alarming claim, so a false
 * positive shouts while a false negative stays quiet. Every gate errs quiet:
 *   • income series only (positive amounts), cadence WEEKLY/BIWEEKLY/MONTHLY —
 *     ANNUAL income (a yearly bonus) is too sparse to call "paused" with one miss;
 *   • occurrences ≥ MIN_OCCURRENCES (4 — three confirmed cadence gaps, one more
 *     than detectRecurring's own floor);
 *   • typicalAmountCents ≥ MIN_AMOUNT_CENTS ($100 — a lapsed $10 deposit is not an
 *     income event worth an alarm);
 *   • aggregate pseudo-merchants (ATM, checks, Zelle — heterogeneous payers behind
 *     one canonical) are excluded entirely (shared guard, #250 F3);
 *   • a cadence-scaled grace period absorbs ordinary payroll jitter (holiday
 *     shifts, ACH delays) before anything is said.
 *
 * TWO exported predicates share this one lapse computation (a guard must read the
 * same input as the thing it guards — lessons ledger):
 *   • `lapsedIncomeSeries` — NO staleness cap. This feeds the projection EXCLUSION
 *     (server/recurring.ts): once the user confirms a pause, the series must stay
 *     out of ScheduledTransaction projections for as long as it remains lapsed —
 *     a cap here would silently re-inject phantom income on day 61.
 *   • `detectIncomePauses` — lapsed ∧ daysLate ≤ STALE_DAYS. This feeds the NUDGE:
 *     a lapse first noticed months later is history, not news, and must not greet
 *     a new user with an alarm about a job they left last year.
 */
import { type ISODate, addDays, addMonthsClamped, compareDates, daysBetween, isoDate } from '@/lib/dates';
import { isAggregateCanonical } from '@/lib/engine/categorize/normalize';
import {
  nextDate,
  type Cadence,
  type RecurringSeriesResult,
} from '@/lib/engine/recurring/detect';

/** Cadences an income pause can be called on. ANNUAL is deliberately absent. */
export type PauseCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

/**
 * Days past the expected date before a miss becomes a lapse. Hand-picked
 * conservative (EDGE_CASES §Income-Pause Radar): a biweekly paycheck 7 days late
 * has missed by half its own period; a monthly deposit 10 days late has cleared
 * every ordinary processing delay.
 */
export const PAUSE_GRACE_DAYS: Readonly<Record<PauseCadence, number>> = {
  WEEKLY: 5,
  BIWEEKLY: 7,
  MONTHLY: 10,
};

/** ≥ this many occurrences (3 confirmed gaps) before a series can be called paused. */
export const MIN_OCCURRENCES = 4;

/** Series below $100 typical never flag — not an income event worth an alarm. */
export const MIN_AMOUNT_CENTS = 100_00;

/**
 * A lapse older than this is history, not news (nudge-worthiness only — the
 * projection-exclusion predicate deliberately has NO such cap, see module doc).
 */
export const STALE_DAYS = 60;

export interface IncomePause {
  merchantCanonical: string;
  accountId: string;
  cadence: PauseCadence;
  /** Verbatim series typical (positive — income series). Never recomputed. */
  typicalAmountCents: number;
  lastSeenAt: ISODate;
  /** The first missed expected date: nextDate(lastSeenAt, cadence). */
  missedSince: ISODate;
  /** daysBetween(missedSince, today) — how long past expected. Always ≥ grace. */
  daysLate: number;
  /** Verbatim series occurrence count — the disclosed basis ("based on N deposits"). */
  occurrences: number;
}

function isPauseCadence(c: Cadence): c is PauseCadence {
  return c === 'WEEKLY' || c === 'BIWEEKLY' || c === 'MONTHLY';
}

/** Last calendar day of the month containing `d`. Built from the tested utilities. */
function endOfMonth(d: ISODate): ISODate {
  return addDays(addMonthsClamped(isoDate(`${d.slice(0, 7)}-01`), 1), -1);
}

/**
 * The first missed expected date for a series (#251 critic F7): normally
 * `nextDate(lastSeenAt, cadence)`, but a MONTHLY deposit whose last occurrence
 * fell on the LAST day of its month is treated as an end-of-month payday — the
 * expectation is the END of the next month, not the clamped same-day. Without
 * this, a 31st payday whose last deposit clamped to Feb 28 gets missedSince
 * Mar 28 and flags when the real (Mar 31) payday is only 7 days late —
 * silently shrinking the documented grace for exactly the payroll shape most
 * likely to jitter. The rule is precision-safe by direction: it can only move
 * the expectation LATER (more grace, never an earlier alarm).
 */
export function missedSinceOf(lastSeenAt: ISODate, cadence: PauseCadence): ISODate {
  const plain = nextDate(lastSeenAt, cadence);
  if (cadence !== 'MONTHLY') return plain;
  if (lastSeenAt !== endOfMonth(lastSeenAt)) return plain;
  return endOfMonth(plain);
}

/**
 * Date-fresh resumption evidence (#251 critic F1): the series has seen a deposit
 * recently enough that its next expectation is not yet missed. DELIBERATELY
 * gate-independent — occurrence counts, amount floors, and aggregate rules govern
 * whether the radar raises the ALARM, but once the user has CONFIRMED a pause,
 * only an actual deposit may retire that consent. (The executed failure this
 * prevents: a provider sync deletes one historical row, occurrences drop 4→3,
 * the series stops being "lapsed" by gate, and the old rule deleted the
 * confirmation and re-projected phantom income with no new deposit ever arriving.)
 */
function seriesResumed(s: RecurringSeriesResult, today: ISODate): boolean {
  if (!isPauseCadence(s.cadence)) return false; // no expectation to be fresh against
  return compareDates(missedSinceOf(s.lastSeenAt, s.cadence), today) >= 0;
}

/**
 * The state of ONE confirmed merchant's pause — the single predicate shared by the
 * projection exclusion (server/recurring.ts), the stale-confirmation cleanup, and
 * the feed's HANDLED state row (a guard must read the same input as the thing it
 * guards; #251 critic F1/F4):
 *   • 'paused'  — an income series with a projectable cadence exists and has NOT
 *     date-fresh resumed: the exclusion is in force and the feed must show the
 *     state row (with Undo), REGARDLESS of the alarm gates.
 *   • 'resumed' — the series exists with a projectable cadence and a fresh
 *     deposit: project normally; the caller deletes the stale confirmation
 *     (fresh evidence, and only fresh evidence, retires consent).
 *   • 'inert'   — no income series with a projectable cadence under this
 *     canonical (vanished from detection, or cadence drifted to ANNUAL/none):
 *     nothing is projected for it, so nothing is excluded, no row renders, and
 *     the confirmation is KEPT (deleting on absence-of-evidence is F1's bug).
 *     The ANNUAL half of that rests on a decision, not on the cadence list:
 *     `toScheduledTransactions` projects annual EXPENSES but deliberately not
 *     annual INCOME (L.23, and the reason is written there). A slice that ever
 *     projects annual income must revisit this branch and `isPauseCadence` with
 *     it — an annual paycheck cannot be judged late by a monthly grace window.
 */
export function confirmedPauseState(
  series: readonly RecurringSeriesResult[],
  today: ISODate,
  merchantCanonical: string,
): { status: 'paused'; pause: IncomePause } | { status: 'resumed' } | { status: 'inert' } {
  const s = series.find(
    (x) => x.isIncome && isPauseCadence(x.cadence) && x.merchantCanonical === merchantCanonical,
  );
  if (!s || !isPauseCadence(s.cadence)) return { status: 'inert' };
  if (seriesResumed(s, today)) return { status: 'resumed' };
  const missedSince = missedSinceOf(s.lastSeenAt, s.cadence);
  return {
    status: 'paused',
    pause: {
      merchantCanonical: s.merchantCanonical,
      accountId: s.accountId,
      cadence: s.cadence,
      typicalAmountCents: s.typicalAmountCents, // verbatim
      lastSeenAt: s.lastSeenAt,
      missedSince,
      daysLate: daysBetween(missedSince, today),
      occurrences: s.occurrences, // verbatim
    },
  };
}

/**
 * Every income series currently lapsed past its cadence grace, regardless of how
 * long ago. Deterministic total order: largest typical first (the series most
 * material to the user's cash), then merchant ascending (locale-free).
 */
export function lapsedIncomeSeries(
  series: readonly RecurringSeriesResult[],
  today: ISODate,
): IncomePause[] {
  const out: IncomePause[] = [];
  for (const s of series) {
    if (!s.isIncome) continue;
    if (!isPauseCadence(s.cadence)) continue;
    if (s.occurrences < MIN_OCCURRENCES) continue;
    if (s.typicalAmountCents < MIN_AMOUNT_CENTS) continue;
    if (isAggregateCanonical(s.merchantCanonical)) continue;
    const missedSince = missedSinceOf(s.lastSeenAt, s.cadence);
    // Not yet due (or due today): nothing has been missed.
    if (compareDates(missedSince, today) >= 0) continue;
    const daysLate = daysBetween(missedSince, today);
    if (daysLate < PAUSE_GRACE_DAYS[s.cadence]) continue;
    out.push({
      merchantCanonical: s.merchantCanonical,
      accountId: s.accountId,
      cadence: s.cadence,
      typicalAmountCents: s.typicalAmountCents, // verbatim
      lastSeenAt: s.lastSeenAt,
      missedSince,
      daysLate,
      occurrences: s.occurrences, // verbatim
    });
  }
  return out.sort((a, b) => {
    if (a.typicalAmountCents !== b.typicalAmountCents) {
      return b.typicalAmountCents - a.typicalAmountCents;
    }
    if (a.merchantCanonical < b.merchantCanonical) return -1;
    if (a.merchantCanonical > b.merchantCanonical) return 1;
    return 0;
  });
}

/**
 * The nudge-worthy subset: lapses recent enough to be news. Same rows, same
 * order as `lapsedIncomeSeries`, minus anything older than STALE_DAYS.
 */
export function detectIncomePauses(
  series: readonly RecurringSeriesResult[],
  today: ISODate,
): IncomePause[] {
  return lapsedIncomeSeries(series, today).filter((p) => p.daysLate <= STALE_DAYS);
}

/** An income pause annotated with whether the user has CONFIRMED it (server state). */
export type IncomePauseState = IncomePause & { confirmed: boolean };

/**
 * The feed's view of income pauses, composed with the user's confirmations:
 *   • UNCONFIRMED lapses are news — the full alarm gates + STALE_DAYS apply (an
 *     old lapse must not greet a new user with an alarm about a job they left
 *     last year);
 *   • CONFIRMED merchants are STATE — one row via `confirmedPauseState`, the SAME
 *     predicate that drives the projection exclusion, shown for as long as that
 *     exclusion is in force: no staleness cap, and no alarm gates either (#251
 *     critic F1 — if occurrences drop below the alarm floor while the exclusion
 *     still holds, the row must not vanish). While the app is excluding income
 *     from projections, the feed discloses it and offers the undo — a money
 *     mutation may never outlive its own visibility (the back-half lesson).
 * Deterministic order: typicalAmountCents desc, then merchant asc.
 */
export function incomePausesForFeed(
  series: readonly RecurringSeriesResult[],
  today: ISODate,
  confirmedMerchants: ReadonlySet<string>,
): IncomePauseState[] {
  const out: IncomePauseState[] = detectIncomePauses(series, today)
    .filter((p) => !confirmedMerchants.has(p.merchantCanonical))
    .map((p) => ({ ...p, confirmed: false }));
  for (const m of confirmedMerchants) {
    const state = confirmedPauseState(series, today, m);
    if (state.status === 'paused') out.push({ ...state.pause, confirmed: true });
  }
  return out.sort((a, b) => {
    if (a.typicalAmountCents !== b.typicalAmountCents) {
      return b.typicalAmountCents - a.typicalAmountCents;
    }
    if (a.merchantCanonical < b.merchantCanonical) return -1;
    if (a.merchantCanonical > b.merchantCanonical) return 1;
    return 0;
  });
}
