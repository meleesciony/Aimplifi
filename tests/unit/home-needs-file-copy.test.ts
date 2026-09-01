/**
 * Home promised Inbox merchant groups ("N merchants need filing" → /triage)
 * next to row labels that said Needs category. Activity already owns the
 * work queue at /transactions?unclassified=1.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_NEEDS_FILE_HREF, homeNeedsFileLabel } from '@/lib/copy/home-needs-file-copy';

describe('Home needs-file chip is Needs a category, not Inbox (DECISIONS #543)', () => {
  it('test_regression__home_needs_file_href_is_unclassified_not_inbox', () => {
    expect(HOME_NEEDS_FILE_HREF).toBe('/transactions?unclassified=1');
    expect(HOME_NEEDS_FILE_HREF).not.toMatch(/triage/);
    expect(homeNeedsFileLabel(1)).toBe('1 needs a category');
    expect(homeNeedsFileLabel(3)).toBe('3 need a category');
    expect(homeNeedsFileLabel(3)).not.toMatch(/merchant/i);

    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('HOME_NEEDS_FILE_HREF');
    expect(card).toContain('homeNeedsFileLabel');
    expect(card).not.toMatch(/href="\/triage"/);
    expect(card).not.toMatch(/merchants need filing/);

    const server = readFileSync(resolve('src/server/dashboard-recent.ts'), 'utf8');
    expect(server).toContain('isUnclassifiedTxn');
    expect(server).not.toMatch(/getReviewCount/);
  });
});
