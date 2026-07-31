/**
 * O.18b — per-bucket Glass-Box traces for the Conscious Spending strip.
 *
 * The strip's three figures come from `mapToConsciousBuckets`, a strict
 * re-partition of the plan (#93). The panels behind them come from
 * `traceConsciousBuckets`, which RESHAPES `traceSafeToSpend`'s own rows (the
 * glass-box cardinal rule: never recompute). Each bucket's `reconciles` is
 * therefore a real CROSS-MODULE check: the partition module and the trace
 * module read the same plan fields through different code, and this suite is
 * the executable form of the #93 invariant — change either side's formula and
 * these tests name the drift.
 *
 * Anchored on real computeSpendingPlan output, never hand-built plans (the
 * conscious.test.ts house rule). Expected values hand-computed inline.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  computeSpendingPlan,
  type SpendingPlanDisclosures,
} from '@/lib/engine/spending-plan/plan';
import {
  CONSCIOUS_BUCKET_LABELS,
  mapToConsciousBuckets,
} from '@/lib/engine/spending-plan/conscious';
import { traceConsciousBuckets, traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { formatShareText } from '@/lib/engine/glass-box/redact';

const plan = (over: Partial<Parameters<typeof computeSpendingPlan>[0]> = {}) =>
  computeSpendingPlan({
    today: isoDate('2026-06-25'),
    trailingMonthlyIncomeCents: [500_000],
    scheduledIncome: [],
    scheduledFixed: [{ amountCents: -300_000, cadence: 'MONTHLY' }],
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 50_000,
    savingsTargetBps: null,
    ...over,
  });

const disclosures = (over: Partial<SpendingPlanDisclosures> = {}): SpendingPlanDisclosures => ({
  undatedCards: [],
  statementPendingCards: [],
  duplicatePairs: [],
  frozenCards: [],
  creditCardCount: 0,
  creditCardsOutsideFigure: 0,
  cardsDatedAfterThisMonth: 0,
  fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
  ...over,
});
const D = disclosures();

describe('traceConsciousBuckets — each bucket panel reconciles to the strip figure', () => {
  it('fixed: bills + card payments, positive, summing exactly to the bucket', () => {
    const p = plan({ cardObligationsCents: 100_000 });
    const t = traceConsciousBuckets(p, disclosures({ creditCardCount: 1 }));
    // 300k bills + 100k card payments; no beyond-month row (that term is $0).
    expect(t.fixed.rows.map((r) => r.amountCents)).toEqual([300_000, 100_000]);
    expect(t.fixed.sumCents).toBe(400_000);
    expect(t.fixed.headlineCents).toBe(400_000);
    expect(t.fixed.reconciles).toBe(true);
    expect(t.fixed.key).toBe('conscious_fixed');
  });

  it('fixed: the beyond-month reservation appears as its own row only when it acted', () => {
    const p = plan({
      cardObligationsCents: 100_000,
      obligationsBeyondMonthCents: 40_000,
      obligationsBeyondMonthThroughDate: isoDate('2026-07-05'),
    });
    const t = traceConsciousBuckets(p, disclosures({ creditCardCount: 1 }));
    expect(t.fixed.rows).toHaveLength(3);
    expect(t.fixed.rows[2].amountCents).toBe(40_000);
    expect(t.fixed.sumCents).toBe(440_000);
    expect(t.fixed.reconciles).toBe(true);
    // A $0 reservation gets NO row — a row would name a mechanism that did not act.
    const zero = traceConsciousBuckets(plan(), D);
    expect(zero.fixed.rows).toHaveLength(2);
  });

  it('rows are the safe-to-spend trace’s own rows, negated — labels byte-equal, one author', () => {
    const p = plan({ cardObligationsCents: 100_000 });
    const d = disclosures({ creditCardCount: 1 });
    const safe = traceSafeToSpend(p, d);
    const t = traceConsciousBuckets(p, d);
    // safe rows: [income, fixed, card-payments, savings]
    expect(t.fixed.rows[0].label).toBe(safe.rows[1].label);
    expect(t.fixed.rows[1].label).toBe(safe.rows[2].label);
    expect(t.fixed.rows[0].amountCents).toBe(-safe.rows[1].amountCents);
    expect(t.fixed.rows[1].amountCents).toBe(-safe.rows[2].amountCents);
    expect(t.savings.rows[0].label).toBe(safe.rows[3].label);
    expect(t.savings.rows[0].amountCents).toBe(-safe.rows[3].amountCents);
  });

  it('savings: one row; the unset-$0 keeps its L.29 control, a goals figure does not', () => {
    const unset = traceConsciousBuckets(
      plan({ goalContributionsCents: 0, savingsTargetBps: null }),
      D,
    );
    expect(unset.savings.rows).toHaveLength(1);
    expect(unset.savings.rows[0].label).toBe('Planned savings (no monthly amount set)');
    expect(unset.savings.rows[0].action).toEqual({ label: 'Set a savings target', href: '/settings' });
    expect(unset.savings.sumCents).toBe(0);
    expect(unset.savings.reconciles).toBe(true);
    expect(Object.is(unset.savings.rows[0].amountCents, -0)).toBe(false); // −0 never rendered

    const goals = traceConsciousBuckets(plan(), D);
    expect(goals.savings.rows[0].label).toBe('Planned savings (goals)');
    expect(goals.savings.rows[0].action).toBeUndefined();
    expect(goals.savings.sumCents).toBe(50_000);
    expect(goals.savings.reconciles).toBe(true);
  });

  it('guilt-free IS the safe-to-spend identity — same rows, same headline, sign preserved', () => {
    const p = plan({
      trailingMonthlyIncomeCents: [300_000],
      scheduledFixed: [{ amountCents: -310_000, cadence: 'MONTHLY' }],
      goalContributionsCents: 20_000,
    }); // left = 300k − 310k − 20k = −30k (overspent)
    const t = traceConsciousBuckets(p, D);
    const safe = traceSafeToSpend(p, D);
    expect(t.guiltFree.rows).toEqual(safe.rows);
    expect(t.guiltFree.headlineCents).toBe(-30_000);
    expect(t.guiltFree.sumCents).toBe(-30_000);
    expect(t.guiltFree.reconciles).toBe(true);
    expect(t.guiltFree.basis).toEqual(safe.basis);
  });

  it('the #93 partition invariant holds ACROSS the two modules, on every plan shape', () => {
    const shapes = [
      plan(),
      plan({ cardObligationsCents: 100_000 }),
      plan({ savingsTargetBps: 2000 }),
      plan({
        cardObligationsCents: 100_000,
        obligationsBeyondMonthCents: 40_000,
        obligationsBeyondMonthThroughDate: isoDate('2026-07-05'),
      }),
      plan({
        trailingMonthlyIncomeCents: [300_000],
        scheduledFixed: [{ amountCents: -310_000, cadence: 'MONTHLY' }],
        goalContributionsCents: 20_000,
      }),
      plan({ trailingMonthlyIncomeCents: [], goalContributionsCents: 0 }),
    ];
    for (const p of shapes) {
      const t = traceConsciousBuckets(p, D);
      const buckets = mapToConsciousBuckets(p);
      // Every bucket panel reconciles to its own strip figure…
      for (const b of buckets.buckets) {
        const trace = { fixed: t.fixed, savings: t.savings, guiltFree: t.guiltFree }[b.key];
        expect(trace.headlineCents).toBe(b.cents);
        expect(trace.reconciles).toBe(true);
      }
      // …and the three panels' own sums recompose pattern income exactly.
      expect(t.fixed.sumCents + t.savings.sumCents + t.guiltFree.headlineCents).toBe(
        p.patternIncomeCents,
      );
    }
  });

  it('basis sentences land on the bucket that owns them, and only there', () => {
    const p = plan({
      cardObligationsCents: 100_000,
      cardObligationsEstimated: true,
      obligationsBeyondMonthCents: 40_000,
      obligationsBeyondMonthThroughDate: isoDate('2026-07-05'),
      savingsTargetBps: 2000,
    });
    const t = traceConsciousBuckets(p, disclosures({ creditCardCount: 1 }));
    const fixedBasis = t.fixed.basis.join(' ');
    // fixed owns: the monthly-rate arithmetic, card provenance + estimate, the reservation.
    expect(fixedBasis).toMatch(/recurring bills at a monthly rate/);
    expect(fixedBasis).toMatch(/counted when its statement’s payment comes due/);
    expect(fixedBasis).toMatch(/estimated from current balances/);
    expect(fixedBasis).toMatch(/no plan you can see/);
    // fixed does NOT own income or savings sentences.
    expect(fixedBasis).not.toMatch(/median/);
    expect(fixedBasis).not.toMatch(/pay-yourself-first/);
    // savings owns the max(goals, target) sentence and nothing about cards.
    const savingsBasis = t.savings.basis.join(' ');
    expect(savingsBasis).toMatch(/never added together/);
    expect(savingsBasis).not.toMatch(/statement/);
    // guilt-free carries the full identity's basis (it shows every row).
    expect(t.guiltFree.basis.join(' ')).toMatch(/median/);
  });

  it('share text names each bucket with the strip’s own label — one author', () => {
    const p = plan({ cardObligationsCents: 100_000 });
    const t = traceConsciousBuckets(p, disclosures({ creditCardCount: 1 }));
    expect(formatShareText(t.fixed)).toContain(`${CONSCIOUS_BUCKET_LABELS.fixed}: $4,000.00`);
    expect(formatShareText(t.savings)).toContain(`${CONSCIOUS_BUCKET_LABELS.savings}: $500.00`);
    // Bucket rows are generic term labels, not card names — they survive redaction.
    expect(formatShareText(t.fixed)).toContain('Card payments due this month');
  });

  it('a doctored plan is REPORTED as a mismatch, never hidden (cardinal rule)', () => {
    const p = { ...plan(), leftToSpendCents: plan().leftToSpendCents + 1 };
    const t = traceConsciousBuckets(p, D);
    expect(t.guiltFree.reconciles).toBe(false);
  });
});
