/**
 * Spending Plan (DECISIONS #66): demo sign-in → Plan → "safe to spend" headline
 * renders with its breakdown. The exact cents come from the seed, so we assert a
 * money-shaped value + the breakdown structure rather than a brittle pinned number.
 */
import { expect, test } from '@playwright/test';

test('Spending Plan: safe-to-spend headline + breakdown render for the demo user', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await page.getByTestId('nav-spending-plan').first().click();
  await page.waitForURL('**/spending-plan');

  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();
  await expect(page.getByTestId('safe-to-spend')).toHaveText(/-?\$[\d,]+\.\d{2}/);
  await expect(page.getByText('Expected income', { exact: true })).toBeVisible();
  await expect(page.getByText('Bills still coming', { exact: true })).toBeVisible();
});
