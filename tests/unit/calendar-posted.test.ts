/**
 * TASKS K.1 — the posted half of /calendar (owner report 2026-08-06: "Calendar makes no
 * sense. I have forward data but not trailing?").
 *
 * What these lock, and the fail-old directions:
 *  - Posted day totals are the register's own `summarizeTransactions` output — asserted by
 *    driving BOTH functions over the same rows, so a re-implementation that drifts fails here.
 *  - The fact/projection boundary: the posted half describes dates on or before `today` and
 *    nothing after it; a wholly-future month has no posted half at all.
 *  - WHICH zero (K.3's rule, reused): an empty posted window names its reason from the history
 *    bounds — no-history / before-history / after-history / quiet — with the bound INSIDE the
 *    reason, and the floor is named when history starts mid-month.
 *  - The build.ts clamp: scheduled-series expansions start strictly AFTER today (a series
 *    replayed onto the past was the projection the owner mistook for data). Fail-old both ways:
 *    reverting the clamp makes the "paints nothing on or before today" assertions fail, and a
 *    clamp that over-reaches (silencing the future too) makes the "still paints ahead" ones fail.
 */
import { describe, expect, it } from 'vitest';
import {
  type PostedTxnLike,
  buildPostedCalendarMonth,
  postedZeroCopy,
} from '@/lib/engine/calendar/posted';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import { summarizeTransactions } from '@/lib/engine/transactions/query';
import { formatISODate, holidayTable, isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

const TODAY = isoDate('2026-08-04');

function row(over: Partial<PostedTxnLike> & Pick<PostedTxnLike, 'date' | 'amountCents'>): PostedTxnLike {
  return { isTransfer: false, excludeFromTotals: false, ...over };
}

const BOUNDS = { oldestPostedDate: isoDate('2025-01-05'), newestPostedDate: isoDate('2026-08-03') };

describe('K.1 — posted days total through the register’s own summarize', () => {
  const rows = [
    row({ date: '2026-08-03', amountCents: 245_000 }), // payroll
    row({ date: '2026-08-03', amountCents: -5_000 }), // coffee
    row({ date: '2026-08-03', amountCents: -1_500, isTransfer: true }), // own-account transfer
    row({ date: '2026-08-03', amountCents: -2_000, excludeFromTotals: true }), // reader-excluded
    row({ date: '2026-08-01', amountCents: -12_345 }),
  ];

  it('hand-verified: transfers and excluded rows are listed but leave the money figures', () => {
    const m = buildPostedCalendarMonth({ month: '2026-08', today: TODAY, rows, ...BOUNDS });
    expect(m.postedThrough).toBe('2026-08-04');
    expect(m.days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-03']);
    const d3 = m.days[1];
    expect(d3.inCents).toBe(245_000);
    expect(d3.outCents).toBe(5_000); // NOT 8_500: the transfer and the excluded row are not spending
    expect(d3.netCents).toBe(240_000);
    expect(d3.count).toBe(4); // ...but the register would LIST all four
    expect(m.totalInCents).toBe(245_000);
    expect(m.totalOutCents).toBe(17_345);
    expect(m.rowCount).toBe(5);
    expect(m.excludedCount).toBe(1);
    expect(m.emptyReason).toBeNull();
  });

  it('each day equals the register summary for that day’s rows — the K.1 gate, function-level', () => {
    const m = buildPostedCalendarMonth({ month: '2026-08', today: TODAY, rows, ...BOUNDS });
    for (const day of m.days) {
      const s = summarizeTransactions(rows.filter((r) => r.date === day.date));
      expect(day.inCents, day.date).toBe(s.inflowCents);
      expect(day.outCents, day.date).toBe(s.outflowCents);
      expect(day.netCents, day.date).toBe(s.netCents);
      expect(day.count, day.date).toBe(s.count);
    }
  });
});

describe('K.1 critics F-1/F-6 — pending, transfer and excluded rows are NAMED, never silently folded', () => {
  it('pending rows stay in the figures (the gate) and are counted per day and per month', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [
        row({ date: '2026-08-03', amountCents: -25_000, pending: true }),
        row({ date: '2026-08-03', amountCents: -1_000 }),
        row({ date: '2026-08-01', amountCents: -500, pending: true }),
      ],
      ...BOUNDS,
    });
    // The money is identical to the register's summary — pending is counted there too.
    expect(m.totalOutCents).toBe(26_500);
    expect(m.pendingCount).toBe(2);
    expect(m.days.find((d) => d.date === '2026-08-03')!.pendingCount).toBe(1);
    expect(m.days.find((d) => d.date === '2026-08-01')!.pendingCount).toBe(1);
  });

  it('a transfer-only day carries the counts that explain its zero', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [
        row({ date: '2026-08-02', amountCents: -500_000, isTransfer: true }),
        row({ date: '2026-08-02', amountCents: -3_000, excludeFromTotals: true }),
      ],
      ...BOUNDS,
    });
    const d = m.days[0];
    expect(d.inCents).toBe(0);
    expect(d.outCents).toBe(0);
    expect(d.netCents).toBe(0);
    expect(d.count).toBe(2);
    expect(d.transferCount).toBe(1);
    expect(d.excludedCount).toBe(1);
  });
});

