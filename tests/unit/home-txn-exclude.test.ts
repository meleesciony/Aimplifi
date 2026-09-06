/**
 * Home recent-charge exclude from totals without opening detail (DECISIONS #663).
 *
 * setExcludeFromTotals already lived in the Activity action menu. Home printed
 * no exclude control, so a household standing on Home could not drop a charge
 * from totals without opening detail. Same writer. Demo fenced.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent charges reuse setExcludeFromTotals', () => {
  it('test_regression__household_can_exclude_a_home_recent_charge_from_totals_without_opening_detail', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('TxnExcludeControl');
    expect(card).toContain("from '@/components/finance/txn-exclude-form'");
    expect(card).toContain('triggerTestId="home-recent-exclude"');
    expect(card).toContain('canRenamePayee');
    expect(card).toContain('r.excludeFromTotals');

    const control = readFileSync(resolve('src/components/finance/txn-exclude-form.tsx'), 'utf8');
    expect(control).toContain('setExcludeFromTotals');
    expect(control).toContain('exclude: !excluded');
    expect(control).not.toContain('useActionState');

    const loader = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    expect(loader).toContain('excludeFromTotals');

    const actions = readFileSync(resolve('src/server/transaction-flags-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain("revalidatePath('/dashboard')");
  });
});
