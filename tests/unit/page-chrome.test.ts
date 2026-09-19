import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MONEY_DISPLAY_CLASS,
  MONEY_NEGATIVE_CLASS,
  MONEY_PAIR_CLASS,
  PAGE_LEAD_CLASS,
  PAGE_LEAD_WIDE_CLASS,
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

  it('caps the lead column at md so max-w-md routes cannot be overreached', () => {
    expect(PAGE_LEAD_CLASS.split(' ')).toContain('max-w-md');
    expect(PAGE_LEAD_CLASS.split(' ')).not.toContain('max-w-2xl');
  });
});

describe('PAGE_LEAD_WIDE_CLASS', () => {
  it('re-opens the lead column only from sm up', () => {
    expect(PAGE_LEAD_WIDE_CLASS.split(' ')).toEqual(['sm:max-w-2xl']);
  });

  // Dropping the WIDE pair from a consumer silently narrows that lead from
  // 2xl to md — too narrow to ever trip the horizontal-overflow e2e — so the
  // wiring itself is locked, in the same readFileSync style as the
  // section-label lock.
  const WIDE_LEAD_ROUTES = [
    'src/app/(app)/accounts/page.tsx',
    'src/app/(app)/goals/page.tsx',
    'src/app/(app)/rules/page.tsx',
    'src/app/(app)/triage/page.tsx',
    'src/components/finance/ask-view.tsx',
  ];

  it('is wired into every wide-route lead', () => {
    for (const file of WIDE_LEAD_ROUTES) {
      expect(readFileSync(resolve(file), 'utf8')).toContain('PAGE_LEAD_WIDE_CLASS');
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

describe('money type tokens', () => {
  it('does not let the spending-plan hero fight the display token with font-bold', () => {
    const hero = readFileSync(resolve('src/app/(app)/spending-plan/page.tsx'), 'utf8');
    expect(hero).toContain('MONEY_DISPLAY_CLASS');
    expect(hero).not.toMatch(/font-bold \$\{MONEY_DISPLAY_CLASS\}/);
  });

  it('gives the stage number a display scale', () => {
    for (const util of ['text-3xl', 'tabular-nums', 'sm:text-4xl']) {
      expect(MONEY_DISPLAY_CLASS.split(' ')).toContain(util);
    }
  });

  it('keeps the pair number smaller than the stage', () => {
    expect(MONEY_PAIR_CLASS.split(' ')).toContain('text-2xl');
    expect(MONEY_PAIR_CLASS.split(' ')).toContain('font-semibold');
    expect(MONEY_PAIR_CLASS).not.toContain('text-3xl');
    expect(MONEY_PAIR_CLASS).not.toContain('font-bold');
  });

  it('uses one red for negative money', () => {
    expect(MONEY_NEGATIVE_CLASS).toBe('text-red-500');
  });
});
