// @vitest-environment jsdom
/**
 * Live 2026-09-01: dashboard "Over plan by $3,085.33" / "guilt-free is $0 this
 * month" sat next to TOP SPENDING "$0.00 this month". Over-plan is the trailing
 * complete-month pattern remainder (income − fixed − savings). Copy must not
 * import a this-month spend window onto that remainder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/engagement-actions', () => ({ logEngagement: vi.fn() }));

import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SafeToSpendCard } from '@/components/finance/safe-to-spend-card';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';

afterEach(cleanup);

const disclosures = {
  undatedCards: [],
  statementPendingCards: [],
  duplicatePairs: [],
  frozenCards: [],
  creditCardCount: 0,
  creditCardsOutsideFigure: 0,
  cardsDatedAfterThisMonth: 0,
  fixedSeries: { detected: 0, counted: 0, onCard: 0, lapsed: 0, uncounted: 0, noCashAccount: 0 },
} as SpendingPlanDisclosures;

function overspentPlan(): SpendingPlan {
  return {
    overspent: true,
    leftToSpendCents: -308533,
    patternIncomeCents: 1_000_000,
    fixedExpensesCents: 1_200_000,
    plannedSavingsCents: 108_533,
    scheduledFixed: [],
  } as unknown as SpendingPlan;
}

function positivePlan(): SpendingPlan {
  return {
    overspent: false,
    leftToSpendCents: 180_328,
    patternIncomeCents: 1_000_000,
    fixedExpensesCents: 700_000,
    plannedSavingsCents: 119_672,
    scheduledFixed: [],
  } as unknown as SpendingPlan;
}

describe('SafeToSpendCard — over-plan is the pattern remainder, not this-month spend', () => {
  it('test_regression__overplan_copy_does_not_claim_this_month_spend', () => {
    render(<SafeToSpendCard plan={overspentPlan()} disclosures={disclosures} />);
    const card = screen.getByTestId('dashboard-safe-to-spend');
    const text = card.textContent ?? '';
    expect(text).not.toMatch(/this month/i);
    expect(text).not.toContain('guilt-free is $0');
    expect(text).toContain('$3,085.33');
    expect(text).toMatch(/income pattern/i);
    expect(text).toMatch(/fixed costs and savings/i);
    expect(screen.getByTestId('dashboard-safe-to-spend-amount').textContent).toMatch(/Over plan by \$3,085\.33/);
  });

  it('test_regression__positive_safe_to_spend_copy_does_not_claim_this_month_spend', () => {
    render(<SafeToSpendCard plan={positivePlan()} disclosures={disclosures} />);
    const card = screen.getByTestId('dashboard-safe-to-spend');
    const text = card.textContent ?? '';
    expect(text).not.toMatch(/this month/i);
    expect(text).not.toContain('this month, after fixed');
    expect(text).toMatch(/monthly allocation after fixed costs/i);
    expect(screen.getByTestId('dashboard-safe-to-spend-amount').textContent).toContain('$1,803.28');
  });

  it('test_regression__spending_plan_hero_headers_drop_this_month', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/app/(app)/spending-plan/page.tsx'),
      'utf8',
    );
    expect(src).not.toContain('Over plan this month');
    expect(src).not.toContain('Guilt-free to spend this month');
    expect(src).toContain("{positive ? 'Guilt-free to spend' : 'Over plan'}");
    expect(src).toContain('Your income pattern is more than spoken for by fixed costs and savings');
  });
});
