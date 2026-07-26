/**
 * Cash-flow forecast engine (DECISIONS #72) — projects a single account's
 * balance forward day by day from known recurring flows (scheduled income +
 * bills, cadences expanded), surfacing the 30/60/90-day balances, the lowest
 * point, and the first date it would dip below zero. This is the forward-looking
 * complement to the cash-needed engine's this-cycle answer.
 *
 * Pure: integer cents in/out, ISO-date strings, no I/O, no `new Date()`.
 */
import { addDays, addMonthsClamped, compareDates, isoDate, type ISODate } from '@/lib/dates';
import type { LoanObligation } from '@/lib/engine/loans/obligations';

/** ANNUAL is included since L.23 (a detected annual bill is projected — see
 *  `toScheduledTransactions`); null = a one-off with a single dated occurrence. */
export type ScheduledCadence = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'ANNUAL' | null;

export interface ScheduledFlow {
  description: string;
  amountCents: number; // signed: + inflow, − outflow
  nextDate: string; // YYYY-MM-DD
  cadence: ScheduledCadence;
}

/**
 * Map loan-due obligations (#134) into forecast scheduled flows: each loan's fixed monthly
 * payment as a signed outflow recurring on its raw due day-of-month. A LOAN/MORTGAGE payment
 * really debits checking every month, but it is NOT in snap.scheduled (it surfaces only as a
 * loan-due obligation on the calendar/reminders), so the balance projection would otherwise
 * over-project checking. Anchors on `dueDate` (the TRUE day-of-month), NOT `effectiveDueDate`:
 * the MONTHLY expander steps by calendar month, so a business-day-shifted anchor would drag
 * that shift into every future month; the business-day adjustment is a calendar/reminder display
 * nicety, immaterial to the balance trajectory. This does NOT de-duplicate against a
 * recurring-detected loan ACH — no structural key links a checking scheduled row to a loan
 * Account (heuristic money-matching is rejected, STATUS #134), so the narrow non-transfer-ACH
 * double-count residual is unchanged.
 */
export function loanObligationsToScheduledFlows(
  obligations: readonly LoanObligation[],
): ScheduledFlow[] {
  return obligations
    .filter((o) => o.paymentCents > 0)
    .map((o) => ({
      description: o.accountName,
      amountCents: -o.paymentCents, // signed outflow
      nextDate: o.dueDate, // RAW day-of-month (see docstring), never effectiveDueDate
      cadence: 'MONTHLY' as const,
    }));
}

export interface ForecastEvent {
  date: string;
  amountCents: number; // signed
  label: string;
}

/** Expand recurring scheduled rows into dated occurrences in (today, today+horizon]. */
export function expandScheduled(
  rows: readonly ScheduledFlow[],
  today: string,
  horizonDays: number,
): ForecastEvent[] {
  const t = isoDate(today);
  const horizon = addDays(t, horizonDays);
  const out: ForecastEvent[] = [];
  const push = (d: ISODate, row: ScheduledFlow) => {
    if (compareDates(d, t) > 0 && compareDates(d, horizon) <= 0) {
      out.push({ date: d, amountCents: row.amountCents, label: row.description });
    }
  };
  for (const row of rows) {
    const start = isoDate(row.nextDate);
    // MONTHLY steps 1 calendar month, ANNUAL steps 12 (L.23 — a detected annual
    // bill now reaches this forecast). Within the horizons this engine is called
    // with (≤90 days) an ANNUAL row has at most one occurrence, so this matches
    // the single-occurrence `else` below — except across a window of a year or
    // more, and for a row whose nextDate is already past, which now steps
    // forward instead of being dropped (a date-scoped difference, not a
    // window-scoped one; the second yearly occurrence needs ~431 days, not 366).
    const monthStep = row.cadence === 'MONTHLY' ? 1 : row.cadence === 'ANNUAL' ? 12 : 0;
    if (monthStep > 0) {
      for (let i = 0; ; i++) {
        const occ = addMonthsClamped(start, i * monthStep);
        if (compareDates(occ, horizon) > 0) break;
        push(occ, row);
      }
    } else if (row.cadence === 'WEEKLY' || row.cadence === 'BIWEEKLY') {
      const step = row.cadence === 'WEEKLY' ? 7 : 14;
      for (let occ = start; compareDates(occ, horizon) <= 0; occ = addDays(occ, step)) {
        push(occ, row);
      }
    } else {
      push(start, row);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface ForecastInput {
  today: string;
  startingBalanceCents: number;
  horizonDays: number;
  /** Dated occurrences (already expanded) within (today, today+horizon]. */
  events: ForecastEvent[];
}

export interface ForecastDay {
  date: string;
  netCents: number;
  balanceCents: number;
  events: { label: string; amountCents: number }[];
}
export interface ForecastPoint {
  date: string;
  balanceCents: number;
}
export interface ForecastMilestone {
  dayOffset: number;
  date: string;
  balanceCents: number;
}

export interface Forecast {
  today: string;
  days: ForecastDay[]; // inclusive: today .. today+horizon
  startingBalanceCents: number;
  endingBalanceCents: number;
  lowest: ForecastPoint;
  highest: ForecastPoint;
  firstNegativeDate: string | null;
  totalInflowCents: number;
  totalOutflowCents: number; // positive magnitude
  milestones: ForecastMilestone[]; // 30/60/90 within horizon
  upcoming: ForecastEvent[]; // next ≤10 events
}

const MILESTONE_OFFSETS = [30, 60, 90] as const;

export function computeForecast(input: ForecastInput): Forecast {
  const t = isoDate(input.today);

  const byDate = new Map<string, { label: string; amountCents: number }[]>();
  for (const e of input.events) {
    const arr = byDate.get(e.date);
    if (arr) arr.push({ label: e.label, amountCents: e.amountCents });
    else byDate.set(e.date, [{ label: e.label, amountCents: e.amountCents }]);
  }

  const days: ForecastDay[] = [];
  let balance = input.startingBalanceCents;
  let lowest: ForecastPoint = { date: input.today, balanceCents: balance };
  let highest: ForecastPoint = { date: input.today, balanceCents: balance };
  let firstNegativeDate: string | null = balance < 0 ? input.today : null;
  let totalInflowCents = 0;
  let totalOutflowCents = 0;

  for (let d = 0; d <= input.horizonDays; d++) {
    const date = addDays(t, d);
    // Today's balance is the anchor; only future-dated flows move it.
    const evs = d === 0 ? [] : byDate.get(date) ?? [];
    let netCents = 0;
    for (const e of evs) {
      netCents += e.amountCents;
      if (e.amountCents > 0) totalInflowCents += e.amountCents;
      else totalOutflowCents += -e.amountCents;
    }
    balance += netCents;
    days.push({ date, netCents, balanceCents: balance, events: evs });
    if (balance < lowest.balanceCents) lowest = { date, balanceCents: balance };
    if (balance > highest.balanceCents) highest = { date, balanceCents: balance };
    if (firstNegativeDate === null && balance < 0) firstNegativeDate = date;
  }

  const milestones: ForecastMilestone[] = [];
  for (const off of MILESTONE_OFFSETS) {
    if (off <= input.horizonDays) {
      milestones.push({ dayOffset: off, date: days[off].date, balanceCents: days[off].balanceCents });
    }
  }

  const upcoming = [...input.events]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 10);

  return {
    today: input.today,
    days,
    startingBalanceCents: input.startingBalanceCents,
    endingBalanceCents: balance,
    lowest,
    highest,
    firstNegativeDate,
    totalInflowCents,
    totalOutflowCents,
    milestones,
    upcoming,
  };
}
