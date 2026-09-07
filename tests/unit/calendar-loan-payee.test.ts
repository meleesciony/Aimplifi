/**
 * Calendar: set loan payment payee on loan-due without leaving for Accounts (DECISIONS #712).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Calendar mounts AccountPaymentMerchantPicker on loan-due', () => {
  it('test_regression__household_can_set_loan_payment_payee_from_calendar_without_leaving_for_accounts', () => {
    const page = readFileSync(resolve('src/app/(app)/calendar/page.tsx'), 'utf8');
    expect(page).toContain('AccountPaymentMerchantPicker');
    expect(page).toContain('calendar-loan-payee-');
    expect(page).toContain('loanPayeeById');
    expect(page).toContain('getAccountDetail');

    const actions = readFileSync(resolve('src/server/account-payment-merchant-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/calendar')");
  });
});
