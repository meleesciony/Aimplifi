/**
 * The transaction detail view (TASKS O.13b) — the acute half of the owner's
 * mandate: *"Currently we can't even solve the transaction list."*
 *
 * Three things were true of a filed transaction before this page existed, and
 * each is asserted below rather than described:
 *
 *  1. Its raw bank text — the string a rule matches against — was on no screen
 *     the reader could reach. The register shows the normalizer's cleaned-up
 *     name (`COSTCO WHSE 1084` → "Costco").
 *  2. SPLIT existed, was tested, and was reachable ONLY from the triage inbox,
 *     so a row that had already been filed could never be split.
 *  3. The row's fields were spread across inline popovers with no one place to
 *     stand on a single transaction.
 *
 * The split assertions are the load-bearing ones, because a split moves money:
 * the register must stop showing the container (or the amount is counted twice)
 * AND the money-out total must be unchanged (or the split invented or destroyed
 * spending). Both directions are checked, on a total measured before the split
 * rather than on a hardcoded figure.
 */
import { expect, test, type Page } from './helpers/test';

const PURCHASE = { descriptor: 'COSTCO WHSE 1084', amount: '212.40' };
/** A second row so the register total is never just the split row itself. */
const OTHER = { descriptor: 'Lakeshore Learning Mater', amount: '18.65' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-detail-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

async function addManualAccount(page: Page, name: string) {
  await page.goto('/accounts');
  // The first click after a load can land pre-hydration and drop silently (#167).
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('2500');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
    timeout: 20000,
  });
}

