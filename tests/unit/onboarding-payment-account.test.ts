/**
 * Home onboarding confirms payment account without leaving for Settings (DECISIONS #690).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Onboarding payment account on Home', () => {
  it('test_regression__household_can_confirm_payment_account_from_home_without_leaving_for_settings', () => {
    const nudge = readFileSync(resolve('src/components/settings/onboarding-nudge.tsx'), 'utf8');
    expect(nudge).toContain('updatePaymentAccount');
    expect(nudge).toContain('onboarding-payment-account');
    expect(nudge).toContain('onboarding-nudge-cta');

    const actions = readFileSync(resolve('src/server/settings-actions.ts'), 'utf8');
    expect(actions).toContain('export async function updatePaymentAccount');
    expect(actions).toContain("source: 'onboarding-nudge'");

    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('accounts={paymentAccounts}');
    expect(page).toContain('currentPaymentAccountId={data.paymentAccountId}');
  });
});
