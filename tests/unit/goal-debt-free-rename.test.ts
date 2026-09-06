/**
 * Debt-free goal rename on /goals (DECISIONS #653).
 *
 * Savings goals already used GoalNameControl + renameGoal. Debt-free cards
 * printed the name as text, and renameGoal refused kind !== null. Same writer
 * — allow debt_free (still refuse reserves). Demo fenced.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Debt-free goals reuse GoalNameControl', () => {
  it('test_regression__household_can_rename_a_debt_free_goal_without_opening_a_separate_flow', () => {
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    const debtStart = page.indexOf("goal.kind === 'debt_free'");
    expect(debtStart).toBeGreaterThan(-1);
    const debtBlock = page.slice(debtStart, debtStart + 1200);
    expect(debtBlock).toContain('GoalNameControl');
    expect(debtBlock).toContain('goal.name');

    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    const renameStart = actions.indexOf('export async function renameGoal');
    expect(renameStart).toBeGreaterThan(-1);
    const renameBlock = actions.slice(renameStart, renameStart + 900);
    expect(renameBlock).toContain('RESERVE_KIND');
    expect(renameBlock).toContain('kind: null');
    expect(renameBlock).toContain('isDemoUser');
    // Must not be savings-only kind: null alone on the updateMany where.
    expect(renameBlock).toMatch(/OR:\s*\[\s*\{\s*kind:\s*null\s*\}/);
  });
});
