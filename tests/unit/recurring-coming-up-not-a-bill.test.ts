/**
 * Recurring Coming up can mark Not a bill (DECISIONS #674).
 *
 * markMerchantNotABill lived on series rows and Spending plan Fixed (#673).
 * Coming up had Paid this cycle and rename but no detection verdict, so a
 * false next-charge still required hunting the cadence list. Same writer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Recurring Coming up reuses NotABillButton', () => {
  it('test_regression__household_can_mark_not_a_bill_from_recurring_coming_up', () => {
    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('coming-up-list');
    expect(view).toContain('NotABillButton');
    expect(view).toContain('triggerTestId="coming-up-not-a-bill"');
    expect(view).toContain('canRenameBills');

    const coming = view.slice(view.indexOf('coming-up-list'));
    expect(coming).toContain('<NotABillButton');
    expect(coming).toContain('merchantCanonical={o.merchantCanonical}');

    const actions = readFileSync(resolve('src/server/recurring-override-actions.ts'), 'utf8');
    expect(actions).toContain('markMerchantNotABill');
    expect(actions).toContain('isDemoUser');
  });
});
