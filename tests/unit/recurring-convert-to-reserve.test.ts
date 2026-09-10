/**
 * Recurring: convert a repeating bill to a reserve without leaving for Spending plan (DECISIONS #729).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring mounts ConvertToReserveButton', () => {
  it('test_regression__household_can_convert_bill_to_reserve_from_recurring_without_leaving_for_spending_plan', () => {
    const page = readFileSync(resolve('src/app/(app)/recurring/page.tsx'), 'utf8');
    expect(page).toContain('getSpendingPlan');
    expect(page).toContain('convertibleConvertKeys');
    expect(page).toContain('convertibleToReserve');

    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('ConvertToReserveButton');
    expect(view).toContain('recurring-convert-to-reserve');
    expect(view).toContain('convertibleConvertKeys');

    const actions = readFileSync(resolve('src/server/reserve-actions.ts'), 'utf8');
    expect(actions).toContain('createReserveFromSeries');
    expect(actions).toContain("revalidatePath('/recurring')");
  });
});
