/**
 * Register Fixed / Discretionary labels (DECISIONS #378).
 */
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('every register row shows a Fixed or Discretionary (or Not counted) class', async ({ page }) => {
  await signIn(page);
  await clickMoreNav(page, 'nav-transactions');
  await page.waitForURL('**/transactions**');

  const rows = page.getByTestId('txn-row');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);

  for (let i = 0; i < Math.min(n, 12); i++) {
    const cls = rows.nth(i).getByTestId('txn-spend-class');
    await expect(cls).toBeVisible();
    const kind = await cls.getAttribute('data-spend-class');
    expect(['fixed', 'guilt-free', 'out-of-scope']).toContain(kind);
  }

  // Demo seed must expose both classes — soft ifs let this lock decay.
  const groceries = page.getByTestId('txn-row').filter({ hasText: 'Groceries' }).first();
  await expect(groceries).toBeVisible();
  await expect(groceries.getByTestId('txn-spend-class')).toHaveAttribute(
    'data-spend-class',
    'fixed',
  );
  const dining = page.getByTestId('txn-row').filter({ hasText: 'Dining' }).first();
  await expect(dining).toBeVisible();
  await expect(dining.getByTestId('txn-spend-class')).toHaveAttribute(
    'data-spend-class',
    'guilt-free',
  );
  // Shared demo: label only (no select) — the dial is fenced off the demo (#396).
  await expect(groceries.locator('select[data-testid="txn-spend-class"]')).toHaveCount(0);
});
