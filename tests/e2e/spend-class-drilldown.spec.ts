/**
 * W.7 — tap a Fixed / Guilt-free heading → register shows every transaction
 * under that class for the month.
 */
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('Fixed expenses heading on Spending opens Fixed transactions', async ({ page }) => {
  await signIn(page);
  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets**');

  const heading = page.getByTestId('budgeting-fixed-heading');
  await expect(heading).toBeVisible();
  await heading.click();
  await page.waitForURL(/\/transactions\?/);

  const url = new URL(page.url());
  expect(url.searchParams.get('spendClass')).toBe('fixed');
  expect(url.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(url.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await expect(page.getByTestId('txn-filter-spend-class')).toHaveValue('fixed');
  await expect(page.getByTestId('txn-spend-class-basis')).toBeVisible();

  const rows = page.getByTestId('txn-row');
  // Demo seed has Fixed spend in the pin month — empty would mean the filter
  // or the link window drifted from the seed.
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < Math.min(n, 10); i++) {
    await expect(rows.nth(i).getByTestId('txn-spend-class')).toHaveAttribute(
      'data-spend-class',
      'fixed',
    );
  }
});

test('Conscious Fixed heading opens the same Class filter', async ({ page }) => {
  await signIn(page);
  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets**');

  const heading = page.getByTestId('conscious-fixed-heading');
  await expect(heading).toBeVisible();
  await heading.click();
  await page.waitForURL(/spendClass=fixed/);
  await expect(page.getByTestId('txn-filter-spend-class')).toHaveValue('fixed');
});
