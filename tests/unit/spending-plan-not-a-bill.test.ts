/**
 * Spending plan Fixed list can mark Not a bill / Not recurring (DECISIONS #673).
 *
 * markMerchantNotABill lived on Recurring series rows. Spending plan Fixed had
 * Take off plan (BillOffPlan overlay) and Paid this cycle, but no detection
 * verdict lever — a false detection still required leaving for Recurring.
 * Same writer. Named payee only. Demo fenced via canEditFigures.
 * Distinct from TakeBillOffPlan (plan overlay vs NOT_BILL detection override).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Spending plan Fixed list reuses NotABillButton', () => {
  it('test_regression__household_can_mark_not_a_bill_from_spending_plan_fixed_list', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('NotABillButton');
    expect(page).toContain("from '@/components/finance/recurring-verdict-controls'");
    expect(page).toContain('triggerTestId="fixed-composition-not-a-bill"');
    expect(page).toContain('canEditFigures');
    expect(page).toContain('l.merchantCanonical');
    expect(page).toContain('TakeBillOffPlanButton');

    const fixed = page.slice(page.indexOf('fixed-composition'));
    expect(fixed).toContain('<NotABillButton');
    expect(fixed).toContain('merchantCanonical={l.merchantCanonical}');

    const control = readFileSync(resolve('src/components/finance/recurring-verdict-controls.tsx'), 'utf8');
    expect(control).toContain('markMerchantNotABill');
    expect(control).toContain('triggerTestId');

    const actions = readFileSync(resolve('src/server/recurring-override-actions.ts'), 'utf8');
    expect(actions).toContain('markMerchantNotABill');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain("revalidatePath('/spending-plan')");
  });
});
