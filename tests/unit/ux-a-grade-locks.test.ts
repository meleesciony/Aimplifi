/**
 * UX A-grade locks (DECISIONS #767): catalog starts closed, Home filters
 * stage restatements, Ask is one tap, swipe hint is pointer-aware.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('UX A-grade source locks (DECISIONS #767)', () => {
  it('test_regression__category_catalogs_start_closed_on_inbox_budgets_rules', () => {
    const disclosure = readFileSync(
      resolve('src/components/finance/category-catalog-disclosure.tsx'),
      'utf8',
    );
    expect(disclosure).toContain('<details');
    expect(disclosure).not.toMatch(/<details[^>]*\bopen\b/);
    for (const file of [
      'src/app/(app)/triage/page.tsx',
      'src/app/(app)/budgets/page.tsx',
      'src/app/(app)/rules/page.tsx',
    ]) {
      const src = readFileSync(resolve(file), 'utf8');
      expect(src).toContain('CategoryCatalogDisclosure');
    }
  });

  it('test_regression__home_today_uses_the_stage_display_filter', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    expect(page).toContain('omitHomeStageNudges');
    expect(page).toContain('PAGE_TITLE_CLASS');
    expect(page).toMatch(/<h1 className=\{PAGE_TITLE_CLASS\}>Home<\/h1>/);
  });

  it('test_regression__ask_is_in_the_header_and_desktop_daily_group', () => {
    const nav = readFileSync(resolve('src/components/app-nav.tsx'), 'utf8');
    expect(nav).toContain('header-nav-ask');
    expect(nav).toContain('desktop-${item.testid}');
    expect(nav).toContain("d.href === '/ask'");
    expect(nav).toContain("d.href !== '/ask'");
  });

  it('test_regression__inbox_swipe_hint_is_pointer_aware', () => {
    const inbox = readFileSync(resolve('src/components/triage/triage-inbox.tsx'), 'utf8');
    expect(inbox).toContain('[@media(pointer:coarse)]:hidden');
    expect(inbox).toContain('[@media(pointer:coarse)]:inline');
    expect(inbox).toContain('Swipe right to file');
  });
});
