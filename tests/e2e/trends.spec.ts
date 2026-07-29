/**
 * Spending Trends (DECISIONS #74): discoverable from a dashboard card, then a
 * pace projection + category movers + largest purchases + new merchants, all
 * from the seed with zero credentials. Includes a WCAG-AA axe scan on the page.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from './helpers/test';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('trends is discoverable from the dashboard insights card', async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId('dashboard-spending-insights');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Trends');
  await card.click();
  await page.waitForURL('**/trends');
});

test('trends view shows pace, movers, and largest purchases from the seed', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');

  // Pace: a projected month-end figure with the assumption stated.
  await expect(page.getByTestId('trends-pace')).toBeVisible();
  await expect(page.getByTestId('trends-pace')).toContainText('projected by month end');
  await expect(page.getByTestId('trends-pace')).toContainText('current daily rate');

  // Movers: the completed-month comparison renders.
  await expect(page.getByTestId('trends-movers')).toBeVisible();
  await expect(page.getByText('What changed')).toBeVisible();

  // Largest: Costco is the seed's biggest June purchase ($158.44), category-robust.
  const largest = page.getByTestId('trends-largest');
  await expect(largest).toBeVisible();
  await expect(largest).toContainText('Costco');

  // New merchants (O.8a). Nothing asserted this card before, so the basis line
  // its honesty rests on could have been deleted with every suite green — and
  // per L.29 a figure counting unsettled money must SAY that it does.
  const newMerchants = page.getByTestId('trends-new-merchants');
  await expect(newMerchants).toBeVisible();
  // The seed's figure, rendered — the engine golden reaching the page.
  await expect(newMerchants).toContainText('Costco Gas');
  await expect(newMerchants).toContainText('$37.38');

  const basis = page.getByTestId('trends-new-merchants-basis');
  // Each clause is a separate claim, so each is asserted separately: what
  // confirms a merchant, that pending money counts, and that the list can drop.
  await expect(basis).toContainText('settled purchase');
  await expect(basis).toContainText('still pending');
  await expect(basis).toContainText('drops off this list');
});

test('trends page passes WCAG 2.1 AA (axe)', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');
  await expect(page.getByTestId('trends-pace')).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
});
