/**
 * Transaction register + accounts page + manual entry (380×800 viewport).
 *
 * Net worth on the accounts page must equal the dashboard's golden value
 * ($144,804.74 — docs/EDGE_CASES.md §Seed-headline) since both derive from the
 * same account balances.
 *
 * READ-ONLY register/accounts specs run as the shared demo user. Every spec
 * that CREATES data through the manual-entry actions runs as a THROWAWAY
 * signup user (the manual-card-statement.spec pattern): since #244 the demo is
 * read-only for visitor-brought data (`addManualAccount`,
 * `createManualTransaction`, `importTransactionsCsv`, `addHolding` refuse
 * `user-demo` — the shared-account privacy fence), so demo-driven entry specs
 * would only ever see the fence message. Isolation also keeps the demo goldens
 * undisturbed (the #166/#39 lesson). The fence itself has its own spec below.
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { type Page, expect, test } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/** Throwaway signup user — full isolation from the demo goldens (+ the #244 fence). */
async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-txn-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
  return email;
}

/** Add a manual asset on /accounts and wait for its row (reload-confirmed write). */
async function addManualAsset(page: Page, name: string, type: string, value: string) {
  await page.goto('/accounts');
  // First click after a load can land pre-hydration (dropped silently) — the
  // click-and-verify retry is the hydration barrier (#167 critic P1 idiom).
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption(type);
  await page.getByTestId('manual-value').fill(value);
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
    timeout: 20000,
  });
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
  // Throwaway user (#244: demo refuses manual entry) — its whole balance sheet
  // is the one asset we add, so the math is exact and golden-free.
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Test Home', 'REAL_ESTATE', '100000');

  const row = page.getByTestId('manual-account-row').filter({ hasText: 'E2E Test Home' });
  // it lands in the ASSETS group and net worth reflects it
  await expect(page.getByTestId('account-group-asset')).toContainText('E2E Test Home');
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$100,000.00');

  // delete (two-step confirm) → back to the empty state. Post-reload clicks use
  // the click-and-verify retry (hydration barrier, #167 idiom).
  await expect(async () => {
    await row.getByTestId('manual-delete').click({ timeout: 2000 });
    await expect(row.getByTestId('manual-delete-confirm')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });

  // Escape disarms an armed destructive control (2026-07-21 review B1: the six
  // hand-rolled confirms had no keyboard way out — now one shared state machine
  // gives every one of them the same escape hatch). Nothing is deleted here.
  await page.keyboard.press('Escape');
  await expect(row.getByTestId('manual-delete-confirm')).toHaveCount(0);
  await expect(row.getByTestId('manual-delete')).toBeVisible();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Test Home' })).toHaveCount(1);

  await expect(async () => {
    await row.getByTestId('manual-delete').click({ timeout: 2000 });
    await expect(row.getByTestId('manual-delete-confirm')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await row.getByTestId('manual-delete-confirm').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Test Home' })).toHaveCount(0, {
    timeout: 20000,
  });
  // Zero accounts remain → the whole page (incl. the net-worth header) must
  // reflect the deletion, not just the list (cycle-2 critic P2-1).
  await expect(page.getByTestId('accounts-empty')).toBeVisible({ timeout: 20000 });
});

/**
 * REGRESSION #216 — search query silently lost to a pre-hydration fill.
 *
 * The search box used to be a CONTROLLED input (`value={search}` from useState).
 * Text typed before hydration attached the onChange listener never reached React
 * state, and the first render then reset the DOM box to ''. Submitting therefore
 * committed an EMPTY search and pushed `/transactions` — the same URL, so the
 * navigation never committed and the user's query vanished with no feedback.
 * Deterministic on the slow-hydrating mobile-380 project; a real bug for anyone
 * who types and hits Enter on a slow connection.
 *
 * `waitUntil: 'commit'` returns as soon as the response lands, so the fill races
 * hydration exactly as it did in the wild. Fails-old / passes-new.
 */
