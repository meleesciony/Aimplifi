/**
 * "Always" makes a rule — and until O.15 slice 3 that rule had no screen.
 *
 * The unit and integration locks prove the two queries now agree. What they cannot
 * see is the thing the reader actually experiences: he taps **Always**, a rule starts
 * filing his money on every future sync, and there was nowhere in the app to look at
 * it, change his mind, or take it back. This spec drives that whole arc through the
 * real pages — mint it with the register's own Always control, find it on /rules,
 * delete it, and prove the transaction it already filed keeps its category.
 *
 * A throwaway account, not the demo: rule surfaces are fenced off the shared demo row
 * (one visitor must never be shown another visitor's rules), the same reason
 * `keyword-rules.spec.ts` signs up its own user.
 *
 * WHY THE TRANSACTION IS SEEDED DIRECTLY (measured, not assumed — the manual-add path
 * was tried first, and the probe that explained the failure is why this note exists):
 * a rule keyed to a payee needs `Transaction.merchantId`, and the ONLY writers of that
 * column are the Plaid and SimpleFIN ingest paths. A row added through
 * /transactions/new carries `merchantId: null`, so the register correctly hides its
 * Always control and no rule can be minted from it. E2E has no offline provider, so
 * the ingest RESULT is seeded — direct to the off-tree SQLite database, the
 * `combined-accounts.spec.ts` / `reconcile.spec.ts` idiom — and everything after that
 * point is the real app: the real picker, the real `recategorize` action, the real
 * rule mint, the real page, the real delete.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const DESCRIPTOR = 'BLUE RIDGE HARDWARE CO';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-inv-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** One provider-shaped card + one uncategorized charge carrying a merchant identity. */
function seedIngestedCharge(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedIngestedCharge: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const accountId = `e2e-inv-acct-${suffix}`;
    const merchantId = `e2e-inv-merch-${suffix}`;
    const txnId = `e2e-inv-txn-${suffix}`;

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'Inventory Card', 'CREDIT', '4242', -50000, 'USD')`,
    ).run(accountId, uid, `sf-inv-${suffix}`);
    // `canonical` is UNIQUE across all users, so reuse the row if a previous run of
    // this spec already created it — the rule is per-user either way.
    db.prepare(`INSERT OR IGNORE INTO Merchant (id, canonical) VALUES (?, ?)`).run(
      merchantId,
      'Blue Ridge Hardware Co',
    );
    const merchant = db
      .prepare('SELECT id FROM Merchant WHERE canonical = ?')
      .get('Blue Ridge Hardware Co') as { id: string };
    db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, rawDescriptor, amountCents, status, merchantId, categoryId, needsReview, confidenceBps)
       VALUES (?, ?, '2026-06-05', ?, -8420, 'POSTED', ?, 'uncategorized', 1, 3000)`,
    ).run(txnId, accountId, DESCRIPTOR, merchant.id);
    return { txnId, merchantId: merchant.id };
  } finally {
    db.close();
  }
}

test('a rule minted by "Always" is visible on /rules and can be deleted', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedIngestedCharge(email);

  // The honest empty state comes FIRST, so the row asserted later cannot be a
  // fixture that was on the page all along.
  await page.goto('/rules');
  await expect(page.getByTestId('inventory-empty')).toBeVisible({ timeout: 20_000 });

  // File the charge for the whole payee — `recategorize` at merchant scope, which
  // mints the durable rule through the same `ensureUnconditionalRule` helper the
  // inbox's Always prompt uses.
  await page.goto('/transactions');
  const target = page.getByTestId('txn-row').filter({ hasText: 'Blue Ridge' }).first();
  await expect(target).toBeVisible({ timeout: 20_000 });
  // The first click after a load can land pre-hydration and drop silently (#167).
  await expect(async () => {
    await target.getByTestId('category-chip').click({ timeout: 2_000 });
    await expect(page.getByTestId('cat-search')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId('cat-search').fill('Home Improvement');
  await page.getByTestId('cat-option').filter({ hasText: 'Home Improvement' }).first().click();
  await expect(page.getByTestId('recat-confirm')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('recat-always').click();
  // The register reloads on commit; the re-rendered chip is the confirmation that
  // cannot lie (the transaction-list idiom).
  await expect(page.getByTestId('txn-row').filter({ hasText: 'Blue Ridge' }).first()).toContainText(
    /home improvement/i,
    { timeout: 20_000 },
  );

  // THE SLICE: the rule is on the page, in the reader's terms, with the payee it is
  // pinned to and the category it will file to.
  //
  // The register commits with `window.location.reload()`, so a `goto` issued while
  // that reload is still in flight is cancelled by it (measured: net::ERR_ABORTED on
  // /rules). Retry the navigation until it lands — the wait is for the previous
  // page's own reload, not for anything this slice does.
  await expect(async () => {
    await page.goto('/rules');
    await expect(page.getByTestId('rule-inventory')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  const row = page.getByTestId('inventory-rule-row');
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await expect(row).toContainText(/blue ridge hardware/i);
  await expect(row).toContainText(/home improvement/i);
  // It is running — not one of the inert rows this list also surfaces.
  await expect(row).toHaveAttribute('data-active', 'true');
  // And it is NOT double-rendered in the typed-rule list beside it.
  await expect(page.getByTestId('kw-rule-row')).toHaveCount(0);

  // Delete it, and it is gone on a fresh request — stored state, not a repaint.
  //
  // The click is retried for the same reason the category-chip click above is
  // (#167): the first click after a navigation can land pre-hydration and drop
  // silently. Measured 2026-07-30 — this test failed twice in the FULL suite (both
  // parallel and serialized, the delete never landing across 43 polls) and passed
  // twice in a row in isolation in ~2s against a 60s budget, i.e. the server was
  // loaded, not the page broken. The ASSERTION is untouched: the row must be gone,
  // and the reload below still proves it was stored rather than repainted. Deleting
  // twice is a no-op (`deleteMany`), so the retry cannot mask a half-delete.
  await expect(async () => {
    await page.getByTestId('inventory-delete').click({ timeout: 2_000 });
    await expect(page.getByTestId('inventory-rule-row')).toHaveCount(0, { timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await page.reload();
  await expect(page.getByTestId('inventory-empty')).toBeVisible({ timeout: 20_000 });

  // Deleting the rule did not un-file the transaction it already filed — the sentence
  // the page prints beside the delete button, asserted rather than promised.
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-row').filter({ hasText: 'Blue Ridge' }).first()).toContainText(
    /home improvement/i,
    { timeout: 20_000 },
  );
});