describe('K.1 wiring critic F-3 — the trailing edge of the current month is named', () => {
  it('newest row older than today on the CURRENT month → edge note with the bound', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [row({ date: '2026-08-01', amountCents: -700 })],
      oldestPostedDate: isoDate('2025-01-05'),
      newestPostedDate: isoDate('2026-08-01'),
    });
    expect(m.edgeNote).toContain(formatISODate(isoDate('2026-08-01')));
  });

  it('no edge note when the newest row IS today, on a past month, or on an empty window', () => {
    const current = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [row({ date: '2026-08-04', amountCents: -700 })],
      oldestPostedDate: isoDate('2025-01-05'),
      newestPostedDate: isoDate('2026-08-04'),
    });
    expect(current.edgeNote).toBeNull();
    const past = buildPostedCalendarMonth({
      month: '2026-07',
      today: TODAY,
      rows: [row({ date: '2026-07-01', amountCents: -700 })],
      ...BOUNDS,
    });
    expect(past.edgeNote).toBeNull();
    const empty = buildPostedCalendarMonth({ month: '2026-08', today: TODAY, rows: [], ...BOUNDS });
    expect(empty.edgeNote).toBeNull();
  });
});

describe('K.1 — the fact/projection boundary is this module’s contract', () => {
  it('a row dated after today belongs to no posted day, even inside the month', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [row({ date: '2026-08-10', amountCents: -9_900 })], // forward-dated pending charge
      ...BOUNDS,
    });
    expect(m.days).toEqual([]);
    expect(m.rowCount).toBe(0);
  });

  it('a wholly-future month has no posted half: postedThrough null, no empty reason', () => {
    const m = buildPostedCalendarMonth({ month: '2026-09', today: TODAY, rows: [], ...BOUNDS });
    expect(m.postedThrough).toBeNull();
    expect(m.emptyReason).toBeNull();
    expect(m.days).toEqual([]);
  });

  it('a wholly-past month is covered to its own last day', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-07',
      today: TODAY,
      rows: [row({ date: '2026-07-31', amountCents: -100 })],
      ...BOUNDS,
    });
    expect(m.postedThrough).toBe('2026-07-31');
    expect(m.days.map((d) => d.date)).toEqual(['2026-07-31']);
  });
});

describe('K.1 — WHICH zero (K.3’s rule reused, bounds inside the reason)', () => {
  it('no rows anywhere → no-history', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [],
      oldestPostedDate: null,
      newestPostedDate: null,
    });
    expect(m.emptyReason).toEqual({ kind: 'no-history' });
  });

  it('a month wholly before the oldest row → before-history, carrying the floor date', () => {
    const m = buildPostedCalendarMonth({ month: '2024-06', today: TODAY, rows: [], ...BOUNDS });
    expect(m.emptyReason).toEqual({ kind: 'before-history', historyStartsAt: '2025-01-05' });
  });

  it('a past month wholly after the newest row → after-history (a stopped feed, not "nothing happened")', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-07',
      today: TODAY,
      rows: [],
      oldestPostedDate: isoDate('2025-01-05'),
      newestPostedDate: isoDate('2026-06-15'),
    });
    expect(m.emptyReason).toEqual({ kind: 'after-history', historyEndsAt: '2026-06-15' });
  });

  it('the current month is NOT after-history while it contains the newest row’s month or earlier days', () => {
    // Newest row 2026-08-03, viewing 2026-08: the window starts before the newest row.
    const m = buildPostedCalendarMonth({ month: '2026-08', today: TODAY, rows: [], ...BOUNDS });
    expect(m.emptyReason).toEqual({ kind: 'quiet' });
  });

  it('an in-history month with genuinely nothing → quiet', () => {
    const m = buildPostedCalendarMonth({ month: '2025-11', today: TODAY, rows: [], ...BOUNDS });
    expect(m.emptyReason).toEqual({ kind: 'quiet' });
  });

  it('every zero sentence names its bound; only after-history points at connections', () => {
    const before = postedZeroCopy({ kind: 'before-history', historyStartsAt: isoDate('2026-04-24') });
    expect(before.sentence).toContain(formatISODate(isoDate('2026-04-24')));
    expect(before.showAccountsLink).toBe(false);
    const after = postedZeroCopy({ kind: 'after-history', historyEndsAt: isoDate('2026-06-15') });
    expect(after.sentence).toContain(formatISODate(isoDate('2026-06-15')));
    expect(after.showAccountsLink).toBe(true);
    expect(postedZeroCopy({ kind: 'no-history' }).showAccountsLink).toBe(false);
    expect(postedZeroCopy({ kind: 'quiet' }).showAccountsLink).toBe(false);
  });
});

