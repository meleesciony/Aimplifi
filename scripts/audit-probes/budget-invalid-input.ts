/** Focused: budget amount "abc" must show the inline error, keep fields, not crash. */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.goto(`${BASE}/budgets`);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('budget-category').selectOption('fuel');
  await page.getByTestId('budget-amount').fill('abc');
  await page.getByTestId('budget-set').click();
  await page.locator('#budget-amount-error').waitFor({ state: 'visible', timeout: 6000 });
  const kept = await page.getByTestId('budget-amount').inputValue();
  const cat = await page.getByTestId('budget-category').inputValue();
  const crashed = await page.locator('text=Something went wrong').isVisible().catch(() => false);
  console.log(`inline error visible; amount kept="${kept}" category kept="${cat}" crash=${crashed}`);
  await browser.close();
})();
