/**
 * HOSTILE CRITIC — Phase 2, cycle 1: attacks on recurring detection
 * (src/lib/engine/recurring/detect.ts) per mandate #5.
 *
 * `FINDING:` tests assert the code's ACTUAL (defective or limited) behavior.
 */
import { describe, expect, it } from 'vitest';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { isoDate } from '@/lib/dates';

const today = isoDate('2026-06-10');
let n = 0;
const t = (date: string, amountCents: number, rawDescriptor: string): RecurringTxn => ({
  id: `c2-${++n}`,
  accountId: 'acct-freedom',
  date,
  amountCents,
  rawDescriptor,
});

describe('critic: recurring detection adversarial cases', () => {
  it('a subscription with ONE missed month (60d gap) still detects as MONTHLY', () => {
    const txns = [
      t('2026-01-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-02-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-03-03', -1799, 'NETFLIX.COM 866-579-7172'),
      // April missed
      t('2026-05-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-06-03', -1799, 'NETFLIX.COM 866-579-7172'),
    ];
    const series = detectRecurring(txns, today);
    const netflix = series.find((s) => s.merchantCanonical === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix!.cadence).toBe('MONTHLY'); // median gap [31,28,61,31] = 31 ✓
  });

  it('FINDING P2 (documented limit): an ANNUAL subscription with 2 occurrences is invisible (needs ≥3 = 2+ years of history)', () => {
    const txns = [
      t('2025-06-01', -9900, 'AMAZON.COM*PR1ME 8821'),
      t('2026-06-01', -9900, 'AMAZON.COM*PR1ME 8821'),
    ];
    const series = detectRecurring(txns, today);
    expect(series).toHaveLength(0); // txns.length < 3 → skipped (detect.ts:93)
  });

  it('FINDING P2: a single refund + rebill DESTROYS subscription detection for the merchant entirely', () => {
    const txns = [
      t('2026-01-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-02-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-03-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-04-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-04-05', 1799, 'NETFLIX.COM 866-579-7172'), // refund
      t('2026-04-06', -1799, 'NETFLIX.COM 866-579-7172'), // rebill
      t('2026-05-03', -1799, 'NETFLIX.COM 866-579-7172'),
    ];
    const series = detectRecurring(txns, today);
    // distinct = {-1799, +1799}; last = -1799; firstNewIdx = 0 → `continue`
    // (detect.ts:120) — the whole series is dropped, the subscription vanishes
    // from detection (and so would the price-increase insight).
    expect(series.find((s) => s.merchantCanonical === 'Netflix')).toBeUndefined();
  });

  it('payroll survives a ONE-WEEK shifted paycheck (median gap still 14)', () => {
    const txns = [
      t('2026-03-06', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'),
      t('2026-03-20', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'),
      t('2026-04-03', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'),
      t('2026-04-24', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'), // +21 (shifted a week)
      t('2026-05-01', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'), // +7 (back on track)
      t('2026-05-15', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'),
      t('2026-05-29', 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL'),
    ];
    const series = detectRecurring(txns, today);
    const payroll = series.find((s) => s.isIncome);
    expect(payroll).toBeDefined();
    expect(payroll!.cadence).toBe('BIWEEKLY'); // gaps [14,14,21,7,14,14] → median 14 ✓
  });

  it('FINDING P2: "possiblyUnused" fires for EVERY fitness subscription regardless of recency — the 90-day claim in the code comment is not implemented', () => {
    // detect.ts:130-133 comments "no usage signal for 90+ days" but the code is
    // `isSubscription && categoryId === 'fitness'` — a gym charged YESTERDAY
    // with months of activity is still flagged. (DECISIONS #18 admits the
    // heuristic; the comment and PHASES.md #6 "the 90-day-unused one" oversell it.)
    const txns = [
      t('2026-04-09', -3499, 'LA FITNESS MEMBERSHIP DUES'),
      t('2026-05-09', -3499, 'LA FITNESS MEMBERSHIP DUES'),
      t('2026-06-09', -3499, 'LA FITNESS MEMBERSHIP DUES'), // charged yesterday
    ];
    const series = detectRecurring(txns, today);
    expect(series[0].possiblyUnused).toBe(true); // flagged with zero 90-day evidence
  });

  it('FINDING P2: a price change where the LAST txn is a refund flips isIncome and inverts the plateau', () => {
    const txns = [
      t('2026-03-03', -1549, 'NETFLIX.COM 866-579-7172'),
      t('2026-04-03', -1549, 'NETFLIX.COM 866-579-7172'),
      t('2026-05-03', -1549, 'NETFLIX.COM 866-579-7172'),
      t('2026-06-03', 1549, 'NETFLIX.COM 866-579-7172'), // refund, most recent
    ];
    const series = detectRecurring(txns, today);
    const s = series.find((x) => x.merchantCanonical === 'Netflix');
    // distinct = 2, plateaus [-1549×3 | +1549×1] → treated as a PRICE CHANGE to
    // +$15.49 and classified as INCOME.
    expect(s).toBeDefined();
    expect(s!.isIncome).toBe(true); // Netflix "income" of +$15.49/mo
    expect(s!.previousAmountCents).toBe(-1549);
    expect(s!.isSubscription).toBe(false); // and the real subscription disappears
  });
});
