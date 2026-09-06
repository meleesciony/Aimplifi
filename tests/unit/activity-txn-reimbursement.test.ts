/**
 * Activity register reimbursement without opening detail (DECISIONS #668).
 *
 * setReimbursement lived in the Activity action menu and on Home/Inbox list
 * controls. Activity register had no inline reimbursement beside note/tax.
 * Same writer. Demo fenced via canEditSpendClass. Outflows only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnReimbursementControl', () => {
  it('test_regression__household_can_track_reimbursement_on_an_activity_charge_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnReimbursementControl');
    expect(list).toContain("from '@/components/finance/txn-reimbursement-form'");
    expect(list).toContain('triggerTestId="activity-reimbursement"');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('t.reimbursement');
    expect(list).toContain('t.amountCents < 0');

    const form = readFileSync(resolve('src/components/finance/txn-reimbursement-form.tsx'), 'utf8');
    expect(form).toContain('setReimbursement');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-flags-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
