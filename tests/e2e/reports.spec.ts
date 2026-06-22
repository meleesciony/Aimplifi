/**
 * Reports (DECISIONS #67): demo sign-in → Reports → income-vs-expense chart +
 * spending-by-category breakdown render.
 */
import { expect, test } from '@playwright/test';

test('Reports: income/expense chart + category breakdown render for the demo user', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await page.getByTestId('nav-reports').first().click();
  await page.waitForURL('**/reports');

  await expect(page.getByTestId('income-expense-chart')).toBeVisible();
  await expect(page.getByTestId('category-breakdown')).toBeVisible();
  await expect(page.getByText('Spending by category')).toBeVisible();
});
