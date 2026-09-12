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
    // Slice each function's REAL extent (to the next export), not a magic byte
    // window: GL.5 grew updateGoalTargetDate past any fixed window, and a window
    // can both false-negative (here) and bleed into the next export (false-positive).
    const fnBlock = (fn: string): string => {
      const start = actions.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const next = actions.indexOf('\nexport ', start + 1);
      return actions.slice(start, next === -1 ? actions.length : next);
    };
    for (const fn of ['updateGoalTarget', 'updateGoalMonthly', 'updateGoalTargetDate', 'clearGoalMonthly', 'clearGoalTargetDate']) {
      const block = fnBlock(fn);
      expect(block).toMatch(/OR:\s*\[\s*\{\s*kind:\s*null\s*\}/);
      expect(block).toContain('RESERVE_KIND');
    }
    // already-saved stays savings-only
    const savedBlock = fnBlock('updateGoalSaved');
    expect(savedBlock).toContain('where: { id, userId, kind: null }');
    expect(savedBlock).not.toMatch(/OR:\s*\[/);
  });
});
