/**
 * Reports and Spending sent Uncategorized to Inbox. Inbox is merchant groups
 * in needsReview. The work queue is Needs a category on Activity.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_NEEDS_FILE_HREF, NEEDS_A_CATEGORY_LINK_LABEL } from '@/lib/copy/home-needs-file-copy';

describe('Uncategorized figures go to Needs a category, not Inbox (DECISIONS #545)', () => {
  it('test_regression__uncategorized_figure_opens_needs_a_category_not_inbox', () => {
    expect(HOME_NEEDS_FILE_HREF).toBe('/transactions?unclassified=1');
    expect(NEEDS_A_CATEGORY_LINK_LABEL).toBe('Needs a category');
    expect(NEEDS_A_CATEGORY_LINK_LABEL).not.toMatch(/Inbox/i);

    const reports = readFileSync(resolve('src/components/finance/reports-view.tsx'), 'utf8');
    expect(reports).toContain('HOME_NEEDS_FILE_HREF');
    expect(reports).toContain('NEEDS_A_CATEGORY_LINK_LABEL');
    expect(reports).not.toMatch(/href="\/triage"/);
    expect(reports).not.toMatch(/review in Inbox/);

    const budgets = readFileSync(resolve('src/app/(app)/budgets/page.tsx'), 'utf8');
    expect(budgets).toContain('HOME_NEEDS_FILE_HREF');
    expect(budgets).toContain('NEEDS_A_CATEGORY_LINK_LABEL');
    expect(budgets).not.toMatch(/href="\/triage"/);
    expect(budgets).not.toMatch(/review in Inbox/);
  });
});
