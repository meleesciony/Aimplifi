/**
 * Activity register date write without opening detail (DECISIONS #649).
 *
 * Date write lived on detail, Home, and Inbox (TxnDateControl +
 * updateTransactionDate; rematch #621). Activity grouped by date header and
 * did not expose a per-row date control. Same writer — no second action.
 * Demo fenced via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnDateControl', () => {
  it('test_regression__household_can_change_an_activity_charge_date_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnDateControl');
    expect(list).toContain("from '@/components/finance/txn-date-form'");
    expect(list).toContain('triggerTestId="activity-date"');
    expect(list).toContain('canEditSpendClass');

    const form = readFileSync(resolve('src/components/finance/txn-date-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionDate');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-date-actions.ts'), 'utf8');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
