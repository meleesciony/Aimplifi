/**
 * Reserve holding account from Spending plan without leaving for Settings (DECISIONS #699).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Spending plan mounts HoldingAccountPicker', () => {
  it('test_regression__household_can_set_reserve_holding_account_from_spending_plan_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('HoldingAccountPicker');
    expect(page).toContain('spending-plan-holding-account');
    const actions = readFileSync(resolve('src/server/reserve-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/spending-plan')");
  });
});
