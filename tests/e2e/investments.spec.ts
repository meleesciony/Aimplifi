/**
 * Investments view (DECISIONS #78): reachable from /accounts, then a portfolio
 * summary (value + gain + allocation) and per-account holdings, all from the seed
 * with zero credentials. Includes a WCAG-AA axe scan.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('investments is reachable from accounts and shows the seeded portfolio', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');
  const link = page.getByTestId('investments-link');
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL('**/investments');

  // Seeded Brokerage portfolio: $142,000.00 market value, with a gain and AAPL holding.
  await expect(page.getByTestId('investments-total-value')).toContainText('$142,000.00');
  await expect(page.getByTestId('investments-total-gain')).toContainText('total return');
  await expect(page.getByTestId('holding-row').filter({ hasText: 'AAPL' })).toBeVisible();
});

test('investments page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');
  await expect(page.getByTestId('investments-summary')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});
