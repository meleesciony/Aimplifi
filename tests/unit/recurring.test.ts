/**
 * Phase 2 acceptance #6: recurring detection on the seed finds ≥8
 * subscriptions, the Netflix price increase, the possibly-unused gym, and
 * biweekly payroll — and detected payroll feeds ScheduledTransactions that
 * reproduce the Phase 1 cash-needed headline (wired back, tests re-run).
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { detectRecurring, toScheduledTransactions } from '@/lib/engine/recurring/detect';
import { assembleCashNeededInput } from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { holidayTable, isoDate } from '@/lib/dates';

const seed = buildSeedData('2026-06-10');
const posted = seed.transactions.filter((t) => t.status === 'POSTED');
const series = detectRecurring(posted, isoDate('2026-06-10'));

describe('recurring detection on seed data', () => {
  it('finds ≥8 subscriptions', () => {
    const subs = series.filter((s) => s.isSubscription);
    console.log('[subscriptions]', subs.map((s) => `${s.merchantCanonical} (${s.cadence})`).join(', '));
    expect(subs.length).toBeGreaterThanOrEqual(8);
  });

  it('finds the Netflix price increase ($15.49 → $17.99) with priceChangedAt', () => {
    const netflix = series.find((s) => s.merchantCanonical === 'Netflix')!;
    expect(netflix).toBeDefined();
    expect(netflix.previousAmountCents).toBe(-1549);
    expect(netflix.lastAmountCents).toBe(-1799);
    expect(netflix.priceChangedAt).toBe('2026-02-03');
  });

  it('flags the gym as possibly unused (a question, not an accusation)', () => {
    const gym = series.find((s) => s.merchantCanonical === 'LA Fitness')!;
    expect(gym.isSubscription).toBe(true);
    expect(gym.possiblyUnused).toBe(true);
    // and streaming is NOT flagged by the same heuristic
    expect(series.find((s) => s.merchantCanonical === 'Netflix')!.possiblyUnused).toBe(false);
  });

  it('detects biweekly payroll as an income cadence with the right next date', () => {
    const payroll = series.find((s) => s.merchantCanonical === 'Acme Analytics (Payroll)')!;
    expect(payroll.isIncome).toBe(true);
    expect(payroll.cadence).toBe('BIWEEKLY');
    expect(payroll.typicalAmountCents).toBe(245000);
    expect(payroll.lastSeenAt).toBe('2026-05-29');
    expect(payroll.nextExpectedAt).toBe('2026-06-12');
  });

  it('detects the rent and auto-loan obligations as recurring (not subscriptions)', () => {
    const rent = series.find((s) => s.merchantCanonical.includes('Peachtree'))!;
    expect(rent.cadence).toBe('MONTHLY');
    expect(rent.isSubscription).toBe(false);
    const loan = series.find((s) => s.merchantCanonical === 'CarMax Auto Finance')!;
    expect(loan.cadence).toBe('MONTHLY');
  });

  it('does NOT invent subscriptions out of variable discretionary spend', () => {
    for (const name of ['Kroger', 'Starbucks', 'Amazon', 'Target']) {
      expect(series.find((s) => s.merchantCanonical === name), name).toBeUndefined();
    }
  });
});

describe('wiring back into the Phase 1 engine (acceptance #6)', () => {
  it('DETECTED payroll (replacing the seeded payroll row) reproduces the golden headline exactly', () => {
    const detected = toScheduledTransactions(series, { paymentAccountId: 'acct-checking', cashAccountIds: new Set(['acct-checking']) }, isoDate('2026-06-10'));
    const detectedPayroll = detected.find((d) => d.source === 'payroll-detected')!;
    expect(detectedPayroll).toMatchObject({
      amountCents: 245000,
      nextDate: '2026-06-12',
      cadence: 'BIWEEKLY',
    });

    // Swap the seed-declared payroll row for the detected one; keep
    // user-confirmed rows (rent, savings, loan) as-is.
    const scheduled = [
      ...seed.scheduled.filter((s) => !s.description.includes('Payroll')),
      { ...detectedPayroll, id: 'sched-detected-payroll' },
    ];

    const input = assembleCashNeededInput({
      today: isoDate('2026-06-10'),
      scenario: 'PAY_IN_FULL',
      paymentAccountId: 'acct-checking',
      accounts: seed.accounts,
      autopays: seed.autopays,
      statements: seed.statements,
      cardPayments: seed.cardPayments,
      transactions: seed.transactions,
      scheduled,
      holidayTable: holidayTable(2024, 2027),
    });
    const result = computeCashNeeded(input);

    // Identical to docs/EDGE_CASES.md §Seed-headline
    expect(result.headline.requiredCents).toBe(541233);
    expect(result.headline.byDate).toBe('2026-06-26');
    expect(result.headline.shortfallCents).toBe(101233);
    expect(result.headline.recommendation).toEqual({ amountCents: 105000, byDate: '2026-06-23' });
  });
});

describe('refund robustness (STATUS #7 / ROADMAP #4): a refund+rebill keeps the series', () => {
  // A monthly $15.99 charge with a refund (same merchant) in month 2. The refund
  // is opposite-signed → a one-off, not part of the cadence; the 4 charges still
  // form the series. (Before the dominant-sign fix the +$15.99 made the amounts
  // non-plateaued and the whole subscription was dropped — STATUS #7.)
  it('excludes the refund and still detects the monthly series', () => {
    const txns = [
      { id: '1', accountId: 'a', date: '2026-01-05', amountCents: -1599, rawDescriptor: 'GLOWBOX MONTHLY' },
      { id: '2', accountId: 'a', date: '2026-02-05', amountCents: -1599, rawDescriptor: 'GLOWBOX MONTHLY' },
      { id: 'r', accountId: 'a', date: '2026-02-09', amountCents: 1599, rawDescriptor: 'GLOWBOX MONTHLY' }, // refund
      { id: '3', accountId: 'a', date: '2026-03-05', amountCents: -1599, rawDescriptor: 'GLOWBOX MONTHLY' },
      { id: '4', accountId: 'a', date: '2026-04-05', amountCents: -1599, rawDescriptor: 'GLOWBOX MONTHLY' },
    ];
    const out = detectRecurring(txns, isoDate('2026-06-10'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cadence: 'MONTHLY', typicalAmountCents: -1599, occurrences: 4 });
  });

  it('does not fabricate a series when fewer than 3 same-signed charges remain', () => {
    const txns = [
      { id: '1', accountId: 'a', date: '2026-01-05', amountCents: -1599, rawDescriptor: 'GLOWBOX MONTHLY' },
      { id: '2', accountId: 'a', date: '2026-02-05', amountCents: -1599, rawDescriptor: 'GLOWBOX MONTHLY' },
      { id: 'r', accountId: 'a', date: '2026-02-09', amountCents: 1599, rawDescriptor: 'GLOWBOX MONTHLY' },
    ];
    expect(detectRecurring(txns, isoDate('2026-06-10'))).toHaveLength(0); // only 2 charges < 3
  });
});
