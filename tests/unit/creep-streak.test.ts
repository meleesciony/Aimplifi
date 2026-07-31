/**
 * No-subscription-creep streak (#254, AI plan §Later #17 streaks half).
 *
 * Every expected value is hand-verified in docs/EDGE_CASES.md §Habit Streaks
 * (N1–N9 + seed lock). Abstention and non-events are the point: decreases,
 * income raises, current-partial-month increases, and out-of-window history
 * must all leave the streak alone.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { detectRecurring, type RecurringSeriesResult } from '@/lib/engine/recurring/detect';
import { NO_RECURRING_OVERRIDES } from '@/lib/engine/recurring/override';
import { computeNoCreepStreak } from '@/lib/engine/recurring/creep-streak';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';

const TODAY = isoDate('2026-06-10');

function series(overrides: Partial<RecurringSeriesResult> = {}): RecurringSeriesResult {
  return {
    merchantCanonical: 'Netflix',
    categoryId: 'entertainment',
    cadence: 'MONTHLY',
    typicalAmountCents: -1799,
    lastAmountCents: -1799,
    previousAmountCents: null,
    priceChangedAt: null,
    lastSeenAt: isoDate('2026-06-03'),
    nextExpectedAt: isoDate('2026-07-03'),
    occurrences: 18,
    isSubscription: true,
    isIncome: false,
    possiblyUnused: false,
    accountId: 'acct-freedom',
    declaredByUser: false,
    ...overrides,
  };
}

describe('computeNoCreepStreak (hand-verified N1–N9)', () => {
  it('N1: no subscription series → abstain (null), never a vacuous streak', () => {
    const income = series({ isSubscription: false, isIncome: true, typicalAmountCents: 250000 });
    expect(computeNoCreepStreak([income], TODAY)).toEqual({
      streakMonths: null,
      windowMonths: 12,
      subscriptionCount: 0,
      brokeOn: null,
    });
  });

  it('N2: increase first charged 2026-02-03, today 2026-06-10 → May/Apr/Mar clear, Feb breaks → 3', () => {
    const s = series({ previousAmountCents: -1549, priceChangedAt: isoDate('2026-02-03') });
    const r = computeNoCreepStreak([s], TODAY);
    expect(r.streakMonths).toBe(3);
    expect(r.brokeOn).toEqual({ merchantCanonical: 'Netflix', fromCents: 1549, toCents: 1799, month: '2026-02' });
  });

  it('N3: a price DECREASE is not creep → full 12-month cap', () => {
    const s = series({
      typicalAmountCents: -1549,
      lastAmountCents: -1549,
      previousAmountCents: -1799,
      priceChangedAt: isoDate('2026-02-03'),
    });
    const r = computeNoCreepStreak([s], TODAY);
    expect(r.streakMonths).toBe(12);
    expect(r.brokeOn).toBeNull();
  });

  it('N4: no price changes anywhere → streak = the disclosed 12-month cap', () => {
    const r = computeNoCreepStreak([series(), series({ merchantCanonical: 'Spotify', typicalAmountCents: -1199, lastAmountCents: -1199 })], TODAY);
    expect(r).toEqual({ streakMonths: 12, windowMonths: 12, subscriptionCount: 2, brokeOn: null });
  });

  it('N5: an increase inside the current PARTIAL month is invisible to the full-month walk', () => {
    const s = series({ previousAmountCents: -1549, priceChangedAt: isoDate('2026-06-03') });
    const r = computeNoCreepStreak([s], TODAY);
    expect(r.streakMonths).toBe(12);
    expect(r.brokeOn).toBeNull();
  });

  it('N6: two increases (Feb and Apr) → the walk stops at the more recent → streak 1', () => {
    const feb = series({ previousAmountCents: -1549, priceChangedAt: isoDate('2026-02-03') });
    const apr = series({
      merchantCanonical: 'Spotify',
      typicalAmountCents: -1299,
      lastAmountCents: -1299,
      previousAmountCents: -1199,
      priceChangedAt: isoDate('2026-04-07'),
    });
    const r = computeNoCreepStreak([feb, apr], TODAY);
    expect(r.streakMonths).toBe(1);
    expect(r.brokeOn?.merchantCanonical).toBe('Spotify');
    expect(r.brokeOn?.month).toBe('2026-04');
  });

  it('N7: an increase 13 months back is outside the window → 12 (cap discloses the horizon)', () => {
    const s = series({ previousAmountCents: -1549, priceChangedAt: isoDate('2025-05-03') });
    const r = computeNoCreepStreak([s], TODAY);
    expect(r.streakMonths).toBe(12);
    expect(r.brokeOn).toBeNull();
  });

  it('N7b: an increase exactly 12 full months back (the window edge) still breaks → 11', () => {
    const s = series({ previousAmountCents: -1549, priceChangedAt: isoDate('2025-06-03') });
    const r = computeNoCreepStreak([s], TODAY);
    expect(r.streakMonths).toBe(11);
    expect(r.brokeOn?.month).toBe('2025-06');
  });

  it('N8: an income raise is not subscription creep (and alone, the universe abstains)', () => {
    const raise = series({
      isSubscription: false,
      isIncome: true,
      typicalAmountCents: 260000,
      lastAmountCents: 260000,
      previousAmountCents: 250000,
      priceChangedAt: isoDate('2026-04-01'),
    });
    expect(computeNoCreepStreak([raise], TODAY).streakMonths).toBeNull();
    // with a quiet subscription alongside, the raise still never breaks the walk
    expect(computeNoCreepStreak([raise, series()], TODAY).streakMonths).toBe(12);
  });

  it('N9: same-month tie → largest increase wins, deterministic', () => {
    const small = series({ previousAmountCents: -1599, priceChangedAt: isoDate('2026-03-03') }); // +200
    const big = series({
      merchantCanonical: 'HelloFresh',
      typicalAmountCents: -6749,
      lastAmountCents: -6749,
      previousAmountCents: -6299,
      priceChangedAt: isoDate('2026-03-22'),
    }); // +450
    const r = computeNoCreepStreak([small, big], TODAY);
    expect(r.brokeOn?.merchantCanonical).toBe('HelloFresh');
    expect(r.brokeOn?.month).toBe('2026-03');
  });
});

describe('demo seed lock (#254) — Netflix is the demo’s only creep event', () => {
  it('SEED: default asOf → streak 3, brokeOn Netflix 1549 → 1799 in 2026-02', () => {
    const seed = buildSeedData('2026-06-10');
    // The coach input predicate, verbatim (critic #254 F4): POSTED, non-split
    // (seed rows carry no split fields), spending accounts only.
    const spendingIds = new Set(
      seed.accounts
        .filter((a) => (SPENDING_ACCOUNT_TYPES as readonly string[]).includes(a.type))
        .map((a) => a.id),
    );
    const txns = seed.transactions.filter((t) => t.status === 'POSTED' && spendingIds.has(t.accountId));
    const detected = detectRecurring(txns, TODAY, NO_RECURRING_OVERRIDES);
    const r = computeNoCreepStreak(detected, TODAY);
    expect(r.streakMonths).toBe(3);
    expect(r.brokeOn).toEqual({
      merchantCanonical: 'Netflix',
      fromCents: 1549,
      toCents: 1799,
      month: '2026-02',
    });
    expect(r.subscriptionCount).toBeGreaterThanOrEqual(8);
  });
});