async function addPurchase(page: Page, descriptor: string, amount: string) {
  await page.goto('/transactions/new');
  await expect(async () => {
    await page.getByTestId('txn-descriptor').fill(descriptor, { timeout: 2000 });
    await expect(page.getByTestId('txn-descriptor')).toHaveValue(descriptor, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-amount').fill(amount);
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions', { timeout: 20000 });
}

test('one transaction, one place: the bank text, the category, and a split the register could not reach', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Detail Checking');
  await addPurchase(page, PURCHASE.descriptor, PURCHASE.amount);
  await addPurchase(page, OTHER.descriptor, OTHER.amount);

  await page.goto('/transactions');
  // Money out BEFORE the split, read off the register itself — the invariant the
  // split must preserve. Hardcoding it would test the seed, not the split.
  const outBefore = await page.getByTestId('summary-out').innerText();

  const row = page.getByTestId('txn-row').filter({ hasText: /212\.40/ });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('txn-detail-link').click();
  // A cuid, not `**/transactions/*` — that glob also matches /transactions/new
  // and /transactions/import, so it would pass on a navigation to the wrong page.
  await page.waitForURL(/\/transactions\/[a-z0-9]{20,}/, { timeout: 20000 });

  // (1) The row's own descriptor, on a reachable screen at last. The register two
  // clicks ago said "Costco"; a rule matches THIS.
  await expect(page.getByTestId('detail-raw-descriptor')).toHaveText('COSTCO WHSE 1084', {
    timeout: 20000,
  });
  // …and the sentence around it is true of THIS row: the account is manual and
  // the text was typed, so the page must not call it a bank statement (critic
  // cycle 1, P1 — this very test creates the manual account that proved it).
  const provenance = page.getByTestId('detail-raw-descriptor').locator('..');
  await expect(provenance).toContainText('You entered this');
  await expect(provenance).not.toContainText('statement');
  await expect(page.getByTestId('detail-account')).toContainText('Detail Checking');
  await expect(page.getByTestId('detail-amount')).toContainText('212.40');

  // (3) The fields are editable here. File it, and the register agrees.
  await page.getByTestId('detail-category-select').selectOption('household');
  await page.getByTestId('detail-category-save').click();
  // Wait on a fact only the SERVER can produce after the write — the provenance
  // badge flipping to "You set this". Asserting the select's own value instead
  // would pass against the pre-reload DOM and let the next click race the reload
  // this control fires (measured: it did exactly that, and the split panel was
  // wiped mid-interaction).
  await expect(page.getByText('You set this')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('detail-category-select')).toHaveValue('household');

  // (2) THE SPLIT, from a row that was already filed — impossible before O.13b.
  await page.getByTestId('detail-split-open').click();
  await page.getByTestId('detail-split-amount').fill('12.40');
  await page.getByTestId('detail-split-first-cat').selectOption('household');
  await page.getByTestId('detail-split-second-cat').selectOption('shopping');
  await page.getByTestId('detail-split-confirm').click();

  // The container now renders its pieces instead of its own editable fields.
  await expect(page.getByTestId('detail-split-parts').locator('li')).toHaveCount(2, {
    timeout: 20000,
  });
  await expect(page.getByTestId('detail-split-parts')).toContainText('12.40');
  await expect(page.getByTestId('detail-split-parts')).toContainText('200.00');

  await page.goto('/transactions');
  // The container is GONE from the list — showing it beside its children would
  // count $212.40 twice.
  await expect(page.getByTestId('txn-row').filter({ hasText: /212\.40/ })).toHaveCount(0, {
    timeout: 20000,
  });
  await expect(page.getByTestId('txn-row').filter({ hasText: /12\.40/ })).toHaveCount(1);
  await expect(page.getByTestId('txn-row').filter({ hasText: /200\.00/ })).toHaveCount(1);
  // …and the money is conserved to the cent. A split re-files spending; it never
  // creates or destroys any.
  await expect(page.getByTestId('summary-out')).toHaveText(outBefore, { timeout: 20000 });

  // (3) U.23 — the SAME conservation, in the file that leaves the app. The register
  // stopped showing the container above; until this slice the CSV still shipped it
  // beside its children, so a reader who exported this exact ledger and summed the
  // amount column in a spreadsheet got $212.40 of spending that never happened —
  // and the app never sees the figure its own file produced.
  const csv = await (await page.request.get('/api/export?format=transactions-csv')).text();
  const amounts = csv
    .split('\r\n')
    .slice(1)
    .filter((l) => l.length > 0 && !l.startsWith('"Note:'))
    .map((l) => l.split(',')[5]);
  expect(amounts).toContain('-12.40');
  expect(amounts).toContain('-200.00');
  // The container, by its amount: present in the file = every split counted twice.
  expect(amounts).not.toContain('-212.40');
  // The column sums to the two purchases this test entered, and not a cent more —
  // measured against the spec's own inputs rather than the seed. The old clause
  // summed -443.45 here, the container counted beside its own children.
  //
  // In integer cents: this file's amount column is the boundary where money becomes
  // a decimal string, and a float sum of those strings is exactly the arithmetic the
  // app forbids itself (rule 3). Note this proves the SPLIT is counted once; it is
  // not a claim that the column equals the app's money-out on any ledger — rows the
  // reader excluded from totals, and transfers, are in the file unmarked (filed as
  // U.26), and this fixture deliberately contains neither.
  const exportedOutCents = amounts
    .map((a) => Math.round(Number(a) * 100))
    .filter((c) => c < 0)
    .reduce((a, b) => a + b, 0);
  const enteredCents = [PURCHASE.amount, OTHER.amount]
    .map((a) => Math.round(Number(a) * 100))
    .reduce((a, b) => a + b, 0);
  expect(exportedOutCents).toBe(-enteredCents);
});

/**
 * The "we could not confirm that write" banner.
 *
 * This exists as a test because the first version of the fix was INERT and
 * shipped green: the query-param constant was imported from the `'use client'`
 * view, and a client module's exports are reference stubs on the server, so the
 * page indexed searchParams with a non-string and the banner could never render.
 * tsc, eslint, the build and every other test passed. Only rendering the URL
 * catches it.
 */
test('the unconfirmed-write banner actually renders, and does not outlive the write', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'Unconfirmed Checking');
  await addPurchase(page, OTHER.descriptor, OTHER.amount);

  await page.goto('/transactions');
  await page.getByTestId('txn-detail-link').first().click();
  await expect(page.getByTestId('txn-detail')).toBeVisible({ timeout: 20000 });
  const detailUrl = new URL(page.url()).pathname;

  // Arriving the way a timed-out write arrives.
  await page.goto(`${detailUrl}?unconfirmed=1`);
  const banner = page.getByTestId('detail-unconfirmed');
  await expect(banner).toBeVisible({ timeout: 20000 });
  // Announced, not merely painted — the panels sit below the fold at 380px.
  await expect(banner).toHaveAttribute('role', 'alert');

  // A CONFIRMED save must not leave it standing: the success path navigates to
  // the bare path rather than reloading, which would preserve the query string
  // and tell the reader we could not confirm a write we just confirmed.
  await page.getByTestId('detail-category-select').selectOption('household');
  await page.getByTestId('detail-category-save').click();
  await expect(page.getByText('You set this')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('detail-unconfirmed')).toHaveCount(0);
});

/**
 * An id that is not this reader's must refuse to render — and must not confirm
 * that someone else's transaction exists. A foreign id and a nonexistent one are
 * the same refusal on purpose (the page never distinguishes them), which is why
 * one bogus id covers both.
 *
 * MEASURED, and recorded rather than asserted: the HTTP status is **200**, not
 * 404. This page is the app's first `notFound()` caller (the root not-found.tsx
 * docblock says so), and the `(app)` layout has already streamed by the time the
 * read resolves, so Next cannot revise the status line it has flushed. What the
 * reader gets is right — the branded "Page not found" screen, no transaction
 * data — so the assertion is on what is on the screen. Residual in docs/STATUS.md.
 */
test('a bogus transaction id renders the not-found page and no transaction', async ({ page }) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'NotFound Checking');
  await addPurchase(page, OTHER.descriptor, OTHER.amount);

  // POSITIVE CONTROL FIRST. Without it this test passes with the route file
  // DELETED — Next's own 404 renders the same heading — so it would assert the
  // absence of a page rather than the refusal of an id (critic cycle 1, P2).
  await page.goto('/transactions');
  await page.getByTestId('txn-detail-link').first().click();
  await expect(page.getByTestId('txn-detail')).toBeVisible({ timeout: 20000 });

  await page.goto('/transactions/not-a-real-transaction-id');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId('txn-detail')).toHaveCount(0);
  await expect(page.getByTestId('detail-raw-descriptor')).toHaveCount(0);
});
