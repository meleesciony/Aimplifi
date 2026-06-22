/**
 * Recurring & subscriptions (DECISIONS #71): the dashboard surfaces a live
 * monthly-recurring total, and the full view lists detected subscriptions with
 * the Netflix price increase flagged — all from the seed, zero credentials.
 */
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('dashboard surfaces a monthly recurring total', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('dashboard-recurring')).toBeVisible();
  await expect(page.getByTestId('dashboard-recurring-total')).toContainText('$');
});

test('recurring view lists subscriptions, a monthly total, and flags the Netflix price increase', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/recurring');

  await expect(page.getByTestId('recurring-hero')).toBeVisible();
  await expect(page.getByTestId('recurring-monthly-total')).toContainText('$');
  await expect(page.getByTestId('recurring-list')).toBeVisible();

  // A known seed subscription is detected and listed.
  const netflix = page.getByTestId('recurring-row').filter({ hasText: 'Netflix' });
  await expect(netflix).toBeVisible();
  // Its price increase ($15.49 → $17.99) is flagged.
  await expect(netflix.getByTestId('price-change-badge')).toBeVisible();
});