test('regression #216: a search typed before hydration still commits', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions', { waitUntil: 'commit' });
  await page.getByTestId('txn-search').fill('Blue Bottle');
  await page.getByTestId('txn-search').press('Enter');
  await expect(page).toHaveURL(/q=Blue/, { timeout: 20000 });
  await expect(page.getByTestId('txn-row').first()).toContainText('Blue Bottle');
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

  // Empty-register distinction (#186): an impossible filter shows the
  // "no match" copy, not the "no transactions yet" first-run copy.
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill('ZZZ_NO_MATCH_E2E_186');
  await page.getByTestId('txn-search').press('Enter');
  await expect(page).toHaveURL(/q=ZZZ_NO_MATCH/, { timeout: 20000 });
  await expect(page.getByTestId('txn-empty')).toHaveText(/No transactions match these filters/);
  await expect(page.getByTestId('txn-empty')).not.toContainText(/No transactions yet/);
});

/**
 * Owner report 2026-08-06: a custom window of Aug 6 2024 → Aug 6 2025 on a
 * register whose history starts Mar 25 2026 answered "No transactions match
 * these filters" while "History available from Wed, Mar 25, 2026" sat four
 * lines above it. The unit locks cover the decision; this covers the WIRING —
 * that the page hands the engine the window it actually queried and the bounds
 * it actually printed, which no pure test can see.
 */
test('a window entirely before the register history names the history bound, not the filters', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions?from=2019-01-01&to=2019-12-31');

  const empty = page.getByTestId('txn-empty');
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('txn-empty-before-history')).toBeVisible();
  await expect(empty).not.toContainText(/No transactions match these filters/);

  // The two sentences must name the SAME date. The whole defect was one surface
  // holding the reason while the other blamed the filters, so agreement here is
  // the property under test — not merely that some date rendered.
  const span = await page.getByTestId('txn-history-span').textContent();
  const printed = /History available from (.+)\./.exec(span ?? '')?.[1];
  expect(printed, 'the filter bar must print its history bound').toBeTruthy();
  await expect(empty).toContainText(printed!);

  // The zero is named where the ZERO is, not only in the box below it — the
  // owner's report named the tiles and the count line (critic cycle 1, F2).
  await expect(page.getByText(/0 transactions in this window/)).toBeVisible();

  // The CSV remedy is refused for the shared demo user, and this spec IS that
  // user — so the sentence must not offer it here (critic cycle 1, F1).
  await expect(empty).not.toContainText(/Import a CSV from your bank/);
});

/**
 * K.4 (DECISIONS #436) — F10 from the K.3 critic: a reader narrowed to a card
 * whose history starts INSIDE the chosen window. Before K.4 the span printed
 * the register's GLOBAL oldest (this test's OTHER account holds it — a 2024
 * row) while the empty box blamed the filters: both sentences true, neither
 * about the view, and the before-history branch could not fire because the
 * window's `to` sat after the global bound. With scoped bounds the card's own
 * depth (2026-07-01) is a lower bound on everything further narrowed, the
 * window [2025-01-01..2025-12-31] is disjoint from the view, and the zero
 * names itself in BOTH surfaces.
 *
 * The seed runs directly against the e2e SQLite DB (budget-targets.spec
 * pattern): the demo seed's uniform account depth cannot produce this shape.
 */
