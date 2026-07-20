/**
 * Recurring & subscriptions (DECISIONS #71): the dashboard surfaces a live
 * monthly-recurring total, and the full view lists detected subscriptions with
 * the Netflix price increase flagged — all from the seed, zero credentials.
 */
import AxeBuilder from '@axe-core/playwright';
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

test('coming-up schedule shows horizon totals and predicts Netflix at the NEW price (#246)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/recurring');

  const section = page.getByTestId('coming-up');
  await expect(section).toBeVisible();

  // Three nested horizon tiles, each a real dollar figure; 30 days is nonzero
  // on the seed (monthly subscriptions are always due within a month).
  for (const days of [7, 30, 90]) {
    await expect(page.getByTestId(`coming-up-${days}d`)).toContainText('$');
  }
  await expect(page.getByTestId('coming-up-30d')).not.toContainText('$0.00');

  // The schedule is grounded in the two-plateau detector: Netflix's expected
  // charge is the post-increase price, with the honest "was" magnitude — the
  // same time-claim-free form as the row badge (critic #246 P2-1).
  const netflixRow = page.getByTestId('coming-up-row').filter({ hasText: 'Netflix' }).first();
  await expect(netflixRow).toBeVisible();
  await expect(netflixRow).toContainText('$17.99');
  await expect(netflixRow).toContainText('↑ was $15.49');

  // Estimates are disclosed inline (coaching guardrails: assumptions stated).
  await expect(section).toContainText('estimates, not bills');

  // The new section stays WCAG AA clean.
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
});
