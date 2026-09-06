/**
 * Recurring series can change monthly amount without leaving for Spending plan (DECISIONS #670).
 *
 * updateBillAmount lived on Spending plan Fixed rows only and refused keys not
 * already on the Fixed list. Recurring printed charge magnitude as static text.
 * Same BillAmount overlay. Ownership widened to Fixed list OR live expense
 * series (loans still refused on the Fixed list). Revalidate /recurring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring reuses BillAmountControl', () => {
  it('test_regression__household_can_change_a_recurring_monthly_amount_without_leaving_for_spending_plan', () => {
    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('BillAmountControl');
    expect(view).toContain("from '@/components/finance/bill-amount-form'");
    expect(view).toContain('amountTestId="recurring-bill-amount"');
    expect(view).toContain('canRenameBills');
    expect(view).toContain('billAmounts');
    expect(view).toContain('!item.isIncome');

    const server = readFileSync(resolve('src/server/recurring.ts'), 'utf8');
    expect(server).toContain('billAmounts: Record<string, number>');
    expect(server).toContain('getBillAmounts');

    const actions = readFileSync(resolve('src/server/bill-amount-actions.ts'), 'utf8');
    expect(actions).toContain('householdOwnsBillAmountKey');
    expect(actions).toContain('getRecurring');
    expect(actions).toContain("revalidatePath('/recurring')");
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