function seedDepthAccounts(email: string): { deep: string; shallow: string } {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedDepthAccounts: user ${email} not found`);
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const deep = `e2e-k4-deep-${suffix}`;
    const shallow = `e2e-k4-shallow-${suffix}`;
    const insertAccount = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, ?, 'CHECKING', 250000, 'USD')`,
    );
    insertAccount.run(deep, user.id, `k4-d-${suffix}`, 'Deep Card');
    insertAccount.run(shallow, user.id, `k4-s-${suffix}`, 'Shallow Card');
    const insertTxn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, confidenceBps, needsReview, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, -1234, ?, 'shopping', 9000, 0, 'POSTED', 0, 0)`,
    );
    insertTxn.run(`e2e-k4-txn-deep-${suffix}`, deep, '2024-08-11', 'ANCIENT CHARGE');
    insertTxn.run(`e2e-k4-txn-shallow-${suffix}`, shallow, '2026-07-01', 'NEW CARD CHARGE');
    return { deep, shallow };
  } finally {
    db.close();
  }
}

test('K.4/F10: an account whose history starts inside the window names ITS OWN bound, in both surfaces', async ({ page }) => {
  const { shallow } = seedDepthAccounts(await signUpThrowaway(page));

  // Unfiltered: the register's global oldest — the seed landed and the
  // unfiltered line still speaks for the whole register.
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-history-span')).toContainText('Sun, Aug 11, 2024', { timeout: 20000 });

  // Narrowed to the shallow card with the "Last year" preset: the view's own
  // bound must print — and the empty box must name the same zero. Unscoped,
  // this exact URL printed the 2024 bound and blamed the filters.
  await page.goto(`/transactions?account=${shallow}&from=2025-01-01&to=2025-12-31`);

  const empty = page.getByTestId('txn-empty');
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('txn-empty-before-history')).toBeVisible();
  await expect(empty).not.toContainText(/No transactions match these filters/);

  // The two sentences must name the SAME date — and that date must be the
  // shallow card's own depth, not the deep card's 2024 row.
  const span = await page.getByTestId('txn-history-span').textContent();
  const printed = /History available from (.+)\./.exec(span ?? '')?.[1];
  expect(printed, 'the filter bar must print the SCOPED history bound').toBe('Wed, Jul 1, 2026');
  await expect(empty).toContainText(printed!);

  // The zero is named where the ZERO is, not only in the box below it.
  await expect(page.getByText(/0 transactions in this window/)).toBeVisible();
});

/**
 * Owner report 2026-08-07 ("still not showing up"): a register reading 0
 * transactions and $0.00 × 3 with Type, Account, Category, Class and Period all
 * on their defaults, the search box empty, "No transactions match these
 * filters" in the box — and "History available from Wed, Mar 25, 2026" above
 * it, so the data was there. The only axis that can narrow the set while every
 * control reads its default is `?merchant=`, which the bar rendered nothing
 * for. This covers the WIRING the unit locks cannot see: the page hands the
 * bar the merchant it queried with, and the chip's tap actually lands on the
 * unfiltered register.
 */
test('a merchant filter shows itself, names its own zero, and clears in one tap', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions?merchant=ZZZ_NO_MATCH_E2E_MERCHANT');

  // 1. The filter is on the page now, carrying the name being matched.
  const chip = page.getByTestId('txn-filter-merchant');
  await expect(chip).toBeVisible({ timeout: 20000 });
  await expect(chip).toContainText('ZZZ_NO_MATCH_E2E_MERCHANT');

  // 2. The zero says which zero it is, instead of blaming controls the reader
  //    can see are all set to All.
  const empty = page.getByTestId('txn-empty');
  await expect(page.getByTestId('txn-empty-merchant')).toBeVisible();
  await expect(empty).toContainText('ZZZ_NO_MATCH_E2E_MERCHANT');
  await expect(empty).not.toContainText(/No transactions match these filters/);

  // 3. The data was there the whole time — the same screen prints its bound.
  await expect(page.getByTestId('txn-history-span')).toContainText(/History available from/);

  // 4. One tap, and the register is whole again.
  await chip.click();
  await page.waitForURL((u) => u.pathname === '/transactions' && u.search === '', { timeout: 20000 });
  await expect(page.getByTestId('txn-row').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('txn-filter-merchant')).toHaveCount(0);
});

test('a window that ends before it starts is named as such, not as missing history', async ({ page }) => {
  await signIn(page);
  // Two clicks apart in the real picker: the date inputs carry no min/max.
  await page.goto('/transactions?from=2026-08-01&to=2024-01-01');

  await expect(page.getByTestId('txn-empty-inverted-window')).toBeVisible({ timeout: 20000 });
  const empty = page.getByTestId('txn-empty');
  await expect(empty).toContainText(/ends before it starts/);
  // The defect this replaced: it used to claim the history bound and offer an
  // import, a remedy that cannot empty-proof a window empty by construction.
  await expect(empty).not.toContainText(/History here goes back to/);
  await expect(empty).not.toContainText(/Import a CSV/);
});

test('a window starting after the newest row names the newest row, and points at connections', async ({ page }) => {
  await signIn(page);
  await page.goto('/transactions?from=2099-01-01&to=2099-12-31');

  await expect(page.getByTestId('txn-empty-after-history')).toBeVisible({ timeout: 20000 });
  const empty = page.getByTestId('txn-empty');
  await expect(empty).toContainText(/The latest transaction here is/);
  // No "yet": the realistic cause is a feed that stopped, where waiting is
  // exactly the wrong next action (critic cycle 1, F7).
  await expect(empty).not.toContainText(/nothing in it yet/);
  await expect(empty.getByRole('link', { name: 'Check your connections' })).toBeVisible();
});

test('a malformed date bound no longer takes the register down', async ({ page }) => {
  await signIn(page);
  // Before K.3 this was a 500: `filterTransactions` cast it with an unguarded
  // isoDate (found by the K.3 critic, F5). An unreadable bound is now dropped.
  const res = await page.goto('/transactions?to=banana');
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByTestId('txn-history-span')).toBeVisible({ timeout: 20000 });
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
  // Throwaway user (#244) with one manual checking account to file against.
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Wallet', 'CHECKING', '1000');
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
  // Throwaway user (#244) — as demo, the fence message would mask the amount
  // validation this spec exists to prove. Two accounts so a NON-default choice exists.
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Checking A', 'CHECKING', '500');
  await addManualAsset(page, 'E2E Savings B', 'SAVINGS', '500');
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
  // Throwaway user (#244) operating on its OWN manual row. This also exercises
  // the gap the feature closes: the row is POSTED/auto-filed (never enters
  // triage), yet must still be correctable.
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Recat Wallet', 'CHECKING', '1000');
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
  // Throwaway user (#244) — own manual row, same idiom as the recat spec.
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Write-in Wallet', 'CHECKING', '1000');
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
  //
  // Row B is chosen by MEASUREMENT, not by index. The menu is an `absolute z-50`
  // overlay up to `max-h-72` (288px) anchored inside row A's own <li>, and which
  // side it opens on is decided one-shot at click time from
  // `chipRect.top > innerHeight * 0.55` — so it paints over whichever neighbours
  // it happens to span, above OR below. `nth(1)` was never safe here, only lucky:
  // it depended on the register's absolute scroll position. Adding one line to
  // the filter bar (O.2) pushed row 0's chip far enough down that Playwright had
  // to scroll it into view before clicking, and that scroll put the chip ABOVE
  // the 0.55 threshold — flipping the menu from opening upward to opening
  // downward across rows 1 and 2, whose chips it then swallowed. That click can
  // never recover: `onDocMouseDown` returns early while `pending`, so the
  // in-flight create pins the offending menu open for the full timeout.
  //
  // Measuring keeps the scenario identical (a DIFFERENT row, switched to
  // mid-flight) while making it independent of layout above the register.
  const menuBox = await page.getByTestId('category-menu').boundingBox();
  expect(menuBox, 'row A menu must be laid out before choosing row B').not.toBeNull();
  const rowCount = await rows.count();
  let switchTo = -1;
  for (let i = 1; i < rowCount; i++) {
    const chipBox = await rows.nth(i).getByTestId('category-chip').boundingBox();
    if (!chipBox) continue;
    // Vertical-only: the menu is 288px wide over an 89px chip at the same left
    // edge, so any row it spans vertically is covered horizontally too.
    const clear =
      chipBox.y > menuBox!.y + menuBox!.height || chipBox.y + chipBox.height < menuBox!.y;
    if (clear) {
      switchTo = i;
      break;
    }
  }
  expect(switchTo, "a row whose chip row A's open menu does not cover").toBeGreaterThan(0);

  await rows.nth(switchTo).getByTestId('category-chip').click();
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
  // Throwaway user (#244) with one manual checking account to import into.
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Import Wallet', 'CHECKING', '1000');
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

test('CSV import (H.2): re-importing the same file adds nothing — duplicates reported, depth shown', async ({ page }) => {
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Import Wallet', 'CHECKING', '1000');
  await page.goto('/transactions/import');
  // Hydration barrier (#167 idiom): fill/click only after the form is laid out —
  // a submit racing page load can complete server-side and have its confirmation
  // flight applied to a dying document.
  await expect(page.getByTestId('import-csv-form')).toBeVisible({ timeout: 20000 });

  const csv = ['date,description,amount', '2026-06-02,E2E Backfill Book,-18.75', '2024-03-15,E2E Backfill Rent,-1500.00'].join(
    '\n',
  );

  // First import: 2 fresh rows land, the register floor deepens to 2024. The
  // bounded re-submit retry rides the product's idempotency: under 4-worker
  // shared-SQLite load a confirmation flight is sometimes severed (documented
  // harness class — see the playwright.config workers comment; server-side is
  // always correct, audit-log proven). A severed first result is recovered by
  // the next submit, which then returns the DEDUPE result instead — the register
  // assertion at the end is the authoritative proof either way.
  const result = page.getByTestId('import-result');
  await expect(async () => {
    if (await page.getByTestId('import-submit').isEnabled()) {
      await page.getByTestId('import-csv-text').fill(csv);
      await page.getByTestId('import-submit').click();
    }
    await expect(result).toContainText('transactions', { timeout: 5000 }); // any result rendered
  }).toPass({ timeout: 30000 });

  const first = await result.innerText();
  if (first.includes('Imported 2')) {
    // Fresh-import branch: depth confirmation shows the file's 2024 floor.
    await expect(page.getByTestId('import-depth')).toContainText('history now reaches');
    await expect(page.getByTestId('import-depth')).toContainText('2024');
    await expect(result).not.toContainText('already in your history');
  } else {
    // Retry branch: the first attempt's rows landed unseen, and this submit
    // proved the dedupe through the UI — an all-duplicate run shows no depth
    // claim (nothing was added).
    await expect(result).toContainText('already in your history');
    await expect(page.getByTestId('import-depth')).toHaveCount(0);
  }

  // Second import of the same file: every row already held, nothing new written.
  // Re-submit only after the button leaves `pending` + a settle beat (a real user
  // reads the result first). The inline confirmation is then asserted with a
  // bounded re-submit retry: under 4-worker shared-SQLite load the server
  // action's confirmation flight is sometimes severed (the documented harness
  // class — see the playwright.config workers comment; server-side is always
  // correct, audit-log proven). Re-clicking is exactly what a user would do, and
  // by product design the import is idempotent — re-importing a fully-duplicate
  // file writes nothing, so each retry re-runs the same harmless dedupe.
  await expect(page.getByTestId('import-submit')).toBeEnabled();
  await page.waitForTimeout(750);
  await expect(async () => {
    if (await page.getByTestId('import-submit').isEnabled()) {
      await page.getByTestId('import-csv-text').fill(csv);
      await page.getByTestId('import-submit').click();
    }
    await expect(result).toContainText('Imported 0', { timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await expect(result).toContainText('2 already in your history');
  await expect(page.getByTestId('import-depth')).toHaveCount(0); // nothing added → no depth claim

  // The register still holds exactly ONE copy of each row.
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill('E2E Backfill');
  await page.getByTestId('txn-search').press('Enter');
  await expect(page.getByTestId('txn-row').filter({ hasText: 'E2E Backfill' })).toHaveCount(2);
});

test('CSV import (H.2): a double-pasted export warns with the repeated-row count, then the warning clears on re-import', async ({ page }) => {
  // Critic P1-1: a file that contains the same line twice imports both (the
  // multiset can't tell them apart) but must SAY SO. Same hydration barrier +
  // bounded re-submit retry idiom as the test above (same severed-flight class).
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Import Wallet', 'CHECKING', '1000');
  await page.goto('/transactions/import');
  await expect(page.getByTestId('import-csv-form')).toBeVisible({ timeout: 20000 });

  const csv = [
    'date,description,amount',
    '2026-06-02,E2E Doubled Coffee,-5.75',
    '2026-06-02,E2E Doubled Coffee,-5.75',
    '2026-06-03,E2E Single Book,-18.75',
    '2026-06-04,E2E Single Paycheck,2500.00',
  ].join('\n');
  const result = page.getByTestId('import-result');
  const warning = page.getByTestId('import-repeat-warning');
  await expect(async () => {
    if (await page.getByTestId('import-submit').isEnabled()) {
      await page.getByTestId('import-csv-text').fill(csv);
      await page.getByTestId('import-submit').click();
    }
    await expect(result).toContainText('transaction', { timeout: 5000 }); // any result rendered
  }).toPass({ timeout: 30000 });

  const first = await result.innerText();
  if (first.includes('Imported 4')) {
    // Fresh-import branch: both copies of the doubled row landed, and the
    // file-internal repeat is called out by count.
    await expect(result).toContainText('Imported 4');
    await expect(warning).toContainText('2 identical rows');
  } else {
    // Severed-first-flight branch (documented harness class): this submit proved
    // the dedupe — nothing was kept, so nothing to warn about on this result.
    await expect(result).toContainText('already in your history');
    await expect(warning).toHaveCount(0);
  }

  // Re-import the same file: all four rows already held, nothing kept — the
  // warning must be gone (repeatedRows is 0 when nothing is imported).
  await expect(page.getByTestId('import-submit')).toBeEnabled();
  await page.waitForTimeout(750);
  await expect(async () => {
    if (await page.getByTestId('import-submit').isEnabled()) {
      await page.getByTestId('import-csv-text').fill(csv);
      await page.getByTestId('import-submit').click();
    }
    await expect(result).toContainText('Imported 0', { timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await expect(result).toContainText('4 already in your history');
  await expect(warning).toHaveCount(0);
});

test('demo manual-entry fence (#244): the shared demo account gets an honest inline refusal, and no row lands', async ({ page }) => {
  // The demo is read-only for visitor-BROUGHT data: a typed transaction and a
  // manual account both refuse with the no-shame shared-account message, inline
  // (never the app error boundary), and nothing appears in the register/accounts.
  await signIn(page);

  const label = `E2E Fence ${Date.now().toString().slice(-6)}`;
  await page.goto('/transactions/new');
  await page.getByTestId('txn-descriptor').fill(label);
  await page.getByTestId('txn-amount').fill('42.42');
  await page.getByTestId('txn-category').selectOption('dining');
  await page.getByTestId('txn-submit').click();

  await expect(page.getByTestId('add-txn-error')).toContainText(/shared/i, { timeout: 20000 });
  await expect(page).toHaveURL(/\/transactions\/new$/); // inline, no navigation
  // The typed row never lands in the shared register.
  await page.goto('/transactions');
  await page.getByTestId('txn-search').fill(label);
  await page.getByTestId('txn-search').press('Enter');
  await expect(page.getByTestId('txn-empty')).toBeVisible({ timeout: 20000 });

  // Manual account entry refuses the same way on /accounts.
  await page.goto('/accounts');
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill('E2E Fence House');
  await page.getByTestId('manual-type').selectOption('REAL_ESTATE');
  await page.getByTestId('manual-value').fill('650000');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-error')).toContainText(/shared/i, { timeout: 20000 });
  await expect(page.getByTestId('manual-account-row').filter({ hasText: 'E2E Fence House' })).toHaveCount(0);
  // The demo golden is untouched — the next visitor sees the seed, not our input.
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText('$144,804.74');
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

test('tag a transaction for tax, then export that year from settings (O.1)', async ({ page }) => {
  // The whole slice in one flow, because that is what makes the columns real: a
  // control that writes them, a row that reads them back, and a file that groups
  // them. Throwaway user (#244) on its OWN manual row — the demo account is fenced
  // out of this feature on purpose (one visitor's note would greet the next).
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Tax Wallet', 'CHECKING', '1000');
  await page.goto('/transactions/new');
  const label = 'E2E Tax Pharmacy';
  await page.getByTestId('txn-descriptor').fill(label);
  await page.getByTestId('txn-amount').fill('42.10');
  await page.getByTestId('txn-category').selectOption('pharmacy');
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions');

  await page.getByTestId('txn-search').fill(label);
  await page.getByTestId('txn-search').press('Enter');
  const row = page.getByTestId('txn-row').filter({ hasText: label });
  await expect(row).toBeVisible({ timeout: 20000 });

  // Untagged rows advertise the control without asserting anything about the row.
  const trigger = row.getByTestId('txn-tax-trigger');
  await expect(trigger).toHaveAttribute('data-tagged', 'no');

  await trigger.click();
  await page.getByTestId('txn-tax-panel').waitFor();
  await page.getByTestId('txn-tax-class').selectOption('medical');
  await page.getByTestId('txn-tax-note').fill('Annual check-up, paid out of pocket');
  await page.getByTestId('txn-tax-save').click();

  // Assert on the TRIGGER, not the row: while the save is in flight the open panel
  // still shows the selected option, so a row-level text assertion would pass before
  // anything persisted (the same race the #36 recat spec documents).
  const tagged = page.getByTestId('txn-row').filter({ hasText: label }).getByTestId('txn-tax-trigger');
  await expect(tagged).toHaveAttribute('data-tagged', 'yes', { timeout: 20000 });
  await expect(tagged).toContainText('Medical & dental', { timeout: 20000 });

  // The year the reader just created now exists to export, and the file contains
  // their line, their note, and the sentence that says this is not tax advice.
  await page.goto('/settings');
  const link = page.getByTestId('export-tax-year').first();
  await expect(link).toBeVisible({ timeout: 20000 });
  const href = await link.getAttribute('href');
  expect(href).toContain('format=tax-year-csv');

  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('aimplifi-tax-');
  const csv = await res.text();
  expect(csv).toContain('Medical & dental');
  expect(csv).toContain('Annual check-up, paid out of pocket');
  expect(csv).toContain('not tax advice');
  expect(csv).toContain('-42.10');
});

/**
 * Owner request 2026-07-27, verbatim: "Please make it easier to see unclassified
 * items in activity". "Activity" is this route — it is the nav label for
 * /transactions (app-nav.tsx), even though the page's own h1 says "Transactions".
 *
 * Before this, the register had NO control for review state: not a filter, not a
 * sort, and the category dropdown could never supply one, because the
 * 'uncategorized' placeholder is deliberately stripped from every assignable list
 * (categorize/assign.ts). A reader could only find these rows by scrolling.
 *
 * Driven on the page rather than left to the unit test, because the pure filter
 * being right says nothing about whether the control REACHES the reader — the
 * L.20 lesson (extracting logic makes the logic testable and leaves the rendering
 * untested).
 *
 * A THROWAWAY user carrying its own rows, not the shared demo account. The first
 * cut of this test signed in as demo and asserted the seed's review queue was
 * non-empty; it passed alone and failed in the full suite, because other specs
 * file that queue. Measured at the end of a full run: demo held 847 transactions
 * and ZERO in either population (the seed lays down 17), so the control was
 * correctly hidden and this test failed on its fixture rather than on the
 * behaviour. Owning the rows makes both populations and the classified control
 * group exact — which also lets the counts below be literals instead of
 * whatever the seed happens to contain.
 */
test('the register can isolate items that still need a category, and says how many (owner request)', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAsset(page, 'E2E Unclassified Wallet', 'CHECKING', '1000');

  // THE FIXTURE CARRIES THE DIVERGENCE, not just the easy case. `isUnclassifiedTxn`
  // is a UNION of two populations, and a first cut of this test imported two rows
  // that were BOTH flagged AND placeholder — the intersection — so stripping the
  // union down to `return t.needsReview` left the e2e green (a critic proved it by
  // executing exactly that mutation). Naming the category `uncategorized` explicitly
  // makes the importer honour it verbatim, which yields the divergent half:
  //
  //   Alpha  categoryId=uncategorized  needsReview=1   (both)
  //   Beta   categoryId=uncategorized  needsReview=0   (placeholder, NOT flagged)
  //   Gamma  categoryId=shopping       needsReview=0   (the control group)
  //
  // Gamma is why a filter that returned EVERYTHING would fail. Beta is why a filter
  // reading only the flag would fail — verified: that mutation now fails here with
  // "Expected 2, Received 1". NOT covered by this fixture, honestly: the third
  // state, flagged WHILE carrying a real category, which no import path can produce
  // (`pipeline.ts` forces `uncategorized` whenever it flags) and which only the
  // undo-a-correction path writes. The unit suite locks that half.
  await page.goto('/transactions/import');
  const csv = [
    'date,description,amount,category',
    '2026-06-02,E2E Needs Category Alpha,-11.00,',
    '2026-06-03,E2E Needs Category Beta,-12.00,uncategorized',
    '2026-06-04,E2E Filed Gamma,-13.00,shopping',
  ].join('\n');
  await page.getByTestId('import-csv-text').fill(csv);
  await page.getByTestId('import-submit').click();
  await expect(page.getByTestId('import-result')).toContainText('Imported 3');

  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible();

  // THE FIXTURE'S HARD CASE, asserted present so this can never pass vacuously
  // (the L.29 no-op-lock finding): the control is HIDDEN at zero, so a fixture
  // that stopped producing unclassified rows would otherwise make this test
  // measure an absent control instead of failing.
  const toggle = page.getByTestId('txn-filter-unclassified');
  await expect(toggle).toBeVisible();
  const count = Number((await page.getByTestId('txn-unclassified-count').textContent())?.trim());
  expect(count, 'the two rows imported with no category').toBe(2);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // The iOS touch floor, asserted HERE because this is the only fixture that
  // guarantees the control is rendered at all. `tap-targets.spec.ts` covers only
  // /sign-in and /accounts, and the two gates that do load /transactions run as the
  // shared demo account — whose unclassified count other specs drive to zero, at
  // which point the control is correctly absent and those gates certify nothing
  // about it (measured: fresh seed 16, after phase2-triage 0).
  const box = await toggle.boundingBox();
  expect(box!.height, 'touch target floor (#140)').toBeGreaterThanOrEqual(44);

  const unfilteredRows = await page.getByTestId('txn-row').count();
  expect(unfilteredRows, 'both populations are present, so the filter excludes something').toBe(3);

  // Turning it on narrows the register to exactly that population, and the state is
  // both in the URL (shareable, survives reload) and on the control.
  //
  // Click-and-verify retry, not a bare click (#167 hydration barrier, the idiom
  // `addManualAsset` above already uses). This is the FIRST interaction after
  // `goto('/transactions')`, and a click that lands before hydration attaches the
  // handler is dropped silently — the toggle is a `<button onClick>`, so nothing
  // navigates and the URL assertion below spends its 5s watching an unchanged
  // address bar. It passed locally 25/25 and failed on CI run 31200587384
  // (`13 × unexpected value ".../transactions"`) — a slower runner is exactly the
  // condition this idiom exists for, and the same run dropped an un-barriered
  // click in phase4-features too. Guarding it makes the assertion measure the
  // FILTER rather than the machine's hydration speed.
  // The retry GUARDS the click on the current state, which the plain #167 idiom
  // does not — and that difference is load-bearing here. This control is a
  // TOGGLE: a bare click-and-retry that fires a second click after a first one
  // that actually landed would switch the filter back OFF, and the loop would
  // then flip parity every attempt — a test that passes or fails on whether the
  // retry count came out even. Clicking only while the URL still lacks the
  // param makes every extra attempt a no-op instead.
  await expect(async () => {
    if (!/unclassified=1/.test(page.url())) await toggle.click({ timeout: 2000 });
    await expect(page).toHaveURL(/unclassified=1/, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByTestId('txn-filter-unclassified')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('txn-row')).toHaveCount(count);

  // The count drops only the `unclassified` axis, so it still reads the same from
  // inside the filter — otherwise it would just restate the page's own length.
  expect(Number((await page.getByTestId('txn-unclassified-count').textContent())?.trim())).toBe(count);

  // And it is reversible from inside: a reader who filters must never be stranded.
  await page.getByTestId('txn-filter-unclassified').click();
  await expect(page).not.toHaveURL(/unclassified=1/);
  await expect(page.getByTestId('txn-row')).toHaveCount(unfilteredRows);

  // THE COUNT IS THE BUTTON'S PROMISE, and pressing it is how the promise is kept —
  // so it must move when another filter narrows the register. Arriving pre-filtered
  // is the designed path, not an edge case: O.5's category figures link into this
  // register with `category`, `from` and `to` already set. Before this was fixed the
  // count was taken over the unfiltered register, so it kept printing the global
  // figure over a narrowed list, and under a filter admitting no unclassified row it
  // sat above "No transactions match these filters" still claiming rows.
  //
  // from=2026-06-03 admits Beta (06-03) and Gamma (06-04) but not Alpha (06-02), so
  // exactly one of the two unclassified rows survives.
  await page.goto('/transactions?from=2026-06-03');
  const windowedToggle = page.getByTestId('txn-filter-unclassified');
  await expect(windowedToggle).toBeVisible();
  expect(
    Number((await page.getByTestId('txn-unclassified-count').textContent())?.trim()),
    'the count follows the date filter instead of restating the global figure',
  ).toBe(1);
  await windowedToggle.click();
  await expect(page.getByTestId('txn-row')).toHaveCount(1);

  // The self-contradiction case: a filter admitting NO unclassified row must hide the
  // control rather than offer a number over an empty list.
  await page.goto('/transactions?category=shopping');
  await expect(page.getByTestId('txn-row')).toHaveCount(1); // Gamma, the filed row
  await expect(page.getByTestId('txn-filter-unclassified')).toHaveCount(0);
});
