/**
 * Recurring: put a taken-off bill back on the Spending plan without leaving (DECISIONS #731).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring mounts PutBillBackOnPlanButton', () => {
  it('test_regression__household_can_put_bill_back_on_plan_from_recurring_without_leaving_for_spending_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/recurring/page.tsx'), 'utf8');
    expect(page).toContain('billsTakenOff');
    expect(page).toContain('getSpendingPlan');

    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('PutBillBackOnPlanButton');
    expect(view).toContain('recurring-bills-taken-off');
    expect(view).toContain('billsTakenOff');

    const actions = readFileSync(resolve('src/server/bill-rename-actions.ts'), 'utf8');
    expect(actions).toContain('putRepeatingBillBackOnPlan');
    expect(actions).toContain("revalidatePath('/recurring')");
  });
});
