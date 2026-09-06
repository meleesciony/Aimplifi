/**
 * Goals Debt Freedom planner can save a debt-free goal (DECISIONS #660).
 *
 * saveDebtFreeGoal already lived on Ask. The planner printed a debt-free date
 * with no save control, so a household standing on Goals had a dead-end what-if.
 * Same writer — monthly contribution re-solved server-side. Demo fenced.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Debt Freedom planner reuses saveDebtFreeGoal', () => {
  it('test_regression__household_can_save_a_debt_free_goal_from_the_goals_planner', () => {
    const planner = readFileSync(resolve('src/components/finance/debt-freedom-planner.tsx'), 'utf8');
    expect(planner).toContain('saveDebtFreeGoal');
    expect(planner).toContain('canSaveGoal');
    expect(planner).toContain('data-testid="debt-planner-save-goal"');
    expect(planner).toContain('heroTargetDate');
    expect(planner).not.toContain('useActionState');

    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('canSaveGoal={!isDemoUser(session.user.id)}');

    const actions = readFileSync(resolve('src/server/goal-actions.ts'), 'utf8');
    expect(actions).toContain('export async function saveDebtFreeGoal');
    // Demo fence on the writer (defense in depth).
    const body = actions.slice(actions.indexOf('export async function saveDebtFreeGoal'));
    expect(body.slice(0, 350)).toContain('isDemoUser');
    expect(body.slice(0, 350)).toContain('DEMO_ENTRY_BLOCKED');
  });
});
