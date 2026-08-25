/**
 * Mortgage extra-principal tile on /accounts (DECISIONS #517).
 * Demo seed has no mortgage — the empty sentence is the anti-vacuous marker.
 */
import { expect, test } from './helpers/test';

test('Accounts: extra-principal tile is honestly empty for the demo user', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await expect(page.getByTestId('mortgage-early-payoff-card')).toBeVisible();
  await expect(page.getByTestId('mortgage-early-payoff-empty')).toContainText(
    'No mortgage with a rate and a minimum payment is on file',
  );
  await expect(page.getByTestId('mortgage-early-payoff-empty')).toContainText('debt planner');
  await expect(page.getByTestId('mortgage-early-payoff-empty')).toContainText('not treated as 0%');
  await expect(page.getByTestId('mortgage-early-payoff-slider')).toHaveCount(0);
});
