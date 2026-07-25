import { describe, it, expect } from 'vitest';
import {
  buildReturnMoment,
  RETURN_MOMENT_THRESHOLD_DAYS,
  type ReturnMomentInput,
} from '@/lib/engine/return-moment/build';
import type { ISODate } from '@/lib/dates';
import type { Cents } from '@/lib/money';
import type { MoneyReview } from '@/lib/engine/fi/coach-copy';

const REVIEW: MoneyReview = {
  month: 'Jun 2026',
  improvement: 'Your savings rate held steady this month — nice work keeping it on track.',
  creep: 'Nothing crept up this month.',
  nextAction: 'Next: confirm which account pays your cards.',
};

// A clear radar: no committed dip inside the horizon.
const CLEAR = { firstNegativeDate: null, daysUntilFirstNegative: null, collidingCardName: null, startingBalanceFrozen: null };

function input(over: Partial<ReturnMomentInput> = {}): ReturnMomentInput {
  return {
    daysSinceLastSeen: 30,
    review: REVIEW,
    radar: CLEAR,
    autoFiledCount: 0,
    priceIncreases: [],
    ...over,
  };
}

describe('buildReturnMoment — the greeting gate', () => {
  it('returns null on a first-ever visit (no last-seen date)', () => {
    expect(buildReturnMoment(input({ daysSinceLastSeen: null }))).toBeNull();
  });

  it('returns null for an active user (gap within the week)', () => {
    expect(buildReturnMoment(input({ daysSinceLastSeen: 0 }))).toBeNull();
    expect(buildReturnMoment(input({ daysSinceLastSeen: 7 }))).toBeNull();
  });

  it('the threshold is exclusive: 7 is silent, 8 greets', () => {
    expect(RETURN_MOMENT_THRESHOLD_DAYS).toBe(7);
    expect(buildReturnMoment(input({ daysSinceLastSeen: 7 }))).toBeNull();
    expect(buildReturnMoment(input({ daysSinceLastSeen: 8 }))).not.toBeNull();
  });

  it('a negative gap (clock skew / provider today before last-seen) never greets', () => {
    expect(buildReturnMoment(input({ daysSinceLastSeen: -3 }))).toBeNull();
  });
});

describe('buildReturnMoment — composition (verbatim, no new numbers)', () => {
  it('a quiet return is honest: clear radar, zero count, no fabricated highlight beyond the real review', () => {
    const m = buildReturnMoment(input({ daysSinceLastSeen: 9, autoFiledCount: 0, priceIncreases: [] }))!;
    expect(m.daysAway).toBe(9);
    expect(m.radar).toEqual({ kind: 'clear', frozenStart: null });
    expect(m.autoFiledCount).toBe(0);
    expect(m.priceIncreases).toEqual([]);
    expect(m.reviewHighlight).toBe(REVIEW.improvement);
  });

  it('a busy return copies every value through unchanged', () => {
    const priceIncreases = [
      { merchant: 'Netflix', deltaCents: 200 as Cents },
      { merchant: 'Spotify', deltaCents: 150 as Cents },
    ];
    const m = buildReturnMoment(
      input({
        daysSinceLastSeen: 21,
        autoFiledCount: 214,
        priceIncreases,
        radar: { firstNegativeDate: '2026-07-22' as ISODate, daysUntilFirstNegative: 4, collidingCardName: 'Amex', startingBalanceFrozen: null },
      }),
    )!;
    expect(m.daysAway).toBe(21);
    expect(m.autoFiledCount).toBe(214);
    expect(m.radar).toEqual({ kind: 'warning', onDate: '2026-07-22', daysUntil: 4, cardName: 'Amex', frozenStart: null });
    // Deltas are the exact source cents — not summed, scaled, or reordered.
    expect(m.priceIncreases).toEqual([
      { merchant: 'Netflix', deltaCents: 200 },
      { merchant: 'Spotify', deltaCents: 150 },
    ]);
  });

  it('warning with an unknown colliding card and unknown days-until degrades to nulls, not a guess', () => {
    const m = buildReturnMoment(
      input({
        radar: { firstNegativeDate: '2026-08-01' as ISODate, daysUntilFirstNegative: null, collidingCardName: null, startingBalanceFrozen: null },
      }),
    )!;
    expect(m.radar).toEqual({ kind: 'warning', onDate: '2026-08-01', daysUntil: null, cardName: null, frozenStart: null });
  });

  it('no review yet → null highlight (never invents one)', () => {
    const m = buildReturnMoment(input({ review: null }))!;
    expect(m.reviewHighlight).toBeNull();
  });

  it('does not mutate or alias the caller’s price-increase array', () => {
    const priceIncreases = [{ merchant: 'Hulu', deltaCents: 300 as Cents }];
    const m = buildReturnMoment(input({ priceIncreases }))!;
    expect(m.priceIncreases).not.toBe(priceIncreases);
    m.priceIncreases.push({ merchant: 'X', deltaCents: 1 as Cents });
    expect(priceIncreases).toHaveLength(1);
  });
});
