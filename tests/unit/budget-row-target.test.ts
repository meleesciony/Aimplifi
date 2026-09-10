/**
 * Budgets By-category row target write without a separate form (DECISIONS #659).
 *
 * setBudget / clearBudget already lived behind the bottom "Set a monthly target"
 * card. The By-category list printed " / $X" as static text, so changing an
 * existing target required leaving the row. Same writers — no second action.
 * Demo fenced via canEdit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Budgets By-category row reuses setBudget', () => {
  it('test_regression__household_can_change_a_budget_target_on_the_category_row', () => {
    const page = readFileSync(resolve('src/app/(app)/budgets/page.tsx'), 'utf8');
    expect(page).toContain('BudgetRowTargetControl');
    expect(page).toContain("from '@/components/finance/budget-row-target-form'");
    expect(page).toContain('canEdit');
    expect(page).toContain('budgetCents={row.budgetCents}');

    const control = readFileSync(resolve('src/components/finance/budget-row-target-form.tsx'), 'utf8');
    expect(control).toContain('setBudget');
    expect(control).toContain('clearBudget');
    expect(control).toContain('fd.set(\'categoryId\'');
    expect(control).not.toContain('useActionState');
    // Clear is inside the editing form, not the collapsed target. Specs that
    // look for budget-clear-* on the idle row will miss it (CI 34511385651).
    const clearIdx = control.indexOf('data-testid={`budget-clear-${categoryId}`}');
    const editingIdx = control.indexOf('if (!editing)');
    expect(clearIdx).toBeGreaterThan(editingIdx);

    const actions = readFileSync(resolve('src/server/budget-actions.ts'), 'utf8');
    expect(actions).toContain('isDemoUser');
    expect(actions).toContain('DEMO_ENTRY_BLOCKED');
    expect(actions).toContain('parseBudgetTargetCents');
  });
});
