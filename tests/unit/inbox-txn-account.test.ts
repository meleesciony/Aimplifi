/**
 * Inbox charge account write without opening detail (DECISIONS #644).
 *
 * Account write already lived on detail and Home (TxnAccountControl +
 * updateTransactionAccount; rematch #622). Inbox printed accountName as
 * text; ReviewRow lacked accountId. Same writer — no second action.
 * Multi-txn groups stay display-only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox reuses TxnAccountControl on single charges', () => {
  it('test_regression__household_can_change_which_account_an_inbox_charge_belongs_to_without_opening_detail', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('TxnAccountControl');
    expect(inbox).toContain("from '@/components/finance/txn-account-form'");
    expect(inbox).toContain('canRenamePayee');
    expect(inbox).toContain('accounts');
    expect(inbox).toContain('triggerTestId="inbox-account"');
    expect(inbox).toContain('triggerTestId="inbox-single-account"');

    const singlesStart = inbox.indexOf("mode === 'singles'");
    expect(singlesStart).toBeGreaterThan(-1);
    const singlesBlock = inbox.slice(singlesStart);
    const singlesMap = singlesBlock.indexOf('top.rows.map');
    expect(singlesMap).toBeGreaterThan(-1);
    const singlesMapBlock = singlesBlock.slice(singlesMap, singlesMap + 4500);
    expect(singlesMapBlock).toContain('<TxnAccountControl');
    expect(singlesMapBlock).toContain('canRenamePayee');

    const page = readFileSync(resolve('src/app/(app)/triage/page.tsx'), 'utf8');
    expect(page).toContain('listTxnMoveAccounts');
    expect(page).toContain('accounts={accounts}');

    const group = readFileSync(resolve('src/lib/engine/categorize/group.ts'), 'utf8');
    expect(group).toContain('accountId: string');
    expect(group).toContain('accountId: m.accountId');

    const triage = readFileSync(resolve('src/server/triage.ts'), 'utf8');
    expect(triage).toContain('accountId: t.accountId');

    const form = readFileSync(resolve('src/components/finance/txn-account-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionAccount');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-account-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
  });
});
