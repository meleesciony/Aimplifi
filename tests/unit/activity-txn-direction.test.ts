/**
 * Activity register in/out flip without opening detail (DECISIONS #650).
 *
 * Direction flip lived on detail, Home, and Inbox (TxnDirectionControl +
 * flipTransactionDirection; rematch #619). Activity had amount write but no
 * flip. Same writer — no second action. Split pieces stay without a flip.
 * Demo fenced via canEditSpendClass. Not a transfer toggle.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnDirectionControl', () => {
  it('test_regression__household_can_flip_an_activity_charge_in_or_out_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnDirectionControl');
    expect(list).toContain("from '@/components/finance/txn-direction-form'");
    expect(list).toContain('flipTestId="activity-direction"');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('!t.splitParentId');

    const form = readFileSync(resolve('src/components/finance/txn-direction-form.tsx'), 'utf8');
    expect(form).toContain('flipTransactionDirection');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-amount-actions.ts'), 'utf8');
    expect(actions).toContain('flipTransactionDirection');
    expect(actions).toContain('rematchAfterTxnWrite');
    expect(actions).toContain('isDemoUser');
  });
});
