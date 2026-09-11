import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * M.4 slices 3–4 (#724 residual): the near-twin section-label literals
 * render through the shared PAGE_SECTION_LABEL_CLASS instead of hand-rolled
 * copies. A literal reintroduced here drifts from the token the next time
 * the label scale evolves — the exact drift slice 2 closed for page titles.
 *
 * Slice 4's five h3/h3-family files (budgets, triage, rules, settings pages
 * and the household/learned-phrases cards) plus the spending-plan hero pair
 * widened the charter; out of scope by design: 10px badge pills, 11px nav
 * group headers, and list-group headers — different jobs, not labels.
 */
const SECTION_LABEL_FILES = [
  // slice 3
  'src/components/finance/allocation-drilldown.tsx',
  'src/components/finance/forecast-view.tsx',
  'src/components/finance/recurring-view.tsx',
  'src/components/finance/retirement-outlook-card.tsx',
  'src/components/finance/spend-class-panel.tsx',
  'src/components/finance/top-spending-card.tsx',
  'src/components/finance/ask-view.tsx',
  // slice 4
  'src/app/(app)/budgets/page.tsx',
  'src/app/(app)/triage/page.tsx',
  'src/app/(app)/rules/page.tsx',
  'src/app/(app)/settings/page.tsx',
  'src/components/settings/household-card.tsx',
  'src/components/settings/learned-phrases.tsx',
  'src/components/finance/household-sharing-card.tsx',
  'src/app/(app)/spending-plan/page.tsx',
];

/** The near-twin literal these files carried before the migration. */
const NEAR_TWIN_LITERAL = /text-xs font-(?:medium|semibold) uppercase tracking-wide/;

describe('near-twin section labels render through the token', () => {
  for (const file of SECTION_LABEL_FILES) {
    it(`${file} labels its sections with PAGE_SECTION_LABEL_CLASS`, () => {
      const source = readFileSync(resolve(file), 'utf8');
      expect(source).toContain('PAGE_SECTION_LABEL_CLASS');
      expect(source).not.toMatch(NEAR_TWIN_LITERAL);
    });
  }

  // A flex-row token inside a text-center hero packs to the start (critic
  // P1-1): centered consumers of the token must patch justify-center, the
  // recurring-view.tsx precedent.
  it('the spending-plan hero labels center themselves (text-center does not reach flex items)', () => {
    const source = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    const heroUses = source.match(/\$\{PAGE_SECTION_LABEL_CLASS\}[^`']*justify-center/g) ?? [];
    expect(heroUses.length).toBe(2);
  });
});
