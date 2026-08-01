/**
 * Fixed vs guilt-free panel on /budgets (DECISIONS #376).
 */
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('budgets shows Fixed vs guilt-free sections from category suggestions', async ({ page }) => {
  await signIn(page);
  await clickMoreNav(page, 'nav-budgets');
  await page.waitForURL('**/budgets**');

  await expect(page.getByTestId('spend-class-panel')).toBeVisible();
  await expect(page.getByTestId('spend-class-fixed')).toBeVisible();
  await expect(page.getByTestId('spend-class-guilt-free')).toBeVisible();
  await expect(page.getByTestId('spend-class-demo-note')).toBeVisible();

  // Demo June seed: groceries/fuel are fixed; shopping/entertainment/fitness are guilt-free.
  await expect(page.getByTestId('spend-class-row-groceries')).toHaveAttribute('data-fixed', 'true');
  const guiltFree = page.getByTestId('spend-class-guilt-free');
  await expect(guiltFree.getByTestId(/^spend-class-row-/).first()).toHaveAttribute(
    'data-fixed',
    'false',
  );
  // Shared demo cannot mutate designations.
  await expect(page.getByTestId('spend-class-move-groceries')).toHaveCount(0);
});
