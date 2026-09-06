/**
 * Debt-free goal target / date / monthly writes on /goals.
 *
 * Those writers were savings-only (kind: null). Debt-free cards printed
 * target/date as text and suggested monthly as prose. Same controls as
 * savings — reserves still refused; already-saved stays savings-only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Debt-free goals reuse target/date/monthly controls', () => {
  it('test_regression__household_can_edit_debt_free_goal_target_date_and_monthly_without_a_separate_flow', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    const debtStart = page.indexOf("goal.kind === 'debt_free'");
    expect(debtStart).toBeGreaterThan(-1);
    const debtBlock = page.slice(debtStart, debtStart + 1800);
    expect(debtBlock).toContain('GoalTargetControl');
    expect(debtBlock).toContain('GoalTargetDateControl');
    expect(debtBlock).toContain('GoalMonthlyControl');
    expect(debtBlock).not.toContain('GoalSavedControl');

    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    for (const fn of ['updateGoalTarget', 'updateGoalMonthly', 'updateGoalTargetDate', 'clearGoalMonthly', 'clearGoalTargetDate']) {
      const start = actions.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const block = actions.slice(start, start + 1100);
      expect(block).toMatch(/OR:\s*\[\s*\{\s*kind:\s*null\s*\}/);
      expect(block).toContain('RESERVE_KIND');
    }
    // already-saved stays savings-only
    const savedStart = actions.indexOf('export async function updateGoalSaved');
    const savedBlock = actions.slice(savedStart, savedStart + 900);
    expect(savedBlock).toContain('where: { id, userId, kind: null }');
    expect(savedBlock).not.toMatch(/OR:\s*\[/);
  });
});
