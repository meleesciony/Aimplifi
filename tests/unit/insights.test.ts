/**
 * Phase 3 insights on REAL seed data: monthly savings rate (3 hand-verified
 * months), opportunity ranking, lifestyle creep, runway, life energy, and the
 * Money Review narrative.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import {
  detectLifestyleCreep,
  findOpportunities,
  hoursOfWork,
  monthlyFlows,
  monthsOfRunway,
} from '@/lib/engine/fi/insights';
import { generateMoneyReview } from '@/lib/engine/fi/coach-copy';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');
const flows = monthlyFlows(seed.transactions);
const series = detectRecurring(
  seed.transactions.filter((t) => t.status === 'POSTED'),
  isoDate('2026-06-10'),
);

describe('monthly savings rate from seed data (3 hand-verified months)', () => {
  // Hand math: payroll is the ONLY income (+$2,450 biweekly Fridays anchored
  // 2026-06-12). Months with exactly two paydays → income = $4,900.00:
  //   2026-01 (Fri 01-09, 01-23), 2026-03 (03-06, 03-20), 2026-04 (04-03, 04-17).
  // Transfers (savings, card payments, loan ACH) are excluded from both sides.
  it.each(['2026-01', '2026-03', '2026-04'])('%s: income is exactly $4,900.00', (month) => {
    const m = flows.find((f) => f.month === month)!;
    expect(m.incomeCents).toBe(490_000);
  });

  it('rate = (income − expenses)/income, cross-checked by independent re-aggregation', () => {
    for (const month of ['2026-01', '2026-03', '2026-04']) {
      const m = flows.find((f) => f.month === month)!;
      // independent aggregation path (no engine code)
      const txns = seed.transactions.filter(
        (t) => t.date.startsWith(month) && !t.isTransfer && t.status === 'POSTED',
      );
      const income = txns.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
      const expenses = txns.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
      expect(m.incomeCents).toBe(income);
      expect(m.expensesCents).toBe(expenses);
      expect(m.savingsRateBps).toBe(Math.round(((income - expenses) / income) * 10000));
    }
  });

  it('a $500 own-account transfer changes neither income nor expenses (EDGE_CASES §FI)', () => {
    const withTransfer = monthlyFlows([
      { date: '2026-03-02', amountCents: 600000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED' },
      { date: '2026-03-10', amountCents: -420000, rawDescriptor: 'RENT', accountId: 'a', isTransfer: false, status: 'POSTED' },
      { date: '2026-03-15', amountCents: -50000, rawDescriptor: 'TRANSFER TO SAVINGS', accountId: 'a', isTransfer: true, status: 'POSTED' },
    ]);
    expect(withTransfer[0].savingsRateBps).toBe(3000); // still exactly 30.00%
  });
});

describe('refund netting (ROADMAP #4): a return reduces spend, not inflates income', () => {
  it('$450 purchase + $100 return in shopping → $350 net spend, NOT counted as income', () => {
    // income 200000; expenses 45000 − 10000 = 35000; rate = (200000−35000)/200000 = 82.50%.
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 200000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'income' },
      { date: '2026-03-05', amountCents: -45000, rawDescriptor: 'AMZN', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
      { date: '2026-03-12', amountCents: 10000, rawDescriptor: 'AMZN REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.incomeCents).toBe(200000);
    expect(f.expensesCents).toBe(35000);
    expect(f.savingsRateBps).toBe(8250);
  });

  it('a positive in the income category still counts as income (not netted)', () => {
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 100000, rawDescriptor: 'PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'income' },
      { date: '2026-03-05', amountCents: -40000, rawDescriptor: 'KROGER', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'groceries' },
    ])[0];
    expect(f.incomeCents).toBe(100000);
    expect(f.expensesCents).toBe(40000);
  });

  it('a positive with no/unknown category stays income (ambiguous inflow not netted)', () => {
    const f = monthlyFlows([
      { date: '2026-03-01', amountCents: 50000, rawDescriptor: 'UNKNOWN DEPOSIT', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: null },
      { date: '2026-03-05', amountCents: -20000, rawDescriptor: 'STORE', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.incomeCents).toBe(50000);
    expect(f.expensesCents).toBe(20000);
  });

  it('refunds never drive a month’s spend below $0 (floored)', () => {
    const f = monthlyFlows([
      { date: '2026-03-05', amountCents: -5000, rawDescriptor: 'STORE', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
      { date: '2026-03-06', amountCents: 20000, rawDescriptor: 'BIG REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping' },
    ])[0];
    expect(f.expensesCents).toBe(0);
    expect(f.incomeCents).toBe(0);
  });
});

describe('savings opportunities ranked by compounded impact', () => {
  const opportunities = findOpportunities(series, 700);

  it('finds the unused gym, the Netflix increase, insurance re-shop, negotiable internet', () => {
    const kinds = opportunities.map((o) => o.kind);
    expect(kinds).toContain('unused-subscription');
    expect(kinds).toContain('price-increase');
    expect(kinds).toContain('insurance-reshop');
    expect(kinds).toContain('negotiable-bill');
  });

  it('ranks by 30-year future value, descending (gym $34.99 first)', () => {
    expect(opportunities[0].kind).toBe('unused-subscription');
    expect(opportunities[0].merchant).toBe('LA Fitness');
    expect(opportunities[0].monthlyCents).toBe(3499);
    const fvs = opportunities.map((o) => o.fv30Cents);
    expect([...fvs].sort((a, b) => b - a)).toEqual(fvs);
  });

  it('Netflix price increase contributes the $2.50 delta, not the full price', () => {
    const netflix = opportunities.find((o) => o.kind === 'price-increase')!;
    expect(netflix.merchant).toBe('Netflix');
    expect(netflix.monthlyCents).toBe(250);
  });

  it('estimates are labeled as estimates', () => {
    expect(opportunities.find((o) => o.kind === 'insurance-reshop')!.isEstimate).toBe(true);
    expect(opportunities.find((o) => o.kind === 'unused-subscription')!.isEstimate).toBe(false);
  });
});

describe('lifestyle-creep detector on the engineered seed rise', () => {
  it('flags the final-6-months discretionary rise against flat income', () => {
    const creep = detectLifestyleCreep(seed.transactions, isoDate('2026-06-10'));
    expect(creep.flagged).toBe(true);
    expect(creep.spendGrowthBps).toBeGreaterThan(creep.incomeGrowthBps + 500);
    expect(creep.monthlyDiscretionaryCents).toHaveLength(6);
  });
  it('does NOT flag a flat-spend household (fixture)', () => {
    const flat = Array.from({ length: 8 }, (_, k) => [
      { date: `2025-${String(k + 1).padStart(2, '0')}-05`, amountCents: 490000, rawDescriptor: 'ACH DEPOSIT ACME ANALYTICS PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED' as const },
      { date: `2025-${String(k + 1).padStart(2, '0')}-10`, amountCents: -30000, rawDescriptor: 'STARBUCKS 800-782-7282', accountId: 'a', isTransfer: false, status: 'POSTED' as const },
    ]).flat();
    const creep = detectLifestyleCreep(flat, isoDate('2025-09-01'));
    expect(creep.flagged).toBe(false);
  });
});

describe('room for error + life energy', () => {
  it('runway: $10,000 liquid / $2,500 avg monthly expenses = 4.0 months', () => {
    expect(monthsOfRunway(cents(1_000_000), cents(250_000))).toBe(4);
  });
  it('life energy: $190 at $38.00/hr after tax = 5 hours', () => {
    expect(hoursOfWork(cents(19_000), 3800)).toBe(5);
  });
  it('life energy rounds to tenths and ignores sign', () => {
    expect(hoursOfWork(cents(-5700), 3800)).toBe(1.5);
  });
});

describe('monthly Money Review narrative from seed data', () => {
  it('produces one improvement, one creep, one concrete next action', () => {
    const review = generateMoneyReview({
      flows,
      creep: detectLifestyleCreep(seed.transactions, isoDate('2026-06-10')),
      opportunities: findOpportunities(series, 700),
      runwayMonths: 3.2,
      pendingTransfer: { amountCents: cents(105_000), byDate: 'Tue, Jun 23' },
    });
    expect(review.improvement.length).toBeGreaterThan(10);
    expect(review.creep).toMatch(/Netflix|crept|discretionary/i);
    expect(review.nextAction).toContain('$1,050.00');
    expect(review.nextAction).toContain('Tue, Jun 23');
  });
});
