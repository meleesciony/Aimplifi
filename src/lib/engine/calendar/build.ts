/**
 * Cash-flow calendar (Phase 4): inflows, outflows, and card due dates on one
 * timeline. Pure function — expands scheduled cadences and lays card
 * obligations (from the cash-needed engine's per-card output) onto days.
 */
import { type Cents, cents } from '@/lib/money';
import {
  type ISODate,
  addDays,
  addMonthsClamped,
  compareDates,
  daysInMonth,
  isoDate,
} from '@/lib/dates';
import type { CardObligation } from '@/lib/engine/cash-needed/types';
import type { ScheduledLike } from '@/lib/engine/cash-needed/assemble';
import type { LoanObligation } from '@/lib/engine/loans/obligations';

export interface CalendarEvent {
  date: ISODate;
  kind: 'inflow' | 'outflow' | 'card-due' | 'loan-due';
  label: string;
  amountCents: Cents; // signed; card-due / loan-due negative (cash leaving)
  isEstimated?: boolean;
  /**
   * The account this event is a due for — set on 'card-due' and 'loan-due' only (TASKS L.15 (a)).
   *
   * Carried so a caller can say something TRUE about the events this month actually holds. The
   * duplicate disclosure must name only cards the reader can find on the grid in front of them, and
   * an obligation whose due date falls outside the displayed month emits no event at all — so
   * re-deriving the set from `cardObligations` at the call site would name a card that is not there.
   * The engine already knows the id; handing it over is cheaper and safer than a second copy of this
   * function's own month-window and `cashRequiredCents > 0` predicates.
   */
  accountId?: string;
}

export interface CalendarDay {
  date: ISODate;
  events: CalendarEvent[];
  netCents: Cents;
}

export interface CashFlowCalendar {
  month: string; // YYYY-MM
  days: CalendarDay[];
  totalInCents: Cents;
  totalOutCents: Cents;
  /** Days needing a reminder: a card-due OR loan-due event within the month. */
  reminderDates: ISODate[];
}

/** Expand scheduled rows into dated occurrences within [from, to]. */
export function expandScheduled(
  rows: readonly ScheduledLike[],
  from: ISODate,
  to: ISODate,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const row of rows) {
    const start = isoDate(row.nextDate);
    const push = (date: ISODate) => {
      if (compareDates(date, from) >= 0 && compareDates(date, to) <= 0) {
        out.push({
          date,
          kind: row.amountCents >= 0 ? 'inflow' : 'outflow',
          label: row.description,
          amountCents: cents(row.amountCents),
        });
      }
    };
    // MONTHLY steps 1 calendar month, ANNUAL steps 12 (L.23 — a detected annual
    // bill now reaches the calendar). A month view can hold at most one
    // occurrence of either an annual or a one-off row, so this is
    // behaviour-identical to the single-occurrence `else` below for every window
    // this builder is called with; the explicit step is what keeps a wider
    // window honest.
    const monthStep = row.cadence === 'MONTHLY' ? 1 : row.cadence === 'ANNUAL' ? 12 : 0;
    if (monthStep > 0) {
      for (let i = 0; ; i++) {
        const occ = addMonthsClamped(start, i * monthStep);
        if (compareDates(occ, to) > 0) break;
        push(occ);
      }
    } else if (row.cadence === 'WEEKLY' || row.cadence === 'BIWEEKLY') {
      const step = row.cadence === 'WEEKLY' ? 7 : 14;
      for (let occ = start; compareDates(occ, to) <= 0; occ = addDays(occ, step)) push(occ);
    } else {
      push(start);
    }
  }
  return out;
}

export function buildCashFlowCalendar(params: {
  month: string; // YYYY-MM
  scheduled: readonly ScheduledLike[];
  cardObligations: readonly CardObligation[]; // current + upcoming, from the engine
  loanObligations?: readonly LoanObligation[]; // next LOAN/MORTGAGE payments (#134)
}): CashFlowCalendar {
  const { month } = params;
  const year = +month.slice(0, 4);
  const mo = +month.slice(5, 7);
  const first = isoDate(`${month}-01`);
  const last = isoDate(`${month}-${String(daysInMonth(year, mo)).padStart(2, '0')}`);

  const events: CalendarEvent[] = expandScheduled(params.scheduled, first, last);
  for (const ob of params.cardObligations) {
    if (ob.cashRequiredCents <= 0) continue;
    if (compareDates(ob.effectiveDueDate, first) >= 0 && compareDates(ob.effectiveDueDate, last) <= 0) {
      events.push({
        date: ob.effectiveDueDate,
        kind: 'card-due',
        label: `${ob.cardName} due${ob.isEstimated ? ' (est.)' : ''}`,
        amountCents: cents(-ob.cashRequiredCents),
        isEstimated: ob.isEstimated,
        accountId: ob.cardId,
      });
    }
  }
  for (const ob of params.loanObligations ?? []) {
    if (ob.paymentCents <= 0) continue;
    if (compareDates(ob.effectiveDueDate, first) >= 0 && compareDates(ob.effectiveDueDate, last) <= 0) {
      events.push({
        date: ob.effectiveDueDate,
        kind: 'loan-due',
        label: `${ob.accountName} due`,
        amountCents: cents(-ob.paymentCents),
        accountId: ob.accountId,
      });
    }
  }

  const byDate = new Map<ISODate, CalendarEvent[]>();
  for (const e of events) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  const days: CalendarDay[] = [];
  let totalIn = 0;
  let totalOut = 0;
  for (let d = first; compareDates(d, last) <= 0; d = addDays(d, 1)) {
    const dayEvents = (byDate.get(d) ?? []).sort((a, b) => b.amountCents - a.amountCents);
    const net = dayEvents.reduce((s, e) => s + e.amountCents, 0);
    for (const e of dayEvents) {
      if (e.amountCents >= 0) totalIn += e.amountCents;
      else totalOut += -e.amountCents;
    }
    days.push({ date: d, events: dayEvents, netCents: cents(net) });
  }

  return {
    month,
    days,
    totalInCents: cents(totalIn),
    totalOutCents: cents(totalOut),
    reminderDates: days
      .filter((d) => d.events.some((e) => e.kind === 'card-due' || e.kind === 'loan-due'))
      .map((d) => d.date),
  };
}
