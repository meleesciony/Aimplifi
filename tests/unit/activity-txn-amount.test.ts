/**
 * Activity register amount write without opening detail (DECISIONS #648).
 *
 * Amount write lived on detail, Home, and Inbox (TxnAmountControl +
 * updateTransactionAmount; rematch #620). Activity printed formatCents as
 * static text. Same writer — no second action. Split pieces stay display-only
 * (server refuses). Demo fenced via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnAmountControl', () => {
  it('test_regression__household_can_change_an_activity_charge_amount_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnAmountControl');
    expect(list).toContain("from '@/components/finance/txn-amount-form'");
    expect(list).toContain('triggerTestId="activity-amount"');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('!t.splitParentId');

    const form = readFileSync(resolve('src/components/finance/txn-amount-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionAmount');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-amount-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('splitParentId');
  });
});
