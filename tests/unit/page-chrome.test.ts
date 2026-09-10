import { describe, it, expect } from 'vitest';
import {
  PAGE_LEAD_CLASS,
  PAGE_SECTION_LABEL_CLASS,
  PAGE_STACK_CLASS,
  PAGE_TITLE_CLASS,
} from '@/components/finance/page-chrome';

/**
 * Locks the load-bearing utilities of the shared page-chrome tokens
 * (M.4 slice 2 / #724). Centralising titles and stacks creates the same
 * risk SURFACE_LINK_CARD_CLASS already locks: one careless edit drops
 * hierarchy from every route at once.
 */
describe('PAGE_TITLE_CLASS', () => {
  it('keeps a page-title type scale', () => {
    for (const util of ['text-2xl', 'font-semibold', 'tracking-tight']) {
      expect(PAGE_TITLE_CLASS.split(' ')).toContain(util);
    }
  });
});

describe('PAGE_LEAD_CLASS', () => {
  it('keeps supporting copy secondary', () => {
    for (const util of ['text-sm', 'text-muted-foreground']) {
      expect(PAGE_LEAD_CLASS.split(' ')).toContain(util);
    }
  });
});

describe('PAGE_STACK_CLASS', () => {
  it('keeps the page vertical rhythm', () => {
    expect(PAGE_STACK_CLASS.split(' ')).toContain('space-y-5');
  });
});

describe('PAGE_SECTION_LABEL_CLASS', () => {
  it('keeps section labels quiet and scannable', () => {
    for (const util of ['text-xs', 'uppercase', 'tracking-wide', 'text-muted-foreground']) {
      expect(PAGE_SECTION_LABEL_CLASS.split(' ')).toContain(util);
    }
  });
});
