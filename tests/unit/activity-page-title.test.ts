import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIVITY_PAGE_TITLE } from '@/lib/copy/activity-copy';

describe('Activity register name matches nav (DECISIONS #577)', () => {
  it('test_regression__activity_register_heading_matches_nav', () => {
    expect(ACTIVITY_PAGE_TITLE).toBe('Activity');

    const page = readFileSync(resolve('src/app/(app)/transactions/page.tsx'), 'utf8');
    expect(page).toContain('ACTIVITY_PAGE_TITLE');
    expect(page).not.toMatch(/<h1[^>]*>Transactions<\/h1>/);
    expect(page).not.toMatch(/title: "Transactions"/);

    const nav = readFileSync(resolve('src/lib/nav/destinations.ts'), 'utf8');
    expect(nav).toContain('ACTIVITY_PAGE_TITLE');
  });
});
