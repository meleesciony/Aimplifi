/**
 * Mobile More-sheet helper (DECISIONS #187). Secondary destinations live in the
 * labelled More sheet on phones — open it before clicking a nav-* secondary link.
 * Prefer this over page.goto for flows that assert discoverability from the nav.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function openMoreNav(page: Page) {
  const more = page.getByTestId('nav-more');
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByTestId('nav-more-sheet')).toBeVisible();
}

/** Open More (if needed) and click a secondary/discover nav link by testid. */
export async function clickMoreNav(page: Page, testid: string) {
  // Sheet may already be open from a prior step; only open when the link isn't visible.
  const link = page.getByTestId(testid);
  if (!(await link.isVisible().catch(() => false))) {
    await openMoreNav(page);
  }
  await expect(page.getByTestId(testid)).toBeVisible();
  await page.getByTestId(testid).click();
}
