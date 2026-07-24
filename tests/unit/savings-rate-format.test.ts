/**
 * Savings-rate DISPLAY rules (TASKS L.11). These lock the two things a fresh-context
 * critic broke in the first cut of the pooled-rate fix: the "−855105.8%" giant number
 * recurring when the window has a single near-zero-income month, and a "1-month average"
 * that compares this month to itself.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_AVERAGE_MONTHS,
  RATE_FLOOR_BPS,
  formatSavingsRateBps,
  showsAverageComparison,
} from '@/components/coach/savings-rate-format';

describe('formatSavingsRateBps — never renders a fabricated giant number', () => {
  it('floors anything past −100% to "below -100%" (the owner’s −855105.8% case)', () => {
    expect(formatSavingsRateBps(-8551058)).toBe('below -100%');
    expect(formatSavingsRateBps(-10001)).toBe('below -100%');
  });

  it('shows a normal rate at or above the floor, to one decimal', () => {
    expect(formatSavingsRateBps(-1450)).toBe('-14.5%');
    expect(formatSavingsRateBps(3000)).toBe('30.0%');
    expect(formatSavingsRateBps(0)).toBe('0.0%');
    expect(formatSavingsRateBps(10000)).toBe('100.0%'); // +100% is a real, unfloored max
  });

  it('treats exactly −100% as still meaningful (boundary), −100.01% as floored', () => {
    expect(formatSavingsRateBps(RATE_FLOOR_BPS)).toBe('-100.0%');
    expect(formatSavingsRateBps(RATE_FLOOR_BPS - 1)).toBe('below -100%');
  });
});

describe('showsAverageComparison — an average needs ≥2 contributing months', () => {
  it('hides the comparison when only one month has income (no self-comparison)', () => {
    expect(showsAverageComparison(-1450, -1450, 1)).toBe(false);
    expect(MIN_AVERAGE_MONTHS).toBe(2);
  });

  it('shows it once at least two months contributed', () => {
    expect(showsAverageComparison(-1450, -4000, 2)).toBe(true);
    expect(showsAverageComparison(3000, 2500, 4)).toBe(true);
  });

  it('hides it when either rate is null (no income to compare)', () => {
    expect(showsAverageComparison(null, -4000, 3)).toBe(false);
    expect(showsAverageComparison(-1450, null, 3)).toBe(false);
  });
});
