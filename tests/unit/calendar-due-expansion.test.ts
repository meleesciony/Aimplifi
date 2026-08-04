/**
 * TASKS C.8 / CALC_AUDIT P0-3 — the calendar places each card and loan due in EVERY month,
 * exactly once, not once ever.
 *
 * Pre-C.8 the grid window-gated the ONE obligation the engines emit per card/loan ("the next
 * payment on/after today"), so every month but the due month printed "0 payments due" under a
 * footnote promising each due day is badged. The fix synthesizes future cycles inside
 * `buildCashFlowCalendar` by the SAME rule the radar's `projectCardDues` was already adjudicated
 * on: step from the RAW due date monthly, re-adjust each occurrence to the prior business day,
 * price cards at the statement basis, always label them estimated. Loans repeat their fixed
 * issuer-reported payment, never estimated — exactly as /forecast already expands them.
 *
 * These tests lock the new behaviour AND the fail-old directions: reverting the synthesis must
 * make the future-month assertions fail, and reverting the current-cycle branch must make the
 * current-month assertions fail.
 */
import { describe, expect, it } from 'vitest';
import { buildCashFlowCalendar, type CalendarEvent } from '@/lib/engine/calendar/build';
import type { ProjectableObligation } from '@/lib/engine/radar/radar';
import type { LoanObligation } from '@/lib/engine/loans/obligations';
import { holidayTable, isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

const TODAY = isoDate('2026-08-04'); // a Tuesday
const HOLIDAYS = holidayTable(2025, 2027);

function card(over: Partial<ProjectableObligation> = {}): ProjectableObligation {
  return {
    cardId: 'card-1',
    cardName: 'Sapphire',
    dueDate: isoDate('2026-08-20'), // Thursday
    effectiveDueDate: isoDate('2026-08-20'),
    cashRequiredCents: cents(60_000),
    autopayCents: cents(0),
    userActionCents: cents(60_000),
    remainingDueCents: cents(60_000),
    minimumDueCents: cents(3_500),
    isEstimated: false,
    notes: [],
    frozenSince: null,
    isManual: false,
    ...over,
  };
}

function loan(over: Partial<LoanObligation> = {}): LoanObligation {
  return {
    accountId: 'mortgage-1',
    accountName: 'Mortgage 1192',
    accountType: 'MORTGAGE',
    dueDate: isoDate('2026-08-15'), // a Saturday
    effectiveDueDate: isoDate('2026-08-14'), // Fri (weekend roll-back)
    paymentCents: cents(621_707),
    isEstimated: false,
    frozenSince: null,
    ...over,
  };
}

function build(month: string, params: { cards?: ProjectableObligation[]; loans?: LoanObligation[] }) {
  return buildCashFlowCalendar({
    month,
    scheduled: [],
    cardObligations: params.cards ?? [],
    loanObligations: params.loans ?? [],
    today: TODAY,
    holidays: HOLIDAYS,
  });
}

const duesOn = (cal: ReturnType<typeof build>, date: string): CalendarEvent[] =>
  cal.days.find((d) => d.date === date)!.events;

describe('C.8 — the due month itself is unchanged (current-cycle events, exactly as before)', () => {
  it('paints the card on its effective date at the REQUIRED amount, not estimated', () => {
    const cal = build('2026-08', { cards: [card()] });
    const events = duesOn(cal, '2026-08-20');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'card-due',
      label: 'Sapphire due',
      amountCents: -60_000,
      isEstimated: false,
      accountId: 'card-1',
    });
  });

  it('paints the loan on its effective date at the fixed payment, not estimated', () => {
    const cal = build('2026-08', { loans: [loan()] });
    expect(duesOn(cal, '2026-08-14')).toEqual([
      expect.objectContaining({ kind: 'loan-due', label: 'Mortgage 1192 due', amountCents: -621_707 }),
    ]);
    // The weekend RAW date carries nothing.
    expect(duesOn(cal, '2026-08-15')).toHaveLength(0);
  });
});

