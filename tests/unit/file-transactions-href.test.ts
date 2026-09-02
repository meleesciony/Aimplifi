/**
 * Spending plan and Rules sent "file / needs a category" to Inbox.
 * Inbox is needsReview merchant groups. The work queue is Activity.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_NEEDS_FILE_HREF } from '@/lib/copy/home-needs-file-copy';

describe('File-transactions links go to Needs a category (DECISIONS #548)', () => {
  it('test_regression__file_transactions_opens_needs_a_category_not_inbox', () => {
    expect(HOME_NEEDS_FILE_HREF).toBe('/transactions?unclassified=1');

    const plan = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(plan).toContain('HOME_NEEDS_FILE_HREF');
    expect(plan).toContain('File transactions');
    expect(plan).not.toMatch(/href="\/triage"/);

    const rules = readFileSync(resolve('src/app/(app)/rules/page.tsx'), 'utf8');
    expect(rules).toContain('HOME_NEEDS_FILE_HREF');
    expect(rules).not.toMatch(/groups what still needs a category/);
    expect(rules).toMatch(/lists rows with no category/);
  });
});
