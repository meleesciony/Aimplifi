/**
 * Phase 3 golden flow (380×800): FI Coach — savings rate headline parity,
 * FI card with the live slider, opportunities, creep, runway, life-energy
 * toggle, and the monthly Money Review.
 */
import { expect, test } from '@playwright/test';

test('coach page: savings rate, FI slider moves the date live, life-energy toggle, money review', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // headline parity on the dashboard: savings rate next to net worth
  await expect(page.getByTestId('net-worth-card')).toBeVisible();
  await expect(page.getByTestId('savings-rate-card')).toBeVisible();

  await page.getByTestId('bottom-nav-coach').click();
  await page.waitForURL('**/coach');

  // FI number present and formatted
  await expect(page.getByTestId('fi-number')).toContainText('$');
  await expect(page.getByTestId('savings-rate-amount')).toContainText('%');

  // interactive slider: dragging to a higher rate CHANGES the live caption
  const before = await page.getByTestId('slider-result').textContent();
  await page.getByTestId('fi-slider').fill('6000'); // 60% savings rate
  const after = await page.getByTestId('slider-result').textContent();
  expect(after).not.toBe(before);
  await expect(page.getByTestId('slider-rate')).toHaveText('60%');

  // opportunities ranked with the unused gym present, estimates labeled
  await expect(page.getByTestId('opportunities-list')).toContainText('LA Fitness');
  await expect(page.getByTestId('opportunities-list')).toContainText('Netflix');
  await expect(page.getByTestId('opportunities-card')).toContainText('est.');

  // creep flagged on the engineered seed rise — phrased as a question, not a verdict
  await expect(page.getByTestId('creep-verdict')).toContainText('not a verdict');

  // runway card
  await expect(page.getByTestId('runway-months')).toContainText('months');

  // life-energy toggle flips $ → hours
  const firstRow = page.getByTestId('life-energy-list').locator('li').first();
  await expect(firstRow).toContainText('$');
  await page.getByTestId('life-energy-toggle').click();
  await expect(firstRow).toContainText('hrs');

  // Money Review: one improvement, one creep, one concrete next action
  await expect(page.getByTestId('review-improvement')).not.toBeEmpty();
  await expect(page.getByTestId('review-creep')).not.toBeEmpty();
  await expect(page.getByTestId('review-next-action')).toContainText('One next action');

  // the educational disclaimer is on the page
  await expect(page.locator('text=Educational, not financial advice')).toBeVisible();
});

