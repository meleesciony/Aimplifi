/**
 * Recurring: take a repeating bill off the Spending plan without leaving (DECISIONS #730).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring mounts TakeBillOffPlanButton', () => {
  it('test_regression__household_can_take_bill_off_plan_from_recurring_without_leaving_for_spending_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/recurring/page.tsx'), 'utf8');
    expect(page).toContain('takeOffBillKeys');
    expect(page).toContain('fixedList.lines');

    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('TakeBillOffPlanButton');
    expect(view).toContain('recurring-take-off-plan');
    expect(view).toContain('takeOffBillKeys');

    const actions = readFileSync(resolve('src/server/bill-rename-actions.ts'), 'utf8');
    expect(actions).toContain('takeRepeatingBillOffPlan');
    expect(actions).toContain("revalidatePath('/recurring')");
  });
});
