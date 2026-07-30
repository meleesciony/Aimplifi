/**
 * Writing a rule FROM the transaction you are looking at (TASKS O.13b).
 *
 * Owner, 2026-07-30, after the rule builder had already shipped:
 *
 *   "From transaction page, whenever clicking a transaction, should have rules
 *    pull up so you can change specifically for that transaction. This should
 *    work for prior and forward transactions. Having to remember which
 *    transaction and how to populate them exactly as written is too cumbersome."
 *
 * Two defects, neither visible to any unit test, because both are about what is
 * on the screen he is standing on:
 *
 *  1. `/rules` accepted NO prefill — the builder took the category list and the
 *     stored rules and nothing else, so every key had to be retyped from memory.
 *  2. The register renders the app's cleaned-up merchant name, never
 *     `rawDescriptor` — so the exact string a rule matches against appeared on no
 *     screen he could reach, and O.13's brand work widened that gap
 *     (`MACYS LENOX SQUARE` displays as `Macy's`, which matches nothing as typed).
 *
 * The spec is built so the prefill cannot pass by accident: the two purchases
 * share the payee and differ in the STORE NUMBER, so the key that arrives from
 * one row matches exactly 1 (itself), and only deleting the volatile chip widens
 * it to 2. A prefill that quietly dropped the number would score 2 immediately
 * and fail the first assertion — which is the point, because a key we widened is
 * a key the reader never typed.
 */
import { expect, test, type Page } from './helpers/test';

/** One warehouse, two visits, two store numbers — the owner's own example. */
const PURCHASES = [
  { descriptor: 'COSTCO WHSE 1084', amount: '212.40' },
  { descriptor: 'COSTCO WHSE #0981', amount: '88.15' },
];
/** A row that must never be swept in. */
const OTHER = { descriptor: 'Lakeshore Learning Mater', amount: '18.65' };

async function signUpThrowaway(page: Page) {
  const email = `e2e-rft-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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

/** Money OUT — the form's default direction, so no `dir-in` click is due. */
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

test('a rule opens from the row, pre-filled with that row’s own statement text', async ({
  page,
}) => {
  await signUpThrowaway(page);
  await addManualAccount(page, 'RFT Checking');
  for (const p of PURCHASES) await addPurchase(page, p.descriptor, p.amount);
  await addPurchase(page, OTHER.descriptor, OTHER.amount);

  await page.goto('/transactions');

  // THE GESTURE HE ASKED FOR: the lever is on the row itself, not on a page he has
  // to find and then retype into.
  // Addressed by its AMOUNT, not by position: both visits are the same payee on
  // the same day, so `.first()` picks whichever the register happens to order
  // first and the chip assertions below would be testing an arbitrary row.
  const costcoRow = page
    .getByTestId('txn-row')
    .filter({ hasText: 'Costco' })
    .filter({ hasText: /212\.40/ });
  await expect(costcoRow).toBeVisible({ timeout: 20000 });
  await costcoRow.getByTestId('txn-rule-link').click();
  await page.waitForURL('**/rules?from=*', { timeout: 20000 });

  // THE SECOND DEFECT, FIXED: the bank's own text is on the screen. The register
  // shows "Costco"; a rule matches this.
  await expect(page.getByTestId('kw-prefill-descriptor')).toContainText('COSTCO WHSE', {
    timeout: 20000,
  });

  // The key arrived as chips, with nothing typed. `whse` proves it came from the
  // STATEMENT text rather than from the display name.
  const chips = page.getByTestId('kw-chip');
  await expect(chips.filter({ hasText: 'costco' })).toHaveCount(1, { timeout: 20000 });
  await expect(chips.filter({ hasText: 'whse' })).toHaveCount(1);
  // …including the volatile store number, flagged but NOT removed for him.
  const storeNumber = chips.filter({ hasText: '1084' });
  await expect(storeNumber).toHaveCount(1);
  await expect(storeNumber).toHaveAttribute('data-volatile', 'true');

  // As prefilled, the key is the most conservative one that matches the row he
  // clicked: itself, and nothing else. If the prefill had silently dropped the
  // store number this would read 2 and the reader would be acting on our guess.
  // Target is deliberately NOT groceries. Measured (normalize.ts:116): the
  // normalizer auto-files `^COSTCO WHSE #` to groceries, so `#0981` arrives filed
  // and `1084` — the same warehouse, spelled without the `#` — does not. That IS
  // the owner's defect shape, and it means a groceries rule would leave one row
  // unchanged and the test would pass without proving the rewrite.
  await page.getByTestId('kw-category').selectOption('household');
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+1\s+transaction\b/, {
    timeout: 20000,
  });

  // HIS GESTURE: delete the part that changes every visit. The count widens to
  // both visits — "prior transactions", measured, not asserted in prose.
  await page.getByTestId('kw-chip-remove-1084').click();
  await page.getByTestId('kw-preview').click();
  await expect(page.getByTestId('kw-preview-count')).toContainText(/Matches\s+2\s+transactions\b/, {
    timeout: 20000,
  });

  // File the history too, and confirm on the register — both prior visits, and
  // never the unrelated row.
  await page.getByTestId('kw-apply-existing').check();
  await page.getByTestId('kw-create').click();
  await expect(page.getByTestId('kw-done')).toContainText('2', { timeout: 20000 });

  await page.goto('/transactions');
  const rows = page.getByTestId('txn-row');
  await expect(rows.filter({ hasText: 'Costco' }).first()).toContainText(/household/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Costco' }).nth(1)).toContainText(/household/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Lakeshore' })).toContainText(/uncategorized/i, {
    timeout: 20000,
  });

  // FORWARD transactions: the rule is stored, so a visit that arrives AFTER it was
  // written files itself with no further gesture. This is the half of his sentence
  // that a backfill count can never prove.
  await addPurchase(page, 'COSTCO WHSE 2277', '45.90');
  await page.goto('/transactions');
  await expect(rows.filter({ hasText: 'Costco' }).first()).toContainText(/household/i, {
    timeout: 20000,
  });
  await expect(rows.filter({ hasText: 'Costco' })).toHaveCount(3, { timeout: 20000 });
});

/**
 * A `from` id that is not this reader's must not leak a descriptor, and must not
 * break the page — it falls back to the blank builder, which is the same surface
 * `/rules` has always been.
 */
test('a foreign or bogus ?from= id renders the ordinary blank builder', async ({ page }) => {
  await signUpThrowaway(page);
  await page.goto('/rules?from=not-a-real-transaction-id');
  await expect(page.getByTestId('kw-input')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('kw-prefill-banner')).toHaveCount(0);
  await expect(page.getByTestId('kw-chip')).toHaveCount(0);
});
