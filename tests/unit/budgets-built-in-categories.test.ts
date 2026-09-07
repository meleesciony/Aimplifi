/**
 * Built-in categories on Budgets without leaving for Settings (DECISIONS #692).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Budgets mounts CategoryManager', () => {
  it('test_regression__household_can_manage_built_in_categories_from_budgets_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/budgets/page.tsx'), 'utf8');
    expect(page).toContain('CategoryManager');
    expect(page).toContain('budgets-categories-card');
    expect(page).toContain('getCategoryCatalog');
    const actions = readFileSync(resolve('src/server/category-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/budgets')");
  });
});
