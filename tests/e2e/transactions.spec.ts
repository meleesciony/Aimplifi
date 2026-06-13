/**
 * Transaction register + accounts page + manual entry (380×800 viewport).
 *
 * Net worth on the accounts page must equal the dashboard's golden value
 * ($144,804.74 — docs/EDGE_CASES.md §Seed-headline) since both derive from the
 * same account balances. Manual entry adds a POSTED, explicitly-categorized row
 * (so it never enters triage) and does NOT move balances (DECISIONS #24), which
 * is why it cannot disturb the other golden specs on the shared seed DB.
 */
import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  if (results.violations.length > 0) {
    console.log(`[axe:${label}]`, JSON.stringify(results.violations.map((v) => v.id)));
  }
  expect(results.violations, `axe violations on ${label}`).toEqual([]);
}

test('accounts page groups assets/liabilities and matches dashboard net worth', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');

  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$144,804.74');
  await expect(page.getByTestId('account-group-asset')).toBeVisible();
  await expect(page.getByTestId('account-group-liability')).toBeVisible();

  // Tapping an account drills into its filtered transactions.
  await page.getByTestId('account-row').first().click();
  await expect(page).toHaveURL(/\/transactions\?account=/);
  await expect(page.getByTestId('txn-list')).toBeVisible();
});

test('transaction register lists, summarizes, filters, and searches', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');

  await expect(page.getByTestId('txn-list')).toBeVisible();
  await expect(page.getByTestId('txn-summary')).toBeVisible();
  await expect(page.getByTestId('txn-row').first()).toBeVisible();

  // Type filter → URL reflects it and rows remain.
  await page.getByTestId('txn-filter-type').selectOption('income');
  await expect(page).toHaveURL(/type=income/);
  await expect(page.getByTestId('txn-row').first()).toBeVisible();

  // Search a known seed merchant (fresh load so filter state can't race).
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill('Blue Bottle');
  await page.getByTestId('txn-search').press('Enter');
  await expect(page).toHaveURL(/q=Blue/);
  const first = page.getByTestId('txn-row').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText('Blue Bottle');
});

test('manual entry: add a cash transaction and see it in the register', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions/new');

  const label = 'E2E Cash Coffee';
  await page.getByTestId('txn-descriptor').fill(label);
  await page.getByTestId('txn-amount').fill('12.34');
  await page.getByTestId('txn-category').selectOption('dining');
  await page.getByTestId('txn-submit').click();

  await page.waitForURL('**/transactions');

  await page.getByTestId('txn-search').fill(label);
  await page.getByTestId('txn-search').press('Enter');
  const row = page.getByTestId('txn-row').filter({ hasText: label });
  await expect(row).toBeVisible();
  await expect(row).toContainText('-$12.34');
  await expect(row).toContainText('Dining Out');
});

test('accounts, register, and add-transaction pages pass WCAG AA (380×800)', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');
  await expect(page.getByTestId('accounts-net-worth')).toBeVisible();
  await expectNoViolations(page, 'accounts');

  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible();
  await expectNoViolations(page, 'transactions');

  await page.goto('/transactions/new');
  await expect(page.getByTestId('add-txn-form')).toBeVisible();
  await expectNoViolations(page, 'transactions/new');
});
