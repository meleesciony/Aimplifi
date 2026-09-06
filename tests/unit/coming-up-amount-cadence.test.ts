/**
 * Coming up amount + cadence without leaving for Spending plan (DECISIONS #679).
 *
 * BillAmountControl / BillCadenceControl lived on Fixed and Recurring series
 * (#670/#671). Coming up printed the expected charge as static text, so
 * changing the plan monthly rate or cadence from the next-charge list required
 * leaving for Spending plan or the series row.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Coming up reuses BillAmountControl and BillCadenceControl', () => {
  it('test_regression__household_can_change_coming_up_amount_and_cadence_without_leaving_for_spending_plan', () => {
    const src = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(src).toContain('BillAmountControl');
    expect(src).toContain('BillCadenceControl');
    expect(src).toContain('coming-up-bill-amount');
    expect(src).toContain('coming-up-bill-cadence');
    expect(src).toContain('seriesByMerchant');
    expect(src).toContain('canRenameBills');

    const list = src.indexOf('data-testid="coming-up-list"');
    expect(list).toBeGreaterThan(-1);
    const around = src.slice(list, list + 4500);
    expect(around).toContain('coming-up-bill-amount');
    expect(around).toContain('coming-up-bill-cadence');
    expect(around).toContain('<BillAmountControl');
    expect(around).toContain('<BillCadenceControl');
    expect(around).toContain('comingUpBillKey');
  });
});
