/**
 * Phase 1 golden flow (380×800 viewport):
 * sign in (demo) → dashboard → THE answer above the fold, zero navigation →
 * per-card breakdown → pay-in-full ⇄ minimum toggle.
 *
 * Expected strings derive from docs/EDGE_CASES.md §Seed-headline.
 */
import { expect, test } from './helpers/test';

test('demo sign-in lands on the dashboard with guilt-free, cash-needed, and recent transactions', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  // Owner 2026-08-01: guilt-free is the monthly allocation answer — above the fold.
  const guiltFree = page.getByTestId('dashboard-safe-to-spend-amount');
  await expect(guiltFree).toBeVisible();
  const guiltBox = await guiltFree.boundingBox();
  expect(guiltBox).not.toBeNull();
  expect(guiltBox!.y + guiltBox!.height).toBeLessThanOrEqual(800);

  // Cash needed — liquidity for cards this cycle (still on Home, under guilt-free).
  const amount = page.getByTestId('cash-needed-amount');
  await expect(amount).toHaveText('$5,412.33');
  const headline = page.getByTestId('cash-needed-headline');
  // Audit P2: the aggregate total is dated with the FIRST effective due — the
  // earliest payment draws first (Sapphire + Platinum 06-15), so pairing the
  // whole-cycle total with the last due (06-26) under-demands late. The
  // projection horizon below stays the last due.
  await expect(headline).toContainText('needed in Everyday Checking by Mon, Jun 15');
  await expect(headline).toContainText('to pay all 3 cards in full this cycle');

  // Intra-period dip surfaced with the transfer recommendation
  const alert = page.getByTestId('shortfall-alert');
  await expect(alert).toContainText('Shortfall of $1,012.33 on Wed, Jun 24');
  await expect(page.getByTestId('transfer-recommendation')).toContainText(
    'Transfer $1,050.00',
  );
  await expect(page.getByTestId('transfer-recommendation')).toContainText('by Tue, Jun 23');

  // Recent transactions on Home (categorization loop) — not buried in Activity.
  await expect(page.getByTestId('dashboard-recent-transactions')).toBeVisible();
  await expect(page.getByTestId('dashboard-recent-row').first()).toBeVisible();

  // Net worth + trend present (Phase 1 acceptance #7)
  await expect(page.getByTestId('net-worth-amount')).toHaveText('$144,804.74');

  await page.getByTestId('dashboard-safe-to-spend').click();
  await page.waitForURL('**/spending-plan');
  await expect(page.getByTestId('safe-to-spend')).toBeVisible();
});

test('per-card breakdown shows each obligation and the scenario toggle works', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.getByTestId('see-card-breakdown').click();
  await page.waitForURL('**/cards');

  // Sapphire: user must act for the full $2,712.33
  await expect(page.getByTestId('user-action-acct-sapphire')).toHaveText('$2,712.33');
  // Platinum: autopay covers it — user action $0.00
  await expect(page.getByTestId('user-action-acct-platinum')).toHaveText('$0.00');
  await expect(page.getByTestId('card-acct-platinum')).toContainText('autopay');
  // Freedom: $400 already paid → remaining $600, weekend due date adjusted to Fri, Jun 26
  await expect(page.getByTestId('card-acct-freedom')).toContainText('Due Fri, Jun 26');
  await expect(page.getByTestId('user-action-acct-freedom')).toHaveText('$600.00');
  // Store: estimated next cycle
  await expect(page.getByTestId('card-acct-store')).toContainText('est.');

  // Scenario toggle: minimum path
  await page.getByTestId('toggle-minimum').click();
  await expect(page.getByTestId('scenario-required')).toHaveText('$2,135.00');
  await expect(page.getByTestId('minimum-interest')).toContainText('$67.36');
  await expect(page.getByTestId('minimum-interest')).toContainText('average-daily-balance');

  // and back
  await page.getByTestId('toggle-pay-in-full').click();
  await expect(page.getByTestId('scenario-required')).toHaveText('$5,412.33');
});
