import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * M.4 slice 3 (#724 residual): the seven near-twin section-label literals
 * render through the shared PAGE_SECTION_LABEL_CLASS instead of hand-rolled
 * copies. A literal reintroduced here drifts from the token the next time
 * the label scale evolves — the exact drift slice 2 closed for page titles.
 */
const SECTION_LABEL_FILES = [
  'src/components/finance/allocation-drilldown.tsx',
  'src/components/finance/forecast-view.tsx',
  'src/components/finance/recurring-view.tsx',
  'src/components/finance/retirement-outlook-card.tsx',
  'src/components/finance/spend-class-panel.tsx',
  'src/components/finance/top-spending-card.tsx',
  'src/components/finance/ask-view.tsx',
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
});
