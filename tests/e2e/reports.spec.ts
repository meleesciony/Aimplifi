/**
 * Reports (DECISIONS #67 + #171): demo sign-in → Reports → income-vs-expense
 * chart + spending-by-category breakdown; category row opens MoM panel and
 * deep-links to the filtered register.
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
  // No category selected → MoM panel absent (golden default).
  await expect(page.getByTestId('category-mom-panel')).toHaveCount(0);
});

test('Reports: category MoM drill-down → panel + register deep-link', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await page.getByTestId('nav-reports').first().click();
  await page.waitForURL('**/reports');

  const firstDrill = page.locator('[data-testid^="category-drill-"]').first();
  await expect(firstDrill).toBeVisible();
  const href = await firstDrill.getAttribute('href');
  expect(href).toMatch(/^\/reports\?category=/);

  await firstDrill.click();
  await page.waitForURL(/\/reports\?category=/);

  const panel = page.getByTestId('category-mom-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('category-mom-bars')).toBeVisible();
  await expect(page.getByTestId('category-mom-delta')).toBeVisible();

  const registerLink = page.getByTestId('category-mom-register-link');
  await expect(registerLink).toBeVisible();
  const regHref = await registerLink.getAttribute('href');
  expect(regHref).toMatch(/\/transactions\?/);
  expect(regHref).toMatch(/category=/);
  expect(regHref).toMatch(/from=2026-06-01/);
  expect(regHref).toMatch(/to=2026-06-30/);
  // No type=expense — refunds that net into MoM must appear in the register.
  expect(regHref).not.toMatch(/type=/);

  await registerLink.click();
  await page.waitForURL(/\/transactions\?/);
  expect(page.url()).toMatch(/category=/);
  expect(page.url()).toMatch(/from=2026-06-01/);
});
