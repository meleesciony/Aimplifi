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
  priorBusinessDayIfNonBusiness,
} from '@/lib/dates';
import type { ScheduledLike } from '@/lib/engine/cash-needed/assemble';
import type { LoanObligation } from '@/lib/engine/loans/obligations';
import { monthsPerCadence } from '@/lib/engine/recurring/detect';
import type { ProjectableObligation } from '@/lib/engine/radar/radar';
import type { DueAmountSource } from '@/lib/engine/account/feed-dropped-view';

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
  /**
   * WHERE THE AMOUNT COMES FROM — set on 'card-due' and 'loan-due' only (TASKS C.8 critic F-1).
   *
   * The frozen-account disclosure qualifies a due by naming the field the bank stopped confirming,
   * and that field differs by how THIS event was produced: a current statement, a synthesized repeat
   * of one, or a balance estimate. Before this was carried, a later-month synthesis reused the
   * boolean `isEstimated`, and a frozen card WITH a statement was told its figure was "worked out
   * from the last balance we saw" — a false provenance for money. The engine knows which branch it
   * painted; handing the fact over keeps the disclosure from re-deriving it (and getting it wrong).
   */
  amountSource?: DueAmountSource;
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
    // MONTHLY 1 calendar month, QUARTERLY 3, SEMIANNUAL 6, ANNUAL 12 — from the
    // ONE table in detect.ts (L.23 admitted ANNUAL, L.24 the two middle
    // cadences; a missed branch here is silent, falling through to the
    // single-occurrence `else` below). A month view holds at most one occurrence
    // of any of them, so within one month this matches that `else`. It is NOT
    // equivalent in general, and the difference is reachable here rather than
    // hypothetical: `month` is a URL query param with prev/next links, so a
    // reader is three clicks from the quarterly bill's next appearance and
    // twelve from the annual premium's — months the old `else` left empty. This
    // is the expander where the explicit step earns the most: forecast and
    // cash-needed cap at a 90-day horizon, which is SHORTER than a quarterly
    // period, so there the difference is only a multi-year window or a stale
    // anchor. A row dated in the past also steps forward now.
    const monthStep = monthsPerCadence(row.cadence);
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
  /** current + upcoming, from the engine; `cycleBasisCents` prices future cycles. */
  cardObligations: readonly ProjectableObligation[];
  loanObligations?: readonly LoanObligation[]; // next LOAN/MORTGAGE payments (#134)
  /**
   * REQUIRED (the L.15 defaulted-argument lesson): synthesized cycles are only
   * ever dated AFTER today — a stale anchor from a long-passed due date must be
   * skipped, and only a caller that hands over its own `today` gets that guard.
   */
  today: ISODate;
  /**
   * REQUIRED for the same reason: every synthesized occurrence is re-adjusted to
   * the prior business day with the SAME table the obligation's own effective
   * date was adjusted with, or a future month's badge would sit on a weekend the
   * current month's footnote just promised roll back.
   */
  holidays: readonly ISODate[];
}): CashFlowCalendar {
  const { month, today, holidays } = params;
  const year = +month.slice(0, 4);
  const mo = +month.slice(5, 7);
  const first = isoDate(`${month}-01`);
  const last = isoDate(`${month}-${String(daysInMonth(year, mo)).padStart(2, '0')}`);
  // A synthesized occurrence steps from the RAW due date and then rolls BACK to
  // the prior business day, so its raw date can sit a few days past `last` while
  // its effective date still lands inside the month (a 1st falling on a long
  // weekend is the live shape). The longest US weekend+holiday run rolls back 4
  // days; 7 is the safe margin. Iteration stays bounded for a far-past month too:
  // k=1's raw date is already past `last`, so the loop exits at once.
  const rawLimit = addDays(last, 7);

  // K.1 (owner report 2026-08-06: "I have forward data but not trailing?"): the past half of the
  // grid belongs to POSTED transactions now (calendar/posted.ts) — a scheduled series replayed
  // onto dates the bank has already reported was a projection wearing data's clothes, and it is
  // exactly what the owner mistook for history. Scheduled expansions therefore start AT `today`,
  // never before it; a wholly-past month gets none. ON today deliberately (critic F-2): the
  // cash-needed assembler includes occurrences on today (`assemble.ts`, `>= p.today`) and can
  // recommend a transfer FOR today — a bill expected today that has not yet posted must paint on
  // the one day it is most actionable, even though the posted half may later carry the same
  // dollars as fact (both are labeled; the footer names the overlap). Due events are untouched: a
  // current-cycle due sitting in the past is a real unpaid obligation, not a replay, and the
  // synthesized future cycles already carry their own `> today` guard below.
  const scheduledFrom = compareDates(first, today) >= 0 ? first : today;
  const events: CalendarEvent[] =
    compareDates(scheduledFrom, last) > 0 ? [] : expandScheduled(params.scheduled, scheduledFrom, last);
  for (const ob of params.cardObligations) {
    // THIS cycle: the engine's real obligation, exactly as before (C.8 left the
    // current-month event untouched — it added the OTHER months).
    if (ob.cashRequiredCents > 0) {
      if (compareDates(ob.effectiveDueDate, first) >= 0 && compareDates(ob.effectiveDueDate, last) <= 0) {
        events.push({
          date: ob.effectiveDueDate,
          kind: 'card-due',
          label: `${ob.cardName} due${ob.isEstimated ? ' (est.)' : ''}`,
          amountCents: cents(-ob.cashRequiredCents),
          isEstimated: ob.isEstimated,
          accountId: ob.cardId,
          // An estimate-path obligation carries no statement; its amount is worked out from the
          // balance. A statement obligation's is the statement's own figure.
          amountSource: ob.isEstimated ? 'balance' : 'statement',
        });
      }
    }
    // FUTURE cycles (TASKS C.8 / audit P0-3): monthly repeats of this card's
    // obligation, mirroring the radar's `projectCardDues` rule for rule — step
    // from the RAW issuer due date (stepping from the effective date would drag
    // one month's weekend shift into every later month), re-adjust per
    // occurrence, price at the statement basis, ALWAYS labeled estimated
    // (adjudicated condition 3: statements not generated yet). Skipping stale
    // anchors and credit-balance statements is the radar's guard verbatim.
    const futureAmount = ob.cycleBasisCents ?? ob.cashRequiredCents;
    if (futureAmount <= 0) continue; // a credit-balance statement is not a recurring debit
    for (let k = 1; ; k++) {
      const raw = addMonthsClamped(ob.dueDate, k);
      if (compareDates(raw, rawLimit) > 0) break;
      const effective = priorBusinessDayIfNonBusiness(raw, holidays);
      if (compareDates(effective, first) < 0 || compareDates(effective, last) > 0) continue;
      // Stale anchor from a long-passed due date. NOTE (critic F-4, recorded residual): this guard
      // also drops an occurrence that lands EXACTLY on `today` for an obligation more than a month
      // overdue (k=1 steps onto today's date), leaving two real demands on one event. It is the
      // radar's guard verbatim (`projectCardDues`), so parity holds, and the shape needs
      // delinquency — not a slice defect.
      if (compareDates(effective, today) <= 0) continue;
      // A repeat is of the STATEMENT unless the obligation is on the estimate path (no statement,
      // balance-derived). Keyed on the obligation's own path, NOT merely on the presence of
      // `cycleBasisCents`: that field is a page-injected enrichment, so a statement card handed in
      // bare (no basis) must still read as a repeated statement, not a balance estimate (critic
      // F-1). The frozen disclosure branches on this, and it must be true.
      const repeatsStatement = !ob.isEstimated || ob.cycleBasisCents != null;
      events.push({
        date: effective,
        kind: 'card-due',
        label: `${ob.cardName} due (est.)`,
        amountCents: cents(-futureAmount),
        isEstimated: true,
        accountId: ob.cardId,
        amountSource: repeatsStatement ? 'repeated-statement' : 'balance',
      });
    }
  }
  for (const ob of params.loanObligations ?? []) {
    if (ob.paymentCents <= 0) continue;
    // THIS cycle, unchanged.
    if (compareDates(ob.effectiveDueDate, first) >= 0 && compareDates(ob.effectiveDueDate, last) <= 0) {
      events.push({
        date: ob.effectiveDueDate,
        kind: 'loan-due',
        label: `${ob.accountName} due`,
        amountCents: cents(-ob.paymentCents),
        accountId: ob.accountId,
        amountSource: 'loan-terms',
      });
    }
    // FUTURE cycles: the fixed monthly payment repeats — the amount is the
    // issuer-reported contract payment (never an estimate, never `(est.)`,
    // exactly as `LoanObligation.isEstimated` documents). /forecast expands the
    // same loan at this cadence from this same RAW anchor
    // (`loanObligationsToScheduledFlows`), so the two surfaces share an anchor and
    // a cadence; their DISPLAY conventions differ by design — the calendar rolls
    // each occurrence back to a business day, /forecast prints the raw date
    // (critic F-2: an earlier comment overclaimed "one date"). Deliberately NOT
    // re-derived from the day-of-month: an anchor clamped by a short month would
    // then disagree with /forecast even on the anchor, and unifying both
    // expanders is a separate slice (recorded residual, C.8).
    for (let k = 1; ; k++) {
      const raw = addMonthsClamped(ob.dueDate, k);
      if (compareDates(raw, rawLimit) > 0) break;
      const effective = priorBusinessDayIfNonBusiness(raw, holidays);
      if (compareDates(effective, first) < 0 || compareDates(effective, last) > 0) continue;
      if (compareDates(effective, today) <= 0) continue; // stale anchor (same F-4 residual as cards)
      events.push({
        date: effective,
        kind: 'loan-due',
        label: `${ob.accountName} due`,
        amountCents: cents(-ob.paymentCents),
        accountId: ob.accountId,
        amountSource: 'loan-terms',
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
