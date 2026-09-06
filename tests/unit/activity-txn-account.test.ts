/**
 * Activity register account write without opening detail (DECISIONS #651).
 *
 * Account write lived on detail, Home, and Inbox (TxnAccountControl +
 * updateTransactionAccount; rematch #622). Activity printed accountName as
 * text. Same writer — no second action. Split pieces stay text. Demo fenced
 * via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnAccountControl', () => {
  it('test_regression__household_can_change_which_account_an_activity_charge_belongs_to_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnAccountControl');
    expect(list).toContain("from '@/components/finance/txn-account-form'");
    expect(list).toContain('triggerTestId="activity-account"');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('!t.splitParentId');
    expect(list).toContain('accounts');

    const page = readFileSync(resolve('src/app/(app)/transactions/page.tsx'), 'utf8');
    expect(page).toContain('listTxnMoveAccounts');
    expect(page).toContain('accounts={moveAccounts}');

    const form = readFileSync(resolve('src/components/finance/txn-account-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionAccount');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-account-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
  });
});