describe('C.8 — the audit scenario: a later month is no longer "0 payments due"', () => {
  it('September paints the card due once, estimated, at the STATEMENT basis', () => {
    const cal = build('2026-09', { cards: [card({ cycleBasisCents: cents(100_000) })] });
    // Raw 2026-09-20 is a SUNDAY → rolls back to Friday the 18th per occurrence.
    const events = duesOn(cal, '2026-09-18');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'card-due',
      date: '2026-09-18',
      label: 'Sapphire due (est.)',
      amountCents: -100_000, // the basis, NOT the post-mid-cycle-payment residual
      isEstimated: true,
      accountId: 'card-1',
    });
    expect(duesOn(cal, '2026-09-20')).toHaveLength(0);
    // The summary the owner read as "0 payments due across 0 dates" now counts it.
    expect(cal.reminderDates).toEqual(['2026-09-18']);
    expect(cal.totalOutCents).toBe(100_000);
  });

  it('September paints the loan due once, at the fixed payment, NEVER labeled estimated', () => {
    const cal = build('2026-09', { loans: [loan()] });
    const events = duesOn(cal, '2026-09-15'); // a Tuesday — no roll-back needed
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'loan-due',
      label: 'Mortgage 1192 due', // no "(est.)": the amount is the issuer-reported contract payment
      amountCents: -621_707,
      accountId: 'mortgage-1',
    });
    expect(events[0].isEstimated ?? false).toBe(false);
  });

  it('three clicks out (December) still paints the loan, exactly once', () => {
    const cal = build('2026-12', { loans: [loan()] });
    const all = cal.days.flatMap((d) => d.events);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ date: '2026-12-15', amountCents: -621_707 });
  });

  it('falls back to the required amount when no statement basis exists (estimate-path cards)', () => {
    const cal = build('2026-09', { cards: [card({ cashRequiredCents: cents(45_000) })] });
    expect(duesOn(cal, '2026-09-18')[0].amountCents).toBe(-45_000);
  });
});

describe('C.8 — exactly once per month, and no month double-paints a cycle', () => {
  it('each of the next four months carries exactly one card-due event for the card', () => {
    for (const [month, date] of [
      ['2026-09', '2026-09-18'],
      ['2026-10', '2026-10-20'],
      ['2026-11', '2026-11-20'],
      ['2026-12', '2026-12-18'], // raw 12-20 is a Sunday → prior business day Fri 12-18
    ] as const) {
      const cal = build(month, { cards: [card({ cycleBasisCents: cents(100_000) })] });
      const dues = cal.days.flatMap((d) => d.events).filter((e) => e.kind === 'card-due');
      expect(dues, `month ${month}`).toHaveLength(1);
      expect(dues[0].date, `month ${month}`).toBe(date);
    }
  });

  it('an OVERDUE card whose cycle lands mid-month paints current + next cycle in one month — two events, never three', () => {
    // Due 07-31 (long passed): the engine clamps the current effective date to today (08-04), and
    // the NEXT cycle's raw date 08-31 also falls in August. Both are real demands in one month.
    const cal = build('2026-08', {
      cards: [
        card({
          dueDate: isoDate('2026-07-31'),
          effectiveDueDate: isoDate('2026-08-04'),
          cashRequiredCents: cents(60_000),
          cycleBasisCents: cents(100_000),
        }),
      ],
    });
    const dues = cal.days.flatMap((d) => d.events).filter((e) => e.kind === 'card-due');
    expect(dues.map((e) => [e.date, e.amountCents, e.isEstimated])).toEqual([
      ['2026-08-04', -60_000, false], // the overdue statement, real
      ['2026-08-31', -100_000, true], // next cycle, estimated
    ]);
  });

  it('a stale anchor skips synthesized occurrences that land on or before today', () => {
    // Due 07-01, today 08-04: k=1 steps to 08-01, which is ALREADY PAST — emitting it would badge
    // a date the reader cannot act on. k=2 (09-01) is the first paintable occurrence.
    const cal = build('2026-08', {
      cards: [card({ dueDate: isoDate('2026-07-01'), effectiveDueDate: isoDate('2026-08-04') })],
    });
    const augustDues = cal.days.flatMap((d) => d.events).filter((e) => e.kind === 'card-due');
    expect(augustDues.map((e) => e.date)).toEqual(['2026-08-04']); // the current-cycle clamp only
    const sept = build('2026-09', {
      cards: [card({ dueDate: isoDate('2026-07-01'), effectiveDueDate: isoDate('2026-08-04') })],
    });
    expect(sept.days.flatMap((d) => d.events).map((e) => e.date)).toEqual(['2026-09-01']);
  });
});

