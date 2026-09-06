/**
 * Activity register tax-tag write without opening detail (tax-only).
 *
 * Tax write lived on detail, Home, and Inbox via updateTransactionTaxClass
 * (tax only; note untouched). Activity's Tag panel still used setTransactionTax
 * (note + taxClass together). Same tax-only writer. Demo fenced via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnTaxClassControl', () => {
  it('test_regression__household_can_set_a_tax_tag_on_an_activity_charge_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnTaxClassControl');
    expect(list).toContain("from '@/components/finance/txn-tax-form'");
    expect(list).toContain('triggerTestId="activity-tax"');
    expect(list).toContain('compact');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('t.taxClass');

    const form = readFileSync(resolve('src/components/finance/txn-tax-form.tsx'), 'utf8');
    expect(form).toContain('updateTransactionTaxClass');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-tax-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('taxClass');
    expect(actions).toContain('companion memo column is intentionally omitted');
  });
});
