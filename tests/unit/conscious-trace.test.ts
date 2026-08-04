/**
 * O.18b — per-bucket Glass-Box traces for the Conscious Spending strip.
 *
 * The strip's three figures come from `mapToConsciousBuckets`, a strict
 * re-partition of the plan (#93). The panels behind them come from
 * `traceConsciousBuckets`, which RESHAPES `traceSafeToSpend`'s own rows (the
 * glass-box cardinal rule: never recompute). The partition currently reads
 * each plan field VERBATIM, so each bucket's `reconciles` cannot fail on any
 * current input — it is a DRIFT ALARM: change either side's formula and these
 * tests name the drift (audit P1-14 restated the contract without the old
 * "real check" overclaim).
 *
 * Anchored on real computeSpendingPlan output, never hand-built plans (the
 * conscious.test.ts house rule). Expected values hand-computed inline.
 *
 * Owner 2026-08-01: conscious fixed = fixedExpensesCents only (no cards);
 * guilt-free trace is income − fixed − savings (three rows).
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
  it('fixed: bills only (no cards), positive, summing exactly to the bucket', () => {
    const p = plan({ cardObligationsCents: 100_000 });
    const t = traceConsciousBuckets(p, disclosures({ creditCardCount: 1 }));
    // Owner 2026-08-01: conscious fixed = fixedExpensesCents only.
    expect(t.fixed.rows.map((r) => r.amountCents)).toEqual([300_000]);
    expect(t.fixed.sumCents).toBe(300_000);
    expect(t.fixed.headlineCents).toBe(300_000);
    expect(t.fixed.reconciles).toBe(true);
    expect(t.fixed.key).toBe('conscious_fixed');
  });

  it('fixed: no beyond-month reservation row — cards are not in this bucket', () => {
    const p = plan({
      cardObligationsCents: 100_000,
      obligationsBeyondMonthCents: 40_000,
      obligationsBeyondMonthThroughDate: isoDate('2026-07-05'),
    });
    const t = traceConsciousBuckets(p, disclosures({ creditCardCount: 1 }));
    expect(t.fixed.rows).toHaveLength(1);
    expect(t.fixed.rows[0].amountCents).toBe(300_000);
    expect(t.fixed.sumCents).toBe(300_000);
    expect(t.fixed.reconciles).toBe(true);
    // Still one bills row when reservations are zero.
    const zero = traceConsciousBuckets(plan(), D);
    expect(zero.fixed.rows).toHaveLength(1);
  });

  it('rows are the safe-to-spend trace’s own rows, negated — labels byte-equal, one author', () => {
    const p = plan({ cardObligationsCents: 100_000 });
    const d = disclosures({ creditCardCount: 1 });
    const safe = traceSafeToSpend(p, d);
    const t = traceConsciousBuckets(p, d);
    // safe rows: [income, fixed, savings]
    expect(safe.rows.map((r) => r.id)).toEqual(['income', 'fixed', 'savings']);
    expect(t.fixed.rows[0].label).toBe(safe.rows[1].label);
    expect(t.fixed.rows[0].amountCents).toBe(-safe.rows[1].amountCents);
    expect(t.savings.rows[0].label).toBe(safe.rows[2].label);
    expect(t.savings.rows[0].amountCents).toBe(-safe.rows[2].amountCents);
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
    // fixed owns: the monthly-rate arithmetic, and the "cards not subtracted" pointer.
    expect(fixedBasis).toMatch(/recurring bills at a monthly rate/);
    expect(fixedBasis).toMatch(/Card statement payments are not subtracted here/);
    // Old paid-in-full / beyond-month / estimate provenance left the guilt-free formula.
    expect(fixedBasis).not.toMatch(/counted when its statement/);
    expect(fixedBasis).not.toMatch(/estimated from current balances/);
    expect(fixedBasis).not.toMatch(/no plan you can see/);
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
    // Bills only — cards do not inflate the fixed share amount.
    expect(formatShareText(t.fixed)).toContain(`${CONSCIOUS_BUCKET_LABELS.fixed}: $3,000.00`);
    expect(formatShareText(t.savings)).toContain(`${CONSCIOUS_BUCKET_LABELS.savings}: $500.00`);
    // Fixed panel has the bills row only — no card-payments row.
    expect(formatShareText(t.fixed)).not.toContain('Card payments due this month');
  });

  it('a doctored plan is REPORTED as a mismatch, never hidden (cardinal rule)', () => {
    const p = { ...plan(), leftToSpendCents: plan().leftToSpendCents + 1 };
    const t = traceConsciousBuckets(p, D);
    expect(t.guiltFree.reconciles).toBe(false);
  });

  it('the card facts the plan could not count reach the panels that certify around them (critic P1-1)', () => {
    const d = disclosures({
      creditCardCount: 3,
      undatedCards: [{ cardName: 'Freedom', frozenSince: null }],
      duplicatePairs: [{ aName: 'Sapphire', bName: 'Sapphire 2', confidence: 'high' }],
      frozenCards: [{ label: 'Slate', frozenSince: '2026-06-01' }],
    });
    const p = plan({ cardObligationsCents: 100_000 });
    const t = traceConsciousBuckets(p, d);
    const fixedBasis = t.fixed.basis.join(' ');
    // Three sentences, never one — their directions differ.
    expect(fixedBasis).toMatch(/no statement or due date yet/);
    expect(fixedBasis).toMatch(/same card counted twice/);
    expect(fixedBasis).toMatch(/stopped being shared/);
    // The remainder inherits every term's error; the savings bucket has no card term.
    expect(t.guiltFree.basis.join(' ')).toMatch(/no statement or due date yet/);
    expect(t.savings.basis.join(' ')).not.toMatch(/card/);
    // NOT in the shared safe-to-spend trace: /spending-plan renders that basis
    // list AND its own "What this figure can't see" section — adding these
    // there would print them twice on that page.
    expect(traceSafeToSpend(p, d).basis.join(' ')).not.toMatch(/no statement or due date yet/);
  });

  it('the missing-bill alarm rides the fixed bucket basis, so the share snapshot carries it (critic P1-2)', () => {
    const d = disclosures({
      fixedSeries: { detected: 3, counted: 1, onCard: 0, lapsed: 0, uncounted: 2, noCashAccount: 0 },
    });
    const t = traceConsciousBuckets(plan(), d);
    expect(t.fixed.basis.join(' ')).toMatch(/not in the fixed-expenses line/);
    // The exported text — the artifact a reader can copy — must carry the alarm.
    expect(formatShareText(t.fixed)).toMatch(/not in the fixed-expenses line/);
  });

  it('the long-cadence verb is a fact about the surface: guilt-free subtracts, fixed counts (critic P2-1)', () => {
    const p = plan({
      scheduledFixed: [
        { amountCents: -300_000, cadence: 'MONTHLY' },
        { amountCents: -120_000, cadence: 'ANNUAL' },
      ],
    });
    const t = traceConsciousBuckets(p, D);
    const safe = traceSafeToSpend(p, D);
    const safeSentence = safe.basis.find((b) => b.startsWith('A yearly bill'));
    const fixedSentence = t.fixed.basis.find((b) => b.startsWith('A yearly bill'));
    expect(safeSentence).toMatch(/this figure subtracts a twelfth/);
    expect(fixedSentence).toMatch(/this figure counts a twelfth/);
    // Everything but the verb is byte-shared, so the variants cannot drift.
    expect(fixedSentence).toBe(safeSentence!.replace('figure subtracts', 'figure counts'));
  });

  it('the safe-to-spend basis ORDER is pinned (critic P2-2 — membership tests cannot see a reorder)', () => {
    const p = plan({
      scheduledFixed: [
        { amountCents: -300_000, cadence: 'MONTHLY' },
        { amountCents: -120_000, cadence: 'ANNUAL' },
      ],
      cardObligationsCents: 100_000,
      cardObligationsEstimated: true,
      obligationsBeyondMonthCents: 40_000,
      obligationsBeyondMonthThroughDate: isoDate('2026-07-05'),
      savingsTargetBps: 2000,
    });
    const d = disclosures({
      creditCardCount: 1,
      fixedSeries: { detected: 2, counted: 1, onCard: 0, lapsed: 0, uncounted: 1, noCashAccount: 0 },
    });
    const fingerprint = (s: string): string => {
      if (s.startsWith('Income is')) return 'income';
      if (s.startsWith('Fixed & recurring expenses are')) return 'fixed-rate';
      if (s.includes('not in the fixed-expenses line')) return 'shortfall';
      if (s.startsWith('Discretionary spending')) return 'discretionary';
      if (s.startsWith('A yearly bill')) return 'long-cadence';
      if (s.startsWith('Card statement payments are not subtracted here')) return 'card';
      if (s.startsWith('Planned savings takes')) return 'savings';
      return `UNRECOGNIZED: ${s.slice(0, 40)}`;
    };
    expect(traceSafeToSpend(p, d).basis.map(fingerprint)).toEqual([
      'income',
      'fixed-rate',
      'shortfall',
      'discretionary',
      'long-cadence',
      'card',
      'savings',
    ]);
  });
});

describe('provenance gate per bucket — each panel answers only for the rows it shows (C.11 / audit P1-14)', () => {
  it('fixed panel: an income override leaves the flag true — the fixed term is untouched', () => {
    const base = traceConsciousBuckets(plan(), D);
    expect(base.fixed.dataDerived).toBe(true); // detected-series fixed, no reader input
    const overridden = traceConsciousBuckets(plan({ incomeOverrideCents: 600_000 }), D);
    expect(overridden.fixed.dataDerived).toBe(true);
  });

  it('fixed panel: a typed fixed figure turns the flag off', () => {
    const t = traceConsciousBuckets(plan({ fixedOverrideCents: 150_000 }), D);
    expect(t.fixed.dataDerived).toBe(false);
    // The arithmetic claim is untouched — only the provenance claim moves.
    expect(t.fixed.reconciles).toBe(true);
  });

  it('fixed panel: budget-priced categories turn the flag off; typical-spend keeps it', () => {
    const rollup = { categoryFixedCents: 100_000 };
    expect(traceConsciousBuckets(plan({ ...rollup, categoryFixedHasReaderInput: true }), D).fixed.dataDerived).toBe(false);
    expect(traceConsciousBuckets(plan({ ...rollup, categoryFixedHasReaderInput: false }), D).fixed.dataDerived).toBe(true);
    // Unknown (omitted) ⇒ conservatively reader-priced — never certify on a guess.
    expect(traceConsciousBuckets(plan(rollup), D).fixed.dataDerived).toBe(false);
  });

  it('savings panel: never data-derived — goals and targets are chosen, and $0 asserts nothing', () => {
    expect(traceConsciousBuckets(plan(), D).savings.dataDerived).toBe(false); // goals $500.00
    const unset = traceConsciousBuckets(plan({ goalContributionsCents: 0, savingsTargetBps: null }), D);
    expect(unset.savings.dataDerived).toBe(false); // unset $0
  });

  it('guilt-free panel mirrors the full identity — reader input anywhere in the term turns it off', () => {
    const withGoals = traceConsciousBuckets(plan(), D);
    expect(withGoals.guiltFree.dataDerived).toBe(false); // goals $500.00 > $0
    const clean = traceConsciousBuckets(plan({ goalContributionsCents: 0 }), D);
    expect(clean.guiltFree.dataDerived).toBe(true);
    expect(traceConsciousBuckets(plan({ goalContributionsCents: 0, incomeOverrideCents: 600_000 }), D).guiltFree.dataDerived).toBe(false);
  });

  it('the share text follows the panel: one-row panels carry no penny-match', () => {
    const t = traceConsciousBuckets(plan(), D);
    const fixedShare = formatShareText(t.fixed);
    expect(fixedShare).toContain('This amount is the whole figure.');
    expect(fixedShare).not.toContain('matched to the penny');
    // Critic cycle 2 P1-1: the Fixed row is an aggregate — no completeness claim.
    expect(fixedShare).not.toContain('nothing else is inside it');
    const guiltFreeShare = formatShareText(t.guiltFree);
    expect(guiltFreeShare).toContain('matched to the penny'); // three rows
    expect(guiltFreeShare).not.toContain('nothing invented'); // goals make it reader-typed
  });
});
