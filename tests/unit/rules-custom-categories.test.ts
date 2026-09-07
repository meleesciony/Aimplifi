/**
 * Custom categories on Rules without leaving for Settings (DECISIONS #702).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Rules mounts CustomCategoryManager', () => {
  it('test_regression__household_can_manage_custom_categories_from_rules_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/rules/page.tsx'), 'utf8');
    expect(page).toContain('CustomCategoryManager');
    expect(page).toContain('rules-custom-categories');
    expect(page).toContain('getCustomCategories');
    const actions = readFileSync(resolve('src/server/custom-category-actions.ts'), 'utf8');
    expect(actions).toContain("'/rules'");
  });
});
