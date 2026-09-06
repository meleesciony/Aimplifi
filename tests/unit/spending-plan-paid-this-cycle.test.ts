/**
 * Spending plan Fixed list can mark Paid this cycle (DECISIONS #669).
 *
 * recordRepeatingBillPaidThisCycle lived on Recurring series and Coming up.
 * The Fixed composition listed named bills with rename/amount/cadence/off-plan
 * but no Paid lever, so a household standing on the plan had to leave for
 * Recurring. Same writer. Demo fenced via canEditFigures. Named payee only
 * (unnamed bills have no merchantCanonical for the writer).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Spending plan Fixed list reuses Paid this cycle', () => {
  it('test_regression__household_can_mark_paid_this_cycle_from_spending_plan_fixed_list', () => {
    const page = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(page).toContain('PaidThisCycleButton');
    expect(page).toContain("from '@/components/finance/recurring-verdict-controls'");
    expect(page).toContain('fixed-composition-paid-this-cycle-status');
    expect(page).toContain('canEditFigures');
    expect(page).toContain('l.merchantCanonical');
    expect(page).toContain('l.paidThisCycle');

    const fixed = page.slice(page.indexOf('fixed-composition'));
    expect(fixed).toContain('<PaidThisCycleButton');
    expect(fixed).toContain('merchantCanonical={l.merchantCanonical}');

    const lines = readFileSync(resolve('src/lib/engine/spending-plan/fixed-line-items.ts'), 'utf8');
    expect(lines).toContain('paidThisCycle?: boolean');
    expect(lines).toContain('merchantCanonical?: string | null');
    expect(lines).toContain('paidThisCycle: r.paidThisCycle === true');

    const plan = readFileSync(resolve('src/lib/engine/spending-plan/plan.ts'), 'utf8');
    expect(plan).toContain('paidThisCycle?: boolean');
    expect(plan).toContain('paidThisCycle: s.paidThisCycle === true');

    const server = readFileSync(resolve('src/server/spending-plan.ts'), 'utf8');
    expect(server).toContain('paidThisCycle: s.paidThisCycle === true');

    const actions = readFileSync(resolve('src/server/recurring-override-actions.ts'), 'utf8');
    expect(actions).toContain('recordRepeatingBillPaidThisCycle');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain("revalidatePath('/spending-plan')");
  });
});
