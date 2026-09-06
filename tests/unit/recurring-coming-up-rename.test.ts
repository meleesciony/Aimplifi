/**
 * Recurring Coming up can rename display name inline (DECISIONS #672).
 *
 * BillNameControl lived on series rows (#658). Coming up printed the overlay
 * name inside a merchant Filter link only, so renaming from the next-charge
 * list required hunting the cadence list. Same renameBill writer. Keep a
 * sibling Filter link for the merchant register (same coexistence as Activity #662).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring Coming up reuses BillNameControl', () => {
  it('test_regression__household_can_rename_a_recurring_coming_up_display_name_without_a_dead_end', () => {
    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('coming-up-list');
    expect(view).toContain('BillNameControl');
    expect(view).toContain('labelTestId="coming-up-bill-name"');
    expect(view).toContain('coming-up-merchant-filter');
    expect(view).toContain('canRenameBills');

    const coming = view.slice(view.indexOf('coming-up-list'));
    expect(coming).toContain('<BillNameControl');
    expect(coming).toContain('billRenameKey(o)');
    expect(coming).toContain('coming-up-merchant-filter');

    const actions = readFileSync(resolve('src/server/bill-rename-actions.ts'), 'utf8');
    expect(actions).toContain('renameBill');
    expect(actions).toContain('householdOwnsBillKey');
    expect(actions).toContain('isDemoUser');
  });
});
