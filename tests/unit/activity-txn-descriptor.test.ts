/**
 * Activity register bank-text write without opening detail (DECISIONS #652).
 *
 * Bank-text write lived on detail, Home, and Inbox (TxnDescriptorControl +
 * updateTransactionDescriptor; rematch #618). Activity forced detail for bank
 * text. Same writer — compact idle "Bank text". Demo fenced via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnDescriptorControl', () => {
  it('test_regression__household_can_change_the_bank_text_on_an_activity_charge_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnDescriptorControl');
    expect(list).toContain("from '@/components/finance/txn-descriptor-form'");
    expect(list).toContain('triggerTestId="activity-descriptor"');
    expect(list).toContain('compact');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('t.rawDescriptor');

    const form = readFileSync(resolve('src/components/finance/txn-descriptor-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionDescriptor');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-descriptor-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
  });
});
