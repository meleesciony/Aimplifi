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

  // B.2 composition: income − savings − fixed = guilt-free on one page.
  await expect(page.getByTestId('budgeting-composition')).toBeVisible();
  await expect(page.getByTestId('budgeting-income')).toBeVisible();
  await expect(page.getByTestId('budgeting-savings')).toBeVisible();
  await expect(page.getByTestId('budgeting-fixed')).toBeVisible();
  await expect(page.getByTestId('budgeting-guilt-free')).toBeVisible();
  await expect(page.getByTestId('plan-figures-form')).toBeVisible();
  // #380: Plan Fixed is always the category rollup when Fixed cats have spend.
  await expect(page.getByTestId('budgeting-fixed-basis')).toContainText('Fixed categories');
  await expect(page.getByTestId('budgeting-fixed-basis')).toContainText('not already in that rollup');

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
  // Shared demo cannot mutate designations — the dial is fenced off the demo (#396).
  await expect(page.getByTestId('spend-class-move-groceries')).toHaveCount(0);

  // C.5/#393 (audit P1-8): the Plan amount states its method AND window — a
  // bare "(typical)" beside money is unauditable, and the rendered clause is
  // what proves `typicalMonths` actually reaches the page (critic cycle 1: the
  // component's `?? 0` fallbacks would degrade to "(typical)" silently).
  // The demo has no groceries budget target, so the TYPICAL branch is required
  // outright — an alternation admitting "(your target)" would let a stray
  // budget row green this without proving the months plumbing (cycle 2 P2-4).
  await expect(page.getByTestId('spend-class-plan-amount-groceries')).toContainText(
    /\(typical — average of your last (\d+ complete months|complete month)\)/,
  );

  // B.3: Sethi strip caption names the widened Fixed numerator (not bills alone).
  const caption = page.getByTestId('conscious-caption');
  await expect(caption).toBeVisible();
  await expect(caption).toContainText('groceries');
  await expect(caption).toContainText('50–60%');

  // "Review Fixed on Spending" from the Fixed glass-box must scroll to the panel
  // (same-page /budgets href was a no-op and looked broken).
  await page.getByTestId('conscious-fixed-toggle').click();
  const review = page.getByTestId('conscious-fixed-row-action');
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute('href', /#spend-class/);
  await review.click();
  await expect(page).toHaveURL(/\/budgets#spend-class/);
  await expect(page.getByTestId('spend-class-panel')).toBeInViewport();
});
