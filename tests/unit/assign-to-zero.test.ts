/**
 * P0.4 assign-to-zero line (DECISIONS #525) — the coach-principles plan's
 * leftover C6 affordance: highlight existing `leftToSpendCents` as
 * leftover after Fixed and savings. Engine-first: the picker is pure;
 * nothing here reads a DB. The demo-backed test pins what the /budgets
 * strip needs — a positive leftover on the shared demo, where the e2e
 * asserts the rendered line matches the guilt-free legend to the cent.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { assignToZeroLineFor } from '@/lib/engine/spending-plan/assign-to-zero';
import {
  CONSCIOUS_BUCKET_COUNTS,
  mapToConsciousBuckets,
} from '@/lib/engine/spending-plan/conscious';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { getSpendingPlan } from '@/server/spending-plan';

const CLEAN = { uncountedFixed: false, cardNotesPresent: false } as const;

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

describe('assign-to-zero line — P0.4 leftover highlight', () => {
  it('a positive leftover with no known inflation renders the capacity sentence', () => {
    const p = plan();
    expect(p.leftToSpendCents).toBe(150_000);
    expect(assignToZeroLineFor(p.leftToSpendCents, CLEAN)).toBe(
      COACH_COPY.assignToZero(cents(150_000)),
    );
    expect(assignToZeroLineFor(p.leftToSpendCents, CLEAN)).toContain(
      formatCents(cents(150_000)),
    );
  });

  it('the amount is the guilt-free bucket by construction — one remainder, two names', () => {
    const p = plan();
    const buckets = mapToConsciousBuckets(p);
    const guiltFree = buckets.buckets.find((b) => b.key === 'guiltFree')!;
    expect(guiltFree.cents).toBe(p.leftToSpendCents);
    const line = assignToZeroLineFor(p.leftToSpendCents, CLEAN)!;
    expect(line).toContain(formatCents(cents(guiltFree.cents)));
    expect(line).toMatch(/guilt-free remainder/i);
  });

  it('a zero leftover is an absence: no "$0.00 leftover" claim', () => {
    const p = plan({
      scheduledFixed: [{ amountCents: -450_000, cadence: 'MONTHLY' }],
      goalContributionsCents: 50_000,
    });
    expect(p.leftToSpendCents).toBe(0);
    expect(assignToZeroLineFor(p.leftToSpendCents, CLEAN)).toBeNull();
  });

  it('an overspent (negative) leftover is not leftover to assign — consciousOverspent already speaks', () => {
    const p = plan({
      trailingMonthlyIncomeCents: [300_000],
      scheduledFixed: [{ amountCents: -310_000, cadence: 'MONTHLY' }],
      goalContributionsCents: 20_000,
    });
    expect(p.overspent).toBe(true);
    expect(p.leftToSpendCents).toBeLessThan(0);
    expect(assignToZeroLineFor(p.leftToSpendCents, CLEAN)).toBeNull();
  });

  it('test_regression__assign_to_zero_refuses_when_uncounted_fixed_inflates_leftover', () => {
    expect(
      assignToZeroLineFor(150_000, { uncountedFixed: true, cardNotesPresent: false }),
    ).toBeNull();
  });

  it('test_regression__assign_to_zero_refuses_when_card_notes_make_leftover_direction_unknown', () => {
    expect(
      assignToZeroLineFor(150_000, { uncountedFixed: false, cardNotesPresent: true }),
    ).toBeNull();
  });

  it('unset savings is not inflation — that leftover is the genuine Ramsey case', () => {
    const p = plan({ goalContributionsCents: 0, savingsTargetBps: null });
    expect(p.plannedSavingsCents).toBe(0);
    expect(p.leftToSpendCents).toBeGreaterThan(0);
    expect(assignToZeroLineFor(p.leftToSpendCents, CLEAN)).not.toBeNull();
  });

  it('test_regression__assign_to_zero_line_is_pinned_byte_exact', () => {
    const text = assignToZeroLineFor(150_000, CLEAN)!;
    const pinned =
      `$1,500.00 of this month's income pattern is leftover after Fixed and savings — that's the guilt-free remainder, a monthly capacity, not cash still sitting unspent. Giving every dollar a job is the plan, not a verdict.`;
    expect(text).toBe(pinned);
  });

  it('the line does not claim remaining cash, does not instruct zeroing fun money, and does not invent a second remainder', () => {
    const text = assignToZeroLineFor(150_000, CLEAN)!;
    expect(text).not.toMatch(/you have\b/i);
    expect(text).not.toMatch(/still unassigned/i);
    expect(text).not.toMatch(
      /\b(should|must|need to|zero out|cut (it|this)|assign it now)\b/i,
    );
    expect(text).not.toMatch(/Aimplifi|we (count|track|know|see)/i);
    expect(text).toMatch(/monthly capacity/i);
    expect(text).toMatch(/not cash still sitting unspent/i);
    const dollars = text.match(/\$[\d,]+\.\d{2}/g) ?? [];
    expect(dollars).toEqual(['$1,500.00']);
  });

  it('test_regression__assign_to_zero_does_not_change_the_lens_or_overspent_copy', () => {
    expect(
      COACH_COPY.consciousSpending(60, 10, 30, CONSCIOUS_BUCKET_COUNTS.fixed, null),
    ).toBe(
      `About 60% of your income pattern goes to Fixed costs (${CONSCIOUS_BUCKET_COUNTS.fixed}), 10% to savings and investing goals, and 30% is guilt-free. A rough target is 50–60% / 15–20% / 20–35% — a lens on where your money goes, not a rule. Investing contributions aren't tracked separately yet, so they sit with savings.`,
    );
    expect(COACH_COPY.consciousOverspent()).toBe(
      `Fixed costs and savings have outpaced this month's income pattern, so guilt-free has gone negative — one month is weather, not climate. The trend is what matters.`,
    );
  });

  it('the demo account has a positive leftover the strip needs', async () => {
    const d = await getSpendingPlan(DEMO_USER_ID);
    expect(d.leftToSpendCents).toBeGreaterThan(0);
  });
});
