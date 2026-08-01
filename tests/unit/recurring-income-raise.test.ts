/**
 * REC-2 regression — a recurring INCOME series whose amount rises is a PAY RAISE,
 * not a price increase. It must NOT appear in the red "prices rose" warning bucket
 * (`summary.priceIncreases`) nor as a savings `price-increase` opportunity, while a
 * rising EXPENSE subscription still must. Driven end-to-end through `detectRecurring`
 * so the income / price-change classification is the real engine's, not hand-mocked.
 *
 * Note: the demo seed has FLAT payroll (no raise), so this latent bug never surfaced
 * on the seed — it bites a real user who got a raise. Hence a synthetic fixture.
 */
import { describe, expect, it } from 'vitest';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { summarizeRecurring, priceChangeBadge } from '@/lib/engine/recurring/summary';
import { findOpportunities } from '@/lib/engine/fi/insights';
import { isoDate } from '@/lib/dates';

// Biweekly payroll that rose from $2,000.00 → $2,200.00 (two contiguous plateaus).
const incomeRaise: RecurringTxn[] = [
  { id: 'i1', accountId: 'acct', date: '2026-01-02', amountCents: 200000, rawDescriptor: 'ACH DEPOSIT INITECH PAYROLL', isTransfer: false },
  { id: 'i2', accountId: 'acct', date: '2026-01-16', amountCents: 200000, rawDescriptor: 'ACH DEPOSIT INITECH PAYROLL', isTransfer: false },
  { id: 'i3', accountId: 'acct', date: '2026-01-30', amountCents: 220000, rawDescriptor: 'ACH DEPOSIT INITECH PAYROLL', isTransfer: false },
  { id: 'i4', accountId: 'acct', date: '2026-02-13', amountCents: 220000, rawDescriptor: 'ACH DEPOSIT INITECH PAYROLL', isTransfer: false },
];

// A monthly streaming subscription whose price rose $15.49 → $17.99.
const expenseRaise: RecurringTxn[] = [
  { id: 'e1', accountId: 'acct', date: '2025-11-15', amountCents: -1549, rawDescriptor: 'NETFLIX.COM', isTransfer: false },
  { id: 'e2', accountId: 'acct', date: '2025-12-15', amountCents: -1549, rawDescriptor: 'NETFLIX.COM', isTransfer: false },
  { id: 'e3', accountId: 'acct', date: '2026-01-15', amountCents: -1799, rawDescriptor: 'NETFLIX.COM', isTransfer: false },
  { id: 'e4', accountId: 'acct', date: '2026-02-15', amountCents: -1799, rawDescriptor: 'NETFLIX.COM', isTransfer: false },
];

const today = '2026-02-20';
const series = detectRecurring([...incomeRaise, ...expenseRaise], isoDate(today), NO_RECURRING_OVERRIDES);
const incomeSeries = series.find((s) => s.isIncome);
const expenseSeries = series.find((s) => !s.isIncome);

describe('REC-2: income raises are not price increases', () => {
  it('detects both series, each with its plateau change recorded', () => {
    // Proves the fixture is sound: the income series DOES carry a recorded price
    // change, so its exclusion below is a real filter — not merely "no change found".
    expect(incomeSeries, 'income series detected').toBeTruthy();
    expect(expenseSeries, 'expense series detected').toBeTruthy();
    expect(incomeSeries!.previousAmountCents).toBe(200000);
    expect(incomeSeries!.lastAmountCents).toBe(220000);
    expect(expenseSeries!.previousAmountCents).toBe(-1549);
    expect(expenseSeries!.lastAmountCents).toBe(-1799);
  });

  it('summary.priceIncreases includes the rising expense but NOT the pay raise', () => {
    const summary = summarizeRecurring(series, today);
    // invariant: nothing in the warning bucket is income
    expect(summary.priceIncreases.every((p) => !p.isIncome)).toBe(true);
    // the rising expense is still flagged
    expect(summary.priceIncreases.some((p) => p.lastAmountCents === -1799)).toBe(true);
    // the pay raise is absent from the warning but present (correctly) as income
    expect(summary.priceIncreases.some((p) => p.merchantCanonical === incomeSeries!.merchantCanonical)).toBe(false);
    expect(summary.income.some((i) => i.previousAmountCents === 200000)).toBe(true);
  });

  it('findOpportunities flags the expense price increase but not the pay raise', () => {
    const priceIncreaseOpps = findOpportunities(series, 700, 250).filter((o) => o.kind === 'price-increase');
    // exactly one — the expense; the income raise contributes none
    expect(priceIncreaseOpps.map((o) => o.merchant)).toEqual([expenseSeries!.merchantCanonical]);
    expect(priceIncreaseOpps.map((o) => o.merchant)).not.toContain(incomeSeries!.merchantCanonical);
  });
});

describe('REC-2: priceChangeBadge tone (the per-row UI logic, extracted pure + locked)', () => {
  it('a rising paycheck is favorable (emerald ↑); a rising bill is adverse (rose ↑)', () => {
    expect(priceChangeBadge({ isIncome: true, lastAmountCents: 220000, previousAmountCents: 200000 })).toEqual({
      increased: true,
      tone: 'favorable',
      previousMagnitudeCents: 200000,
    });
    expect(priceChangeBadge({ isIncome: false, lastAmountCents: -1799, previousAmountCents: -1549 })).toEqual({
      increased: true,
      tone: 'adverse',
      previousMagnitudeCents: 1549,
    });
  });

  it('a falling paycheck is adverse (↓); a falling bill is favorable (↓)', () => {
    expect(priceChangeBadge({ isIncome: true, lastAmountCents: 180000, previousAmountCents: 200000 })).toMatchObject({
      increased: false,
      tone: 'adverse',
    });
    expect(priceChangeBadge({ isIncome: false, lastAmountCents: -1299, previousAmountCents: -1549 })).toMatchObject({
      increased: false,
      tone: 'favorable',
    });
  });

  it('no recorded change (null prev) or an equal magnitude yields no badge', () => {
    expect(priceChangeBadge({ isIncome: false, lastAmountCents: -1549, previousAmountCents: null })).toBeNull();
    expect(priceChangeBadge({ isIncome: true, lastAmountCents: 200000, previousAmountCents: 200000 })).toBeNull();
  });

  it('agrees with the real detected series: income raise → favorable, expense raise → adverse', () => {
    expect(priceChangeBadge(incomeSeries!)!.tone).toBe('favorable');
    expect(priceChangeBadge(expenseSeries!)!.tone).toBe('adverse');
  });
});
