/**
 * HOSTILE CRITIC — Phase 2, cycle 1: attacks on recurring detection
 * (src/lib/engine/recurring/detect.ts) per mandate #5.
 *
 * `FINDING:` tests assert the code's ACTUAL (defective or limited) behavior.
 */
import { describe, expect, it } from 'vitest';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
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
    const series = detectRecurring(txns, today, NO_RECURRING_OVERRIDES);
    const netflix = series.find((s) => s.merchantCanonical === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix!.cadence).toBe('MONTHLY'); // median gap [31,28,61,31] = 31 ✓
  });

  it('FINDING P2 (documented limit): an ANNUAL subscription with 2 occurrences is invisible (needs ≥3 = 2+ years of history)', () => {
    const txns = [
      t('2025-06-01', -9900, 'AMAZON.COM*PR1ME 8821'),
      t('2026-06-01', -9900, 'AMAZON.COM*PR1ME 8821'),
    ];
    const series = detectRecurring(txns, today, NO_RECURRING_OVERRIDES);
    expect(series).toHaveLength(0); // txns.length < 3 → skipped (detect.ts:93)
  });

  it('FIXED (ROADMAP #4): a single refund + rebill no longer destroys detection', () => {
    const txns = [
      t('2026-01-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-02-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-03-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-04-03', -1799, 'NETFLIX.COM 866-579-7172'),
      t('2026-04-05', 1799, 'NETFLIX.COM 866-579-7172'), // refund
      t('2026-04-06', -1799, 'NETFLIX.COM 866-579-7172'), // rebill
      t('2026-05-03', -1799, 'NETFLIX.COM 866-579-7172'),
    ];
    const series = detectRecurring(txns, today, NO_RECURRING_OVERRIDES);
    // The +$17.99 refund is the minority sign → excluded; the 6 charges still
    // form the series. (Previously distinct={-1799,+1799} with firstNewIdx=0
    // dropped the whole subscription — STATUS #7, now resolved by the
    // dominant-sign filter in detect.ts.)
    const netflix = series.find((s) => s.merchantCanonical === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix!.cadence).toBe('MONTHLY');
    expect(netflix!.typicalAmountCents).toBe(-1799);
    expect(netflix!.isSubscription).toBe(true);
    expect(netflix!.previousAmountCents).toBeNull(); // a clean series, not a price change
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
    const series = detectRecurring(txns, today, NO_RECURRING_OVERRIDES);
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
    const series = detectRecurring(txns, today, NO_RECURRING_OVERRIDES);
    expect(series[0].possiblyUnused).toBe(true); // flagged with zero 90-day evidence
  });

  it('FIXED: a trailing refund no longer flips isIncome or inverts the plateau', () => {
    const txns = [
      t('2026-03-03', -1549, 'NETFLIX.COM 866-579-7172'),
      t('2026-04-03', -1549, 'NETFLIX.COM 866-579-7172'),
      t('2026-05-03', -1549, 'NETFLIX.COM 866-579-7172'),
      t('2026-06-03', 1549, 'NETFLIX.COM 866-579-7172'), // refund, most recent
    ];
    const series = detectRecurring(txns, today, NO_RECURRING_OVERRIDES);
    const s = series.find((x) => x.merchantCanonical === 'Netflix');
    // The trailing +$15.49 refund (minority sign) is excluded; the 3 charges are
    // a clean monthly expense subscription — NOT phantom +$15.49/mo "income".
    expect(s).toBeDefined();
    expect(s!.isIncome).toBe(false);
    expect(s!.isSubscription).toBe(true);
    expect(s!.typicalAmountCents).toBe(-1549);
    expect(s!.previousAmountCents).toBeNull();
  });
});
