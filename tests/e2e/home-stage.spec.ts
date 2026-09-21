/**
 * Home stage (#757): cash-needed leads in the DOM. Desktop paints it left of
 * guilt-free; 380px paints it above. Guilt-free still finishes inside 800px.
 */
import { expect, test } from './helpers/test';

test('phone home stage paints cash-needed above guilt-free', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const cash = page.getByTestId('cash-needed-amount');
  const guilt = page.getByTestId('dashboard-safe-to-spend-amount');
  const c = await cash.boundingBox();
  const g = await guilt.boundingBox();
  expect(c, 'cash-needed box').toBeTruthy();
  expect(g, 'guilt-free box').toBeTruthy();
  if (!c || !g) return;
  expect(c.y).toBeLessThan(g.y);
  expect(g.y + g.height).toBeLessThanOrEqual(800);
  // The due-date list used to sit open and push guilt-free past 800px on CI
  // Linux chrome. It starts closed; open the summary to read the rows.
  await expect(page.getByTestId('cash-needed-dues')).toBeVisible();
  await expect(page.getByTestId('due-date-list')).toBeHidden();
  const amountPx = await cash.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(amountPx, 'cash-needed-amount must keep MONEY_DISPLAY_CLASS (not 14px UA)').toBeGreaterThanOrEqual(28);
});

test('desktop home stage puts cash-needed left of guilt-free', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const stage = page.getByTestId('home-stage');
  await expect(stage).toBeVisible();
  const cash = page.getByTestId('cash-needed-amount');
  const guilt = page.getByTestId('dashboard-safe-to-spend-amount');
  const c = await cash.boundingBox();
  const g = await guilt.boundingBox();
  expect(c, 'cash-needed box').toBeTruthy();
  expect(g, 'guilt-free box').toBeTruthy();
  if (!c || !g) return;
  expect(c.x).toBeLessThan(g.x);
});
