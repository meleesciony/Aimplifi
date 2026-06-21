/**
 * Manual card statements (extends DECISIONS #45). Two layers of proof:
 *  1. parseManualStatement — known-answer validation/parse table.
 *  2. END-TO-END through the real Cash-Needed Engine: a manual card WITH a parsed
 *     statement produces a PRECISE (non-estimated) obligation with exact cash +
 *     due date; the SAME card WITHOUT a statement (and no cycle days, as a freshly
 *     added manual card) is DROPPED from the answer. This is the feature's contract
 *     — asserted, not eyeballed.
 *
 * Hand-verified: 2026-07-10 is a Friday (epoch-day 20644; (20644+4)%7 = 5) and not
 * a US federal holiday, so its effective (business-day-adjusted) due date is itself.
 */
import { describe, expect, it } from 'vitest';
import { parseManualStatement } from '@/lib/engine/cards/manual-statement';
import {
  type AssembleParams,
  assembleCashNeededInput,
} from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { holidayTable, isoDate } from '@/lib/dates';

describe('parseManualStatement', () => {
  it('parses a full valid statement (balance, min, dates, APR, autopay) with derived fields', () => {
    const r = parseManualStatement({
      statementBalance: '1200.00',
      minimumPayment: '35',
      cycleEnd: '2026-06-15',
      dueDate: '2026-07-10',
      apr: '24.99',
      autopayMode: 'STATEMENT_BALANCE',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statement).toEqual({
      statementBalanceCents: 120000,
      minimumPaymentCents: 3500,
      cycleStart: '2026-05-15', // derived: one month before close
      cycleEnd: '2026-06-15',
      dueDate: '2026-07-10',
      aprBps: 2499, // 24.99% → 2499 bps
      cycleCloseDayOfMonth: 15,
      dueDayOfMonth: 10,
      autopay: { mode: 'STATEMENT_BALANCE', fixedAmountCents: null },
    });
  });

  it('treats a blank APR and absent autopay as no-APR / no-autopay', () => {
    const r = parseManualStatement({
      statementBalance: '500',
      minimumPayment: '0',
      cycleEnd: '2026-01-31',
      dueDate: '2026-02-25',
      apr: '',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statement.aprBps).toBeNull();
    expect(r.statement.autopay).toBeNull();
    expect(r.statement.cycleStart).toBe('2025-12-31'); // addMonthsClamped(-1)
  });

  it('parses a FIXED_AMOUNT autopay with its amount', () => {
    const r = parseManualStatement({
      statementBalance: '900',
      minimumPayment: '40',
      cycleEnd: '2026-03-20',
      dueDate: '2026-04-15',
      autopayMode: 'FIXED_AMOUNT',
      autopayFixedAmount: '100',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statement.autopay).toEqual({ mode: 'FIXED_AMOUNT', fixedAmountCents: 10000 });
  });

  it('rejects a minimum greater than the balance', () => {
    const r = parseManualStatement({
      statementBalance: '100',
      minimumPayment: '200',
      cycleEnd: '2026-06-15',
      dueDate: '2026-07-10',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /exceed the statement balance/i.test(e))).toBe(true);
  });

  it('rejects a due date on/before the closing date', () => {
    const r = parseManualStatement({
      statementBalance: '100',
      minimumPayment: '10',
      cycleEnd: '2026-07-10',
      dueDate: '2026-07-10',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /after the statement closing date/i.test(e))).toBe(true);
  });

  it('requires a fixed amount when autopay is FIXED_AMOUNT', () => {
    const r = parseManualStatement({
      statementBalance: '100',
      minimumPayment: '10',
      cycleEnd: '2026-06-15',
      dueDate: '2026-07-10',
      autopayMode: 'FIXED_AMOUNT',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /fixed autopay amount/i.test(e))).toBe(true);
  });

  it('reports all problems at once (junk balance, bad dates, bad APR, bad autopay)', () => {
    const r = parseManualStatement({
      statementBalance: 'x',
      minimumPayment: 'y',
      cycleEnd: 'not-a-date',
      dueDate: '2026-13-40',
      apr: 'abc',
      autopayMode: 'WHATEVER',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThanOrEqual(5);
  });
});

describe('manual card statement drives the precise Cash-Needed path (end-to-end)', () => {
  const base = (statements: AssembleParams['statements'], cardCycleDays: boolean): AssembleParams => ({
    today: isoDate('2026-06-21'),
    scenario: 'PAY_IN_FULL',
    paymentAccountId: 'chk',
    accounts: [
      { id: 'chk', name: 'Joint Checking', type: 'CHECKING', currentBalanceCents: 340000, aprBps: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
      {
        id: 'cc',
        name: 'Chase Freedom',
        type: 'CREDIT',
        currentBalanceCents: 150000,
        aprBps: cardCycleDays ? 2499 : null,
        dueDayOfMonth: cardCycleDays ? 10 : null,
        cycleCloseDayOfMonth: cardCycleDays ? 15 : null,
      },
    ],
    autopays: [],
    statements,
    cardPayments: [],
    transactions: [],
    scheduled: [],
    holidayTable: holidayTable(2025, 2027),
  });

  it('a manual card WITH a parsed statement appears as a precise obligation', () => {
    const parsed = parseManualStatement({
      statementBalance: '1200',
      minimumPayment: '35',
      cycleEnd: '2026-06-15',
      dueDate: '2026-07-10',
      apr: '24.99',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = parsed.statement;

    const input = assembleCashNeededInput(
      base(
        [
          {
            id: 'st1',
            accountId: 'cc',
            cycleEnd: s.cycleEnd,
            dueDate: s.dueDate,
            statementBalanceCents: s.statementBalanceCents,
            minimumPaymentCents: s.minimumPaymentCents,
          },
        ],
        true,
      ),
    );
    const res = computeCashNeeded(input);

    expect(res.headline.requiredCents).toBe(120000);
    expect(res.headline.byDate).toBe('2026-07-10'); // Friday → no walk-back
    expect(res.headline.cardsDueCount).toBe(1);

    const ob = res.cards.find((c) => c.cardId === 'cc');
    expect(ob).toBeDefined();
    expect(ob!.isEstimated).toBe(false); // PRECISE path, not the estimate
    expect(ob!.cashRequiredCents).toBe(120000);
    expect(ob!.remainingDueCents).toBe(120000);
    expect(ob!.minimumDueCents).toBe(3500);
    expect(ob!.dueDate).toBe('2026-07-10');
    expect(ob!.effectiveDueDate).toBe('2026-07-10');
  });

  it('the MINIMUM scenario shows real carried interest for the manual card', () => {
    const input = assembleCashNeededInput(
      base(
        [
          {
            id: 'st1',
            accountId: 'cc',
            cycleEnd: '2026-06-15',
            dueDate: '2026-07-10',
            statementBalanceCents: 120000,
            minimumPaymentCents: 3500,
          },
        ],
        true,
      ),
    );
    const res = computeCashNeeded({ ...input, scenario: 'MINIMUM' });
    // Carrying $1,165 at 24.99% APR over the next cycle accrues real interest.
    expect(res.minimumPathInterestCents).not.toBeNull();
    expect(res.minimumPathInterestCents!).toBeGreaterThan(0);
  });

  it('the SAME card WITHOUT a statement (no cycle days) is dropped from the answer', () => {
    const input = assembleCashNeededInput(base([], false));
    const res = computeCashNeeded(input);
    expect(res.cards.length).toBe(0); // not even an estimate — nothing knowable
    expect(res.headline.requiredCents).toBe(0);
    expect(res.headline.cardsDueCount).toBe(0);
    expect(res.headline.byDate).toBeNull();
  });
});
