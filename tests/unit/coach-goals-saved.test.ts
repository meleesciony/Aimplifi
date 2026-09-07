/**
 * Coach: rename + edit already-saved, target, monthly, and target date on savings
 * goals without leaving for Goals (DECISIONS #716, #719, #720, #721, #722).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coach mounts savings-goal writers for ordinary savings goals', () => {
  it('test_regression__household_can_edit_already_saved_from_coach_without_leaving_for_goals', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('GoalSavedControl');
    expect(page).toContain('coach-goals-saved-card');
    expect(page).toContain('kind: null');
    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/coach')");
  });

  it('test_regression__household_can_edit_goal_target_from_coach_without_leaving_for_goals', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('GoalTargetControl');
    expect(page).toContain('coach-goals-saved-card');
    expect(page).toContain('kind: null');
    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain('updateGoalTarget');
    expect(actions).toContain("revalidatePath('/coach')");
  });

  it('test_regression__household_can_edit_goal_monthly_from_coach_without_leaving_for_goals', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('GoalMonthlyControl');
    expect(page).toContain('monthlyContributionCents');
    expect(page).toContain('coach-goals-saved-card');
    expect(page).toContain('kind: null');
    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain('updateGoalMonthly');
    expect(actions).toContain("revalidatePath('/coach')");
  });

  it('test_regression__household_can_edit_goal_target_date_from_coach_without_leaving_for_goals', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('GoalTargetDateControl');
    expect(page).toContain('targetDate');
    expect(page).toContain('coach-goals-saved-card');
    expect(page).toContain('kind: null');
    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain('updateGoalTargetDate');
    expect(actions).toContain("revalidatePath('/coach')");
  });

  it('test_regression__household_can_rename_goal_from_coach_without_leaving_for_goals', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('GoalNameControl');
    expect(page).toContain('coach-goals-saved-card');
    expect(page).toContain('kind: null');
    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain('renameGoal');
    expect(actions).toContain("revalidatePath('/coach')");
  });
});
