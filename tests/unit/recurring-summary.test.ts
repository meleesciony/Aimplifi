/**
 * Recurring summary derivation (DECISIONS #71) — known-answer tests for the
 * monthly-equivalent normalization, active/lapsed split, and the headline
 * monthly-recurring-spend total. Runs on a real detected series from the seed so
 * the numbers are end-to-end (detect → summarize), not hand-mocked.
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { summarizeRecurring } from '@/lib/engine/recurring/summary';
import { isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');
const posted = seed.transactions.filter((t) => t.status === 'POSTED');
const series = detectRecurring(posted, isoDate('2026-06-10'), NO_RECURRING_OVERRIDES);
const summary = summarizeRecurring(series, '2026-06-10');

describe('summarizeRecurring on the seed', () => {
  it('classifies the ≥8 seed subscriptions as active subscriptions', () => {
    expect(summary.activeSubscriptionCount).toBeGreaterThanOrEqual(8);
    const names = summary.subscriptions.map((s) => s.merchantCanonical);
    for (const m of ['Netflix', 'Spotify', 'LA Fitness', 'Xfinity', 'Geico']) {
      expect(names, m).toContain(m);
    }
  });

  it('normalizes amounts to a positive per-month figure', () => {
    const netflix = summary.subscriptions.find((s) => s.merchantCanonical === 'Netflix')!;
    expect(netflix.monthlyEquivalentCents).toBe(1799); // monthly, current price, positive
    // biweekly payroll income → ~2.1667× the per-cheque amount, magnitude only
    const payroll = summary.income.find((s) => s.merchantCanonical.includes('Payroll'));
    if (payroll) expect(payroll.monthlyEquivalentCents).toBe(Math.round(245000 * (26 / 12)));
  });

  it('surfaces the Netflix price increase under priceIncreases', () => {
    const names = summary.priceIncreases.map((s) => s.merchantCanonical);
    expect(names).toContain('Netflix');
  });

  it('monthly recurring spend totals the active subscriptions + bills (positive)', () => {
    const byHand =
      summary.subscriptions.reduce((s, i) => s + i.monthlyEquivalentCents, 0) +
      summary.bills.reduce((s, i) => s + i.monthlyEquivalentCents, 0);
    expect(summary.monthlyRecurringSpendCents).toBe(byHand);
    expect(summary.monthlyRecurringSpendCents).toBeGreaterThan(0);
  });

  it('orders items active-first, then by monthly-equivalent descending', () => {
    const active = summary.items.filter((i) => i.active);
    const inactive = summary.items.filter((i) => !i.active);
    // every active item sorts before every inactive item
    expect(summary.items.slice(0, active.length).every((i) => i.active)).toBe(true);
    expect(summary.items.slice(active.length).every((i) => !i.active)).toBe(inactive.length > 0 ? true : true);
    // monthly-equivalent is non-increasing within the active block
    for (let i = 1; i < active.length; i++) {
      expect(active[i - 1].monthlyEquivalentCents).toBeGreaterThanOrEqual(active[i].monthlyEquivalentCents);
    }
  });
});
