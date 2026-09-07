/**
 * Categories on Inbox without leaving for Settings (DECISIONS #704).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inbox mounts category managers', () => {
  it('test_regression__household_can_manage_categories_from_inbox_without_leaving_for_settings', () => {
    const page = readFileSync(resolve('src/app/(app)/triage/page.tsx'), 'utf8');
    expect(page).toContain('CustomCategoryManager');
    expect(page).toContain('CategoryManager');
    expect(page).toContain('inbox-categories-card');
    expect(page).toContain('getCategoryCatalog');
    expect(page).toContain('getCustomCategories');
  });
});
