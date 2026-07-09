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

  // delete (two-step confirm) → reverts (so the golden value is restored for parallel specs)
  await row.getByTestId('manual-delete').click();
  await row.getByTestId('manual-delete-confirm').click();
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

test('register empty: no-match vs no-data (#173)', async ({ page }) => {
  // no-match: demo seed has rows; a nonsense search empties the filtered set.
  await signIn(page);
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill('ZZZNOMATCH_E2E_173');
  await page.getByTestId('txn-search').press('Enter');
  await expect(page).toHaveURL(/q=ZZZNOMATCH/, { timeout: 20000 });
  await expect(page.getByTestId('txn-empty-no-match')).toBeVisible();
  await expect(page.getByTestId('txn-empty-no-data')).toHaveCount(0);
  await expect(page.getByTestId('txn-row')).toHaveCount(0);
  await expect(page.getByTestId('txn-empty-clear')).toBeVisible();

  // no-data: throwaway user with a non-spending manual asset (home) — register
  // only loads spending-account txns, so the ledger is empty with no filters.
  const email = `e2e-nodata-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  await page.goto('/accounts');
  await page.getByTestId('add-asset-btn').click();
  await page.getByTestId('manual-name').fill('Primary home');
  await page.getByTestId('manual-value').fill('100000');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row')).toBeVisible({ timeout: 20000 });
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-empty-no-data')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('txn-empty-no-match')).toHaveCount(0);
  await expect(page.getByText('No transactions yet')).toBeVisible();
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

test('manual entry: an invalid amount shows an inline error and preserves the entries (#170)', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions/new');

  // A non-numeric amount used to throw to the app error boundary; now it returns
  // an inline error and writes no row (onSubmit recipe, like GoalForm). Choose a
  // NON-default account first: because a plain onSubmit never triggers React 19's
  // form reset, a failure must leave the account (and the typed fields) exactly as
  // the user left them — a useActionState form would revert it and re-file the
  // retry to the WRONG account (#170 critic P1).
  const account = page.getByTestId('txn-account');
  await account.selectOption({ index: 1 });
  const chosen = await account.inputValue();

  await page.getByTestId('txn-descriptor').fill('E2E Bad Amount');
  await page.getByTestId('txn-amount').fill('abc');
  await page.getByTestId('txn-submit').click();

  await expect(page.getByTestId('add-txn-error')).toBeVisible({ timeout: 20000 });
  // Did NOT navigate away (the form posts to itself on the error path).
  await expect(page).toHaveURL(/\/transactions\/new$/);
  // The correction flow preserves the user's work — account, description, amount.
  await expect(account).toHaveValue(chosen);
  await expect(page.getByTestId('txn-descriptor')).toHaveValue('E2E Bad Amount');
  await expect(page.getByTestId('txn-amount')).toHaveValue('abc');
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

  // The register reflects the new category after the action + RSC refresh.
  // Assert on the category CHIP specifically, not the whole row: while the
  // server action is in flight the sibling confirm menu still reads "File as
  // Groceries?" and the old "Dining Out" chip is still present, so a row-level
  // toContainText('Groceries') would pass BEFORE persistence and then race the
  // negative assertion on its default 5s budget. The chip text is just the
  // category name (`t.categoryName` + an aria-hidden icon), so it flips to
  // "Groceries" only once router.refresh() has re-rendered the persisted row.
  const chip = page
    .getByTestId('txn-row')
    .filter({ hasText: label })
    .getByTestId('category-chip');
  await expect(chip).toContainText('Groceries', { timeout: 20000 });
  await expect(chip).not.toContainText('Dining Out', { timeout: 20000 });
});

test('register write-in: create a category inside the picker and refile with it (#136)', async ({ page }) => {
  await signIn(page);

  // Own manual row — golden-safe (DECISIONS #24), same idiom as the recat spec.
  await page.goto('/transactions/new');
  const label = 'E2E Register Write-in';
  await page.getByTestId('txn-descriptor').fill(label);
  await page.getByTestId('txn-amount').fill('11.11');
  await page.getByTestId('txn-category').selectOption('dining');
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions');

  await page.getByTestId('txn-search').fill(label);
  await page.getByTestId('txn-search').press('Enter');
  const row = page.getByTestId('txn-row').filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 20000 });

  await row.getByTestId('category-chip').click();
  await page.getByTestId('category-menu').waitFor();

  // Group-label-aware search applies here too (#137): "bills" matches only the
  // visible "Bills & Utilities" header, no category NAME — must not dead-end.
  await page.getByTestId('cat-search').fill('bills');
  await expect(page.locator('[data-testid="cat-option"]').first()).toBeVisible();

  // The designed write-in path: search the category you WANT, miss, create it
  // right there — the no-match hint sits directly above the add button (which
  // is otherwise below ~84 options in the scroll container).
  const catName = `Padel ${Date.now().toString().slice(-6)}`; // unique per run (retry-safe)
  // iOS focus-zoom guard (#140): on touch devices every form control must be
  // ≥16px — Safari force-zooms the viewport for anything smaller (owner report).
  // This project emulates a touch-primary device, so (pointer: coarse) applies.
  const searchFs = await page
    .getByTestId('cat-search')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(searchFs, 'touch font-size floor (iOS zoom guard)').toBeGreaterThanOrEqual(16);
  await page.getByTestId('cat-search').fill(catName);
  await expect(page.getByTestId('register-cat-no-match')).toBeVisible();

  // Create inside the picker → hands off to the EXISTING two-step confirm
  // (the register never files in one tap — DECISIONS #121).
  await page.getByTestId('register-add-category').click();
  // Prefill (owner request): the search query IS the new-category name — the
  // form opens with it already filled, nothing is retyped.
  await expect(page.getByTestId('register-new-category-name')).toHaveValue(catName);
  await page.getByTestId('register-new-category-submit').click();
  // Server action + inline re-render — give it the same budget as the chip.
  await expect(page.getByTestId('recat-confirm')).toContainText(catName, { timeout: 20000 });
  await page.getByTestId('recat-once').click();

  // Chip-level assertion (#121 idiom): flips only once the persisted row
  // re-renders through router.refresh().
  const chip = row.getByTestId('category-chip');
  await expect(chip).toContainText(catName, { timeout: 20000 });
});

test('register write-in: a create resolving after a row switch never puts the confirm on the wrong row (#136 checker P1)', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  const rows = page.getByTestId('txn-row');
  await expect(rows.nth(1)).toBeVisible();

  // Delay the CREATE action's POST so it resolves AFTER the row switch below.
  let delayed = false;
  await page.route('**/transactions*', async (route) => {
    if (!delayed && route.request().method() === 'POST') {
      delayed = true;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });

  // Row A: open its menu → write-in → submit (create now in flight). Nothing is
  // ever FILED here, and the category row is additive — golden-safe.
  await rows.nth(0).getByTestId('category-chip').click();
  await page.getByTestId('category-menu').waitFor();
  const catName = `Race ${Date.now().toString().slice(-6)}`;
  await page.getByTestId('cat-search').fill(catName); // no-match → button adjacent
  await page.getByTestId('register-add-category').click();
  await page.getByTestId('register-new-category-name').fill(catName);
  await page.getByTestId('register-new-category-submit').click();

  // Mid-flight: switch to row B's menu (the chip is deliberately not
  // pending-gated).
  await rows.nth(1).getByTestId('category-chip').click();
  await page.getByTestId('category-menu').waitFor();

  // When the delayed create resolves, `chosen` is bound to ROW A — row B's open
  // menu must STAY on the category list; the one-tap confirm pane appearing
  // here filed the wrong row before the fix.
  await page.waitForTimeout(2200); // bounded: covers the 1.5s injected delay
  await expect(page.getByTestId('recat-confirm')).toHaveCount(0);
  await expect(page.getByTestId('cat-search')).toBeVisible();
  await page.unroute('**/transactions*');
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

test('register picker dismisses on Escape and returns focus to the chip (#158)', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').first();
  await expect(row).toBeVisible({ timeout: 20000 });

  const chip = row.getByTestId('category-chip');
  await chip.click();
  await expect(page.getByTestId('category-menu')).toBeVisible();

  // Escape closes the whole picker and returns focus to the trigger (keyboard a11y).
  // Fails-old: before #158 the menu had no Escape handler and stayed open.
  await page.getByTestId('cat-search').press('Escape');
  await expect(page.getByTestId('category-menu')).toHaveCount(0);
  await expect(chip).toBeFocused();
});

test('register picker dismisses on an outside click (#158)', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').first();
  await expect(row).toBeVisible({ timeout: 20000 });

  await row.getByTestId('category-chip').click();
  await expect(page.getByTestId('category-menu')).toBeVisible();

  // A mousedown outside the open chip+menu closes it (native-popover behavior).
  // The search box at the top of the page is never under the popover (which opens
  // up or down from a row below it), so it is a reliable "outside" target.
  // Fails-old: before #158 there was no outside-click listener.
  await page.getByTestId('txn-search').click();
  await expect(page.getByTestId('category-menu')).toHaveCount(0);
});

test('register write-in sub-form Escape closes only the sub-form, leaving the picker open (#158)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').first();
  await expect(row).toBeVisible({ timeout: 20000 });

  await row.getByTestId('category-chip').click();
  await expect(page.getByTestId('category-menu')).toBeVisible();

  // Open the "+ New category" sub-form (search a miss so the add button is adjacent).
  await page.getByTestId('cat-search').fill(`Nope ${Date.now().toString().slice(-6)}`);
  await page.getByTestId('register-add-category').click();
  await expect(page.getByTestId('register-new-category-name')).toBeVisible();

  // Escape steps BACK to the category list (two-level), NOT all the way out — this
  // guards the stopPropagation that keeps the new container-level Escape from
  // swallowing the sub-form's own Escape.
  await page.getByTestId('register-new-category-name').press('Escape');
  await expect(page.getByTestId('register-new-category')).toHaveCount(0);
  await expect(page.getByTestId('category-menu')).toBeVisible();
  await expect(page.getByTestId('cat-search')).toBeVisible();
});

test('register write-in sub-form Escape from the group select also steps back one level (#158)', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/transactions');
  const row = page.getByTestId('txn-row').first();
  await expect(row).toBeVisible({ timeout: 20000 });

  await row.getByTestId('category-chip').click();
  await expect(page.getByTestId('category-menu')).toBeVisible();
  await page.getByTestId('cat-search').fill(`Nope ${Date.now().toString().slice(-6)}`);
  await page.getByTestId('register-add-category').click();
  await expect(page.getByTestId('register-new-category-name')).toBeVisible();

  // Escape from a NON-name sub-form control (the group select) must ALSO step back
  // one level, not close the whole picker — two-level Escape lives on the sub-form
  // container, not just the name input. Fails-old: with Escape only on the name
  // input, this Escape bubbled to the menu container and closed everything.
  await page.getByTestId('register-new-category-group').press('Escape');
  await expect(page.getByTestId('register-new-category')).toHaveCount(0);
  await expect(page.getByTestId('category-menu')).toBeVisible();
  await expect(page.getByTestId('cat-search')).toBeVisible();
});