describe('K.1 — the floor is named where the gap is', () => {
  it('history starting mid-month puts the floor note on that month', () => {
    const m = buildPostedCalendarMonth({
      month: '2026-04',
      today: TODAY,
      rows: [row({ date: '2026-04-24', amountCents: -700 })],
      oldestPostedDate: isoDate('2026-04-24'),
      newestPostedDate: isoDate('2026-08-03'),
    });
    expect(m.floorNote).toContain(formatISODate(isoDate('2026-04-24')));
  });

  it('no floor note when history predates the month, and none on an empty window (the reason covers it)', () => {
    const covered = buildPostedCalendarMonth({
      month: '2026-08',
      today: TODAY,
      rows: [row({ date: '2026-08-01', amountCents: -700 })],
      ...BOUNDS,
    });
    expect(covered.floorNote).toBeNull();
    const empty = buildPostedCalendarMonth({ month: '2024-06', today: TODAY, rows: [], ...BOUNDS });
    expect(empty.floorNote).toBeNull();
  });
});

describe('K.1 — build.ts: scheduled expansions start strictly after today', () => {
  const HOLIDAYS = holidayTable(2025, 2027);
  const payroll = {
    accountId: 'a',
    description: 'Payroll',
    amountCents: 245_000,
    nextDate: '2026-07-03', // anchored in the past — the replay shape the owner reported
    cadence: 'BIWEEKLY' as const,
  };

  it('a wholly-past month paints NO scheduled events (the replay is gone; posted rows own that ground)', () => {
    const cal = buildCashFlowCalendar({
      month: '2026-07',
      scheduled: [payroll],
      cardObligations: [],
      loanObligations: [],
      today: TODAY,
      holidays: HOLIDAYS,
    });
    expect(cal.days.flatMap((d) => d.events)).toEqual([]);
  });

  it('in the current month, occurrences BEFORE today are dropped and later ones still paint', () => {
    // Biweekly from 07-03: 07-17, 07-31, 08-14, 08-28. Today 08-04 → August paints 14th + 28th only.
    const cal = buildCashFlowCalendar({
      month: '2026-08',
      scheduled: [payroll],
      cardObligations: [],
      loanObligations: [],
      today: TODAY,
      holidays: HOLIDAYS,
    });
    const dates = cal.days.flatMap((d) => d.events).map((e) => e.date);
    expect(dates).toEqual(['2026-08-14', '2026-08-28']);
  });

  it('an occurrence landing exactly ON today PAINTS — the cash-needed window includes today (critic F-2)', () => {
    // The assembler expands scheduled flows with `>= today` and can recommend a transfer FOR
    // today; a bill expected today that has not yet posted must appear on its most actionable
    // day. Fail-old both ways: a clamp at today+1 fails THIS assertion; no clamp at all fails
    // the two above.
    const cal = buildCashFlowCalendar({
      month: '2026-08',
      scheduled: [{ ...payroll, nextDate: '2026-08-04', cadence: 'MONTHLY' as const }],
      cardObligations: [],
      loanObligations: [],
      today: TODAY,
      holidays: HOLIDAYS,
    });
    const dates = cal.days.flatMap((d) => d.events).map((e) => e.date);
    expect(dates).toContain('2026-08-04');
  });

  it('a current-cycle DUE in the past half still paints — an unpaid obligation is fact, not replay', () => {
    const cal = buildCashFlowCalendar({
      month: '2026-08',
      scheduled: [],
      cardObligations: [
        {
          cardId: 'card-1',
          cardName: 'Sapphire',
          dueDate: isoDate('2026-08-03'),
          effectiveDueDate: isoDate('2026-08-03'),
          cashRequiredCents: cents(60_000),
          autopayCents: cents(0),
          userActionCents: cents(60_000),
          remainingDueCents: cents(60_000),
          minimumDueCents: cents(3_500),
          isEstimated: false,
          notes: [],
          frozenSince: null,
          isManual: false,
        },
      ],
      loanObligations: [],
      today: TODAY,
      holidays: HOLIDAYS,
    });
    const dues = cal.days.flatMap((d) => d.events).filter((e) => e.kind === 'card-due');
    expect(dues.map((e) => e.date)).toContain('2026-08-03');
  });
});
