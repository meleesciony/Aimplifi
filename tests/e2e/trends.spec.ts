/**
 * Spending Trends (DECISIONS #74): discoverable from a dashboard card, then a
 * pace projection + category movers + largest purchases + new merchants, all
 * from the seed with zero credentials. Includes a WCAG-AA axe scan on the page.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('trends is discoverable from the dashboard insights card', async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId('dashboard-spending-insights');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Trends');
  await card.click();
  await page.waitForURL('**/trends');
});

test('trends view shows pace, movers, and largest purchases from the seed', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');

  // Pace: a projected month-end figure with the assumption stated.
  await expect(page.getByTestId('trends-pace')).toBeVisible();
  await expect(page.getByTestId('trends-pace')).toContainText('projected by month end');
  await expect(page.getByTestId('trends-pace')).toContainText('current daily rate');

  // Movers: the completed-month comparison renders.
  await expect(page.getByTestId('trends-movers')).toBeVisible();
  await expect(page.getByText('What changed')).toBeVisible();

  // Largest: Costco is the seed's biggest June purchase ($158.44), category-robust.
  const largest = page.getByTestId('trends-largest');
  await expect(largest).toBeVisible();
  await expect(largest).toContainText('Costco');
});

test('trends page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');
  await expect(page.getByTestId('trends-pace')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});

test('trends mover drills to reports MoM panel (#172)', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');
  await expect(page.getByTestId('trends-movers')).toBeVisible();

  const firstDrill = page.locator('[data-testid^="trends-mover-drill-"]').first();
  await expect(firstDrill).toBeVisible();
  const href = await firstDrill.getAttribute('href');
  expect(href).toMatch(/^\/reports\?category=/);

  await firstDrill.click();
  await page.waitForURL(/\/reports\?category=/);
  await expect(page.getByTestId('category-mom-panel')).toBeVisible();
  await expect(page.getByTestId('category-mom-bars')).toBeVisible();
});
