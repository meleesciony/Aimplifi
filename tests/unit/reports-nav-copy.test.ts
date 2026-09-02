import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPORTS_NAV_DESCRIPTION } from '@/lib/copy/reports-copy';

describe('Reports nav names trailing months or a year (DECISIONS #578)', () => {
  it('test_regression__reports_nav_names_trailing_months_or_a_year', () => {
    expect(REPORTS_NAV_DESCRIPTION).toMatch(/named year/i);
    expect(REPORTS_NAV_DESCRIPTION).toMatch(/trailing months/i);
    expect(REPORTS_NAV_DESCRIPTION).not.toMatch(/Six months of income against spending, plus this month by category/);

    const nav = readFileSync(resolve('src/lib/nav/destinations.ts'), 'utf8');
    expect(nav).toContain('REPORTS_NAV_DESCRIPTION');
    expect(nav).not.toMatch(/Six months of income against spending, plus this month by category/);
  });
});
