/**
 * Reports (DECISIONS #67): demo sign-in → Reports → income-vs-expense chart +
 * spending-by-category breakdown render.
 */
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

test('Reports: income/expense chart + category breakdown render for the demo user', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  await clickMoreNav(page, 'nav-reports');
  await page.waitForURL('**/reports');

  await expect(page.getByTestId('income-expense-chart')).toBeVisible();
  await expect(page.getByTestId('category-breakdown')).toBeVisible();
  // Scoped to the HEADING, which is what this assertion always meant. A bare
  // text locator went strict-mode-ambiguous once the chart above gained a
  // sentence naming this section ("…and “Spending by category” below count on
  // different rules"), which is the same locator-widening failure Wave 0.2
  // recorded for auth.spec's "Sign out".
  await expect(page.getByRole('heading', { name: 'Spending by category' })).toBeVisible();

  await expect(page.getByTestId('interest-fees-ytd-card')).toBeVisible();
  await expect(page.getByTestId('interest-fees-ytd-empty')).toBeVisible();
  await expect(page.getByTestId('interest-fees-ytd-empty')).toContainText(
    'No interest or fee charges are filed so far in 2026',
  );
  await expect(page.getByTestId('interest-fees-ytd-empty')).toContainText('Fees & Charges');
  await expect(page.getByTestId('interest-fees-ytd-empty')).toContainText('Interest & Finance Charges');
  await expect(page.getByTestId('interest-fees-ytd-empty')).toContainText('ATM Fee');
  await expect(page.getByTestId('interest-fees-ytd-empty')).toContainText('Late Fee');
  await expect(page.getByTestId('interest-fees-ytd-card')).toContainText('Interest & fees so far in 2026');

  await expect(page.getByTestId('giving-ytd-card')).toBeVisible();
  await expect(page.getByTestId('giving-ytd-empty')).toBeVisible();
  await expect(page.getByTestId('giving-ytd-empty')).toContainText(
    'No spend is filed in Gifts or Charity & Donations so far in 2026',
  );
  await expect(page.getByTestId('giving-ytd-empty')).toContainText('Gifts');
  await expect(page.getByTestId('giving-ytd-empty')).toContainText('Charity & Donations');
  await expect(page.getByTestId('giving-ytd-card')).toContainText('Giving so far in 2026');
});
