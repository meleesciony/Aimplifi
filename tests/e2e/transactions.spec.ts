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
  await expect(page.getByTestId('accounts-net-worth-trend')).toBeVisible(); // net worth over time (DECISIONS #40)
  await expect(page.getByTestId('connect-bank-btn')).toBeVisible(); // Plaid Link entry point (DECISIONS #41)
  await expect(page.getByTestId('account-group-asset')).toBeVisible();
  await expect(page.getByTestId('account-group-liability')).toBeVisible();

  // Tapping an account drills into its filtered transactions. The register
  // SSRs the full transaction set, which can be slow under parallel-worker
  // load — wait for the navigation rather than the default 5s URL poll.
  await page.getByTestId('account-row').first().click();
  await page.waitForURL(/\/transactions\?account=/, { timeout: 20000 });
  await expect(page.getByTestId('txn-list')).toBeVisible();
});

test('manual net-worth items: add a home asset (net worth updates), then delete it (DECISIONS #39)', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');

  // Add a $100,000 home → net worth goes from the seed golden value to +100k.
  // Add-then-delete keeps the shared seed net worth intact for the golden specs
  // (Playwright's toHaveText retries through the brief window).
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$144,804.74');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('E2E Test Home');
  await page.getByTestId('manual-type').selectOption('REAL_ESTATE');
  await page.getByTestId('manual-value').fill('100000');
  await page.getByTestId('manual-submit').click();

  const row = page.getByTestId('manual-account-row').filter({ hasText: 'E2E Test Home' });
  await expect(row).toBeVisible({ timeout: 20000 });
  // it lands in the ASSETS group and net worth reflects it
  await expect(page.getByTestId('account-group-asset')).toContainText('E2E Test Home');
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$244,804.74');

  // delete → reverts (so the golden value is restored for parallel specs)
  await row.getByTestId('manual-delete').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Test Home' })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$144,804.74');
});

test('transaction register lists, summarizes, filters, and searches', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');

  await expect(page.getByTestId('txn-list')).toBeVisible();
  await expect(page.getByTestId('txn-summary')).toBeVisible();
  await expect(page.getByTestId('txn-row').first()).toBeVisible();

  // Type filter → URL reflects it and rows remain. (Generous timeout: each
  // filter change re-SSRs the full register, slow under parallel load.)
  await page.getByTestId('txn-filter-type').selectOption('income');
  await expect(page).toHaveURL(/type=income/, { timeout: 20000 });
  await expect(page.getByTestId('txn-row').first()).toBeVisible();

  // Search a known seed merchant (fresh load so filter state can't race).
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill('Blue Bottle');
  await page.getByTestId('txn-search').press('Enter');
  await expect(page).toHaveURL(/q=Blue/, { timeout: 20000 });
  const first = page.getByTestId('txn-row').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText('Blue Bottle');
});

test('SimpleFIN connect affordance is present and opens its token form (dormant)', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');
  const btn = page.getByTestId('simplefin-connect-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.getByTestId('simplefin-form')).toBeVisible();
  await expect(page.getByTestId('simplefin-token')).toBeVisible();
});

test('transaction register paginates: Next advances to page 2 (ROADMAP #8)', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible();

  // The seed has 800+ transactions → multiple pages of 100.
  await expect(page.getByTestId('txn-pagination')).toBeVisible();
  await expect(page.getByTestId('txn-page-indicator')).toContainText('Page 1 of');

  await page.getByTestId('txn-next-page').click();
  await expect(page).toHaveURL(/page=2/, { timeout: 20000 });
  await expect(page.getByTestId('txn-page-indicator')).toContainText('Page 2 of');
  await expect(page.getByTestId('txn-row').first()).toBeVisible();
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

test('inline recategorization on the register refiles a transaction (DECISIONS #36)', async ({ page }) => {
  await signIn(page);

  // Operate on our OWN manual row — manual entry never moves balances
  // (DECISIONS #24), so recategorizing it can't disturb the golden specs on the
  // shared seed DB. This also exercises the gap the feature closes: the row is
  // POSTED/auto-filed (never enters triage), yet must still be correctable.
  await page.goto('/transactions/new');
  const label = 'E2E Recat Row';
  await page.getByTestId('txn-descriptor').fill(label);
  await page.getByTestId('txn-amount').fill('9.99');
  await page.getByTestId('txn-category').selectOption('dining');
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions');

  await page.getByTestId('txn-search').fill(label);
  await page.getByTestId('txn-search').press('Enter');
  const row = page.getByTestId('txn-row').filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText('Dining Out');

  // Open the inline editor and refile as Groceries (just this once).
  await row.getByTestId('category-chip').click();
  await page.getByTestId('category-menu').waitFor();
  // Type-to-filter the picker (DECISIONS #68) to the target, then click — no
  // scrolling past 80+ options.
  await page.getByTestId('cat-search').fill('Groceries');
  await page.locator('[data-testid="cat-option"][data-cat="groceries"]').click();
  await page.getByTestId('recat-once').click();

  // The register reflects the new category after the action + refresh.
  const updated = page.getByTestId('txn-row').filter({ hasText: label });
  await expect(updated).toContainText('Groceries', { timeout: 20000 });
  await expect(updated).not.toContainText('Dining Out');
});

test('CSV import: valid rows imported, bad rows skipped with line errors', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions/import');

  const csv = [
    'date,description,amount,category',
    '2026-06-02,E2E Import Bookstore,-18.75,shopping',
    'bad-date,E2E Import Bad Row,-1.00,shopping',
  ].join('\n');
  await page.getByTestId('import-csv-text').fill(csv);
  await page.getByTestId('import-submit').click();

  const result = page.getByTestId('import-result');
  await expect(result).toContainText('Imported 1');
  await expect(result).toContainText('skipped 1');
  await expect(page.getByTestId('import-errors')).toContainText('Line 3');

  // The imported row shows up in the register.
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill('E2E Import Bookstore');
  await page.getByTestId('txn-search').press('Enter');
  const row = page.getByTestId('txn-row').filter({ hasText: 'E2E Import Bookstore' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('-$18.75');
});

test('accounts, register, add, and import pages pass WCAG AA (380×800)', async ({ page }) => {
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

  await page.goto('/transactions/import');
  await expect(page.getByTestId('import-csv-form')).toBeVisible();
  await expectNoViolations(page, 'transactions/import');
});