describe('C.8 — the fences that keep an absence honest', () => {
  it('a card with nothing due (zero required, no basis) paints no future cycles', () => {
    const cal = build('2026-09', {
      cards: [card({ cashRequiredCents: cents(0), userActionCents: cents(0) })],
    });
    expect(cal.days.flatMap((d) => d.events)).toHaveLength(0);
  });

  it('a credit-balance basis (negative) is not a recurring debit', () => {
    const cal = build('2026-09', {
      cards: [card({ cashRequiredCents: cents(0), cycleBasisCents: cents(-2_500) })],
    });
    expect(cal.days.flatMap((d) => d.events)).toHaveLength(0);
  });

  it('a month BEFORE the due month paints nothing (no backfill of history we never held)', () => {
    const calCards = build('2026-07', { cards: [card()] });
    const calLoans = build('2026-07', { loans: [loan()] });
    expect(calCards.days.flatMap((d) => d.events)).toHaveLength(0);
    expect(calLoans.days.flatMap((d) => d.events)).toHaveLength(0);
  });

  it('a far-future month is bounded — the loop terminates and paints exactly one occurrence', () => {
    const cal = build('2028-08', { loans: [loan()] });
    const dues = cal.days.flatMap((d) => d.events);
    expect(dues).toHaveLength(1);
    // 2028-08-15 is a Tuesday; no roll-back.
    expect(dues[0].date).toBe('2028-08-15');
  });
});

describe('C.8 critic F-1 — each due event carries WHERE ITS AMOUNT COMES FROM', () => {
  it('a statement card: current cycle is "statement", later months are "repeated-statement"', () => {
    const june = build('2026-08', { cards: [card({ cycleBasisCents: cents(100_000) })] });
    const current = june.days.flatMap((d) => d.events).find((e) => e.kind === 'card-due')!;
    expect(current.amountSource).toBe('statement');
    expect(current.isEstimated).toBe(false);

    const sept = build('2026-09', { cards: [card({ cycleBasisCents: cents(100_000) })] });
    const later = sept.days.flatMap((d) => d.events).find((e) => e.kind === 'card-due')!;
    expect(later.amountSource).toBe('repeated-statement');
    expect(later.isEstimated).toBe(true);
  });

  it('an estimate-path card (no statement): both current and later months are "balance"', () => {
    // No cycleBasisCents and an estimated obligation → the amount is balance-derived everywhere.
    const estCard = card({ isEstimated: true }); // cashRequired 60_000, no basis
    const current = build('2026-08', { cards: [estCard] })
      .days.flatMap((d) => d.events)
      .find((e) => e.kind === 'card-due')!;
    expect(current.amountSource).toBe('balance');
    expect(current.isEstimated).toBe(true);

    const later = build('2026-09', { cards: [estCard] })
      .days.flatMap((d) => d.events)
      .find((e) => e.kind === 'card-due')!;
    expect(later.amountSource).toBe('balance');
  });

  it('a loan is always "loan-terms", current or later, and never estimated', () => {
    const current = build('2026-08', { loans: [loan()] })
      .days.flatMap((d) => d.events)
      .find((e) => e.kind === 'loan-due')!;
    expect(current.amountSource).toBe('loan-terms');

    const later = build('2026-12', { loans: [loan()] })
      .days.flatMap((d) => d.events)
      .find((e) => e.kind === 'loan-due')!;
    expect(later.amountSource).toBe('loan-terms');
    expect(later.isEstimated ?? false).toBe(false);
  });
});

describe('C.8 — scheduled rows and dues coexist without touching each other', () => {
  it('the synthesis never alters expandScheduled output, and both net into the day', () => {
    const cal = buildCashFlowCalendar({
      month: '2026-09',
      scheduled: [
        { accountId: 'a', description: 'Payroll', amountCents: 245_000, nextDate: '2026-09-11', cadence: 'BIWEEKLY' },
      ],
      cardObligations: [card({ cycleBasisCents: cents(100_000) })],
      today: TODAY,
      holidays: HOLIDAYS,
    });
    const d11 = duesOn(cal, '2026-09-11');
    expect(d11.some((e) => e.kind === 'inflow' && e.amountCents === 245_000)).toBe(true);
    const d18 = duesOn(cal, '2026-09-18');
    expect(d18.some((e) => e.kind === 'card-due' && e.amountCents === -100_000)).toBe(true);
    expect(cal.totalOutCents).toBe(100_000);
  });
});
