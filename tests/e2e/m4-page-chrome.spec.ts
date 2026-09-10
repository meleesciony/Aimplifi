import { test, expect } from './helpers/test';

// Standing e2e lock for the M.4 slice-2 page-chrome pass (DECISIONS #724).
// The app renders hard-coded dark (root layout `<html className="dark">`).
// It walks every (app) route as the demo user at mobile-380 and desktop-1440,
// asserting the slice's invariants: no horizontal page overflow, the shared
// title token's desktop scale, the pill-shaped desktop nav, and the restyled
// demo banner pill on Home.

const ROUTES = [
  'dashboard', 'accounts', 'transactions', 'budgets', 'calendar', 'cards',
  'coach', 'goals', 'investments', 'forecast', 'reports', 'rules',
  'settings', 'spending-plan', 'recurring', 'trends', 'triage', 'trust', 'ask',
];

test.describe('M.4 page-chrome walkthrough', () => {
  test('every (app) route renders without horizontal overflow at 380 and 1440', async ({ page }) => {
    await page.goto('/sign-in', { waitUntil: 'networkidle' });
    await page.click('[data-testid=demo-sign-in]');
    await page.waitForURL('**/dashboard**', { timeout: 30000 });
    const overflows: string[] = [];
    for (const p of ROUTES) {
      await page.goto(`/${p}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      const vw = page.viewportSize()?.width ?? 0;
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > vw + 1) overflows.push(`${vw}/${p}: ${sw}`);
    }
    expect(overflows, `overflow on: ${overflows.join(', ')}`).toEqual([]);
  });

  test('mobile-380: dashboard hero and the restyled demo banner pill render', async ({ page }) => {
    await page.goto('/sign-in', { waitUntil: 'networkidle' });
    await page.click('[data-testid=demo-sign-in]');
    await page.waitForURL('**/dashboard**', { timeout: 30000 });
    await page.waitForTimeout(600);
    const heroWeight = await page
      .locator('[data-testid=cash-needed-amount]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(heroWeight)).toBeGreaterThanOrEqual(600);
    const demoBanner = page.getByTestId('demo-banner');
    await expect(demoBanner).toBeVisible();
    const radius = await demoBanner.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).not.toBe('0px');
  });

  test('desktop-1440: page title uses the shared type scale and nav links are pill-shaped', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/sign-in', { waitUntil: 'networkidle' });
    await page.click('[data-testid=demo-sign-in]');
    await page.waitForURL('**/dashboard**', { timeout: 30000 });
    await page.goto('/accounts', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const titleSize = await page
      .locator('h1')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(titleSize).toBe('30px');
    const navClass = await page.getByTestId('main-nav').locator('a').nth(1).getAttribute('class');
    expect(navClass).toContain('rounded-full');
  });
});
