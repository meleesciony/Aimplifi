/**
 * Built-in categories on Rules without leaving for Settings (DECISIONS #701).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Rules mounts CategoryManager', () => {
  it('test_regression__household_can_manage_built_in_categories_from_rules_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/rules/page.tsx'), 'utf8');
    expect(page).toContain('CategoryManager');
    expect(page).toContain('rules-categories-card');
    expect(page).toContain('getCategoryCatalog');
    const actions = readFileSync(resolve('src/server/category-actions.ts'), 'utf8');
    expect(actions).toContain("revalidatePath('/rules')");
  });
});
