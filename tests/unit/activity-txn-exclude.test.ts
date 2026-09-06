/**
 * Activity register exclude-from-totals without opening detail (DECISIONS #665).
 *
 * setExcludeFromTotals lived in the Activity action menu and on Home/Inbox
 * list controls. Activity register had no inline Exclude control beside note/tax.
 * Same writer. Demo fenced via canEditSpendClass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Activity register reuses TxnExcludeControl', () => {
  it('test_regression__household_can_exclude_an_activity_charge_from_totals_without_opening_detail', () => {
    const list = readFileSync(resolve('src/components/finance/transaction-list.tsx'), 'utf8');
    expect(list).toContain('TxnExcludeControl');
    expect(list).toContain("from '@/components/finance/txn-exclude-form'");
    expect(list).toContain('triggerTestId="activity-exclude"');
    expect(list).toContain('canEditSpendClass');
    expect(list).toContain('t.excludeFromTotals');

    const form = readFileSync(resolve('src/components/finance/txn-exclude-form.tsx'), 'utf8');
    expect(form).toContain('setExcludeFromTotals');
    expect(form).toContain('exclude: !excluded');
    expect(form).not.toContain('useActionState');

    const actions = readFileSync(resolve('src/server/transaction-flags-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
  });
});
