/**
 * Recurring series can change cadence without leaving for Spending plan (DECISIONS #671).
 *
 * updateBillCadence lived on Spending plan Fixed rows only. Recurring had
 * BillAmountControl (#670) but still printed static cadence for household rows.
 * Same BillCadence overlay. Ownership widened like amount/rename.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring reuses BillCadenceControl', () => {
  it('test_regression__household_can_change_a_recurring_cadence_without_leaving_for_spending_plan', () => {
    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('BillCadenceControl');
    expect(view).toContain("from '@/components/finance/bill-cadence-form'");
    expect(view).toContain('cadenceTestId="recurring-bill-cadence"');
    expect(view).toContain('canRenameBills');
    expect(view).toContain('billCadences');
    expect(view).toContain('!item.isIncome');

    const server = readFileSync(resolve('src/server/recurring.ts'), 'utf8');
    expect(server).toContain('billCadences: Record<string, string>');
    expect(server).toContain('getBillCadences');

    const actions = readFileSync(resolve('src/server/bill-cadence-actions.ts'), 'utf8');
    expect(actions).toContain('householdOwnsBillCadenceKey');
    expect(actions).toContain('getRecurring');
    expect(actions).toContain("revalidatePath('/recurring')");
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
