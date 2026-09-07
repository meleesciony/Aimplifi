/**
 * Custom categories on Budgets without leaving for Settings (DECISIONS #691).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Budgets mounts CustomCategoryManager', () => {
  it('test_regression__household_can_manage_custom_categories_from_budgets_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/budgets/page.tsx'), 'utf8');
    expect(page).toContain('CustomCategoryManager');
    expect(page).toContain('budgets-custom-categories-card');
    expect(page).toContain('getCustomCategories');
  });
});
