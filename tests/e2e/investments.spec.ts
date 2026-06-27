/**
 * Investments view (DECISIONS #78): reachable from /accounts, then a portfolio
 * summary (value + gain + allocation) and per-account holdings, all from the seed
 * with zero credentials. Includes a WCAG-AA axe scan.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('investments is reachable from accounts and shows the seeded portfolio', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');
  const link = page.getByTestId('investments-link');
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL('**/investments');

  // Seeded Brokerage portfolio: $142,000.00 market value, with a gain and AAPL holding.
  await expect(page.getByTestId('investments-total-value')).toContainText('$142,000.00');
  await expect(page.getByTestId('investments-total-gain')).toContainText('total return');
  await expect(page.getByTestId('holding-row').filter({ hasText: 'AAPL' })).toBeVisible();
});

test('retirement outlook projects the seeded portfolio with stated assumptions', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');

  const card = page.getByTestId('retirement-outlook');
  await expect(card).toBeVisible();
  // Grounded headline + a projected balance at the assumed retirement age (65).
  await expect(page.getByTestId('retirement-headline')).toContainText(/age \d+/);
  await expect(page.getByTestId('retirement-outcome')).toContainText('Projected balance at age 65');
  await expect(page.getByTestId('retirement-balance-at-retirement')).toContainText(/\$[\d,]+\.\d{2}/);
  // Every assumption is stated inline (the coaching guardrail — no hidden facts):
  // the current-age assumption that drives accumulation, the inflation adjustment that
  // makes "today's dollars" honest, and the today's-dollars framing itself.
  await expect(card).toContainText(/you.re 40 today/);
  await expect(card).toContainText('inflation');
  await expect(card).toContainText('in today’s dollars');
});

test('retirement what-if recomputes the projection live without saving (DECISIONS #123)', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');

  // Starts at the saved/default plan: retire at 65.
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 65');

  // Drag the retirement age earlier → the projection recomputes instantly (client-side),
  // and the card flags that the saved plan is untouched.
  await page.getByTestId('whatif-retirement-age').fill('50');
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 50');
  await expect(page.getByTestId('retirement-whatif-note')).toContainText('saved plan is unchanged');

  // Reset restores the saved plan.
  await page.getByTestId('retirement-whatif-reset').click();
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 65');

  // The exploration never persisted: a fresh load is back at the saved plan (golden-safe).
  await page.reload();
  await expect(page.getByTestId('retirement-outcome')).toContainText('age 65');
  await expect(page.getByTestId('whatif-retirement-age')).toHaveValue('65');
});

test('investments page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/investments');
  await expect(page.getByTestId('investments-summary')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});
