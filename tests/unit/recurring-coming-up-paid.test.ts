/**
 * Recurring Coming up list can mark Paid this cycle (DECISIONS #661).
 *
 * recordRepeatingBillPaidThisCycle already lived on each series row. Coming up
 * (next 30 days) printed the next charge with no lever, so a household looking
 * at "expected today" had to hunt the cadence list. Same writer. Demo fenced
 * in the action.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring Coming up reuses Paid this cycle', () => {
  it('test_regression__household_can_mark_paid_this_cycle_from_recurring_coming_up', () => {
    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('coming-up-list');
    expect(view).toContain('PaidThisCycleButton');
    expect(view).toContain('coming-up-paid-this-cycle-status');
    expect(view).toContain('paidThisCycleByMerchant');
    // Mounted inside the Coming up map, not only on series rows.
    const coming = view.slice(view.indexOf('coming-up-list'));
    expect(coming).toContain('<PaidThisCycleButton');
    expect(coming).toContain('merchantCanonical={o.merchantCanonical}');

    const actions = readFileSync(resolve('src/server/recurring-override-actions.ts'), 'utf8');
    expect(actions).toContain('recordRepeatingBillPaidThisCycle');
    expect(actions).toContain('isDemoUser');
  });
});
