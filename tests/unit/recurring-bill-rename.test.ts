/**
 * Recurring / Subscriptions display rename without a dead-end flow (DECISIONS #658).
 *
 * Spending plan already had BillNameControl + renameBill. Recurring printed
 * merchantCanonical as a filter Link only, and renameBill refused any key that
 * was not already on the Fixed list — so a household standing on Recurring
 * could not name what they were looking at. Same BillRename overlay — dollars
 * and detection identity stay put. Demo fenced.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { billRenameKey, namedBillLabel } from '@/lib/engine/spending-plan/bill-rename';

describe('Recurring reuses the spending-plan bill name overlay', () => {
  it('test_regression__household_can_rename_a_recurring_display_name_without_a_dead_end', () => {
    const view = readFileSync(resolve('src/components/finance/recurring-view.tsx'), 'utf8');
    expect(view).toContain('BillNameControl');
    expect(view).toContain("from '@/components/finance/rename-bill-form'");
    expect(view).toContain('canRenameBills');
    expect(view).toContain('billRenameKey');
    expect(view).toContain('namedBillLabel');
    expect(view).toContain('labelTestId="recurring-bill-name"');
    expect(view).not.toContain('renameBill(');

    const page = readFileSync(resolve('src/app/(app)/recurring/page.tsx'), 'utf8');
    expect(page).toContain('canRenameBills={!isDemoUser(userId)}');

    const loader = readFileSync(resolve('src/server/recurring.ts'), 'utf8');
    expect(loader).toContain('getBillRenames');
    expect(loader).toContain('billNames');

    const actions = readFileSync(resolve('src/server/bill-rename-actions.ts'), 'utf8');
    expect(actions).toContain('householdOwnsBillKey');
    expect(actions).toContain('getRecurring');
    expect(actions).toContain("revalidatePath('/recurring')");
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');

    const control = readFileSync(resolve('src/components/finance/rename-bill-form.tsx'), 'utf8');
    expect(control).toContain('renameBill');
    expect(control).toContain('clearBillName');
    expect(control).not.toContain('useActionState');
  });
});

describe('Recurring overlay wins without rewriting detection identity', () => {
  it('test_regression__recurring_bill_overlay_wins_without_rewriting_canonical', () => {
    const item = {
      merchantCanonical: 'Netflix',
      categoryId: 'entertainment',
      cadence: 'MONTHLY',
    };
    const key = billRenameKey(item);
    const names = new Map([[key, 'Streaming']]);
    expect(namedBillLabel(item, names, () => 'Entertainment')).toBe('Streaming');
    expect(namedBillLabel(item, new Map(), () => 'Entertainment')).toBe('Netflix');
    expect(item.merchantCanonical).toBe('Netflix');
    expect(key).toBe('Netflix');
  });
});
