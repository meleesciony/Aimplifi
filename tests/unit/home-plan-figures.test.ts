/**
 * Home: set plan figures (savings % / income / fixed locks) without leaving for
 * Spending plan (DECISIONS #726). Cash-needed / Safe to Spend read those dials.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home mounts PlanFiguresForm', () => {
  it('test_regression__household_can_edit_plan_figures_from_home_without_leaving_for_spending_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('PlanFiguresForm');
    expect(page).toContain('home-plan-figures');
    expect(page).toContain('SafeToSpendCard');
    const actions = readFileSync(resolve('src/server/plan-override-actions.ts'), 'utf8');
    expect(actions).toContain('updatePlanFigures');
    expect(actions).toContain("revalidatePath('/dashboard')");
  });
});
