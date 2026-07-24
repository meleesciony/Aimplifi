/**
 * L.12 (owner's loudest competitive complaint): the categorization inbox showed
 * "Suggestion: none yet" for local merchants our own ruleset misses, even though
 * Plaid had a category for them — because Plaid's `personal_finance_category` was
 * mapped at ingest but never persisted, and the inbox re-guessed without it.
 *
 * This is the end-to-end lock: seed a throwaway user with an unknown-merchant review
 * row that carries a persisted Plaid guess (`providerCategoryId`), and assert the
 * inbox now offers it as a labelled "Plaid's guess" one-tap suggestion that files the
 * whole group. A throwaway signup user, never the shared demo row: the demo seed has
 * no provider guesses (SimpleFIN/seed rows), so it can only express the "none yet" case.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-provider-sugg-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * A checking account + TWO review rows for one unknown local merchant our ruleset
 * does not recognize (so our own suggestion is null), each carrying a LOW-confidence
 * Plaid guess of `dining`. This is the exact shape a Plaid sync produces for a small
 * merchant Plaid can categorize but our thin table cannot.
 */
function seedUnknownMerchantWithPlaidGuess(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedUnknownMerchantWithPlaidGuess: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 250000, 'USD')`,
    ).run(checkingId, user.id);

    // "Transaction" is a reserved SQLite keyword — quote the table name.
    const insert = db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, merchantId, categoryId, confidenceBps,
          needsReview, isTransfer, status, providerCategoryId, providerCategoryConfidenceBps)
       VALUES (?, ?, ?, ?, 'GOOSE POND BAR GRILLE', NULL, 'uncategorized', 5000, 1, 0, 'POSTED', 'dining', 4000)`,
    );
    insert.run(`e2e-txn-a-${stamp}`, checkingId, '2026-06-09', -2100);
    insert.run(`e2e-txn-b-${stamp}`, checkingId, '2026-06-02', -1850);
  } finally {
    db.close();
  }
}

test('L.12: an unknown merchant with a persisted Plaid guess shows a labelled one-tap suggestion that files the group', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedUnknownMerchantWithPlaidGuess(email);

  await page.goto('/triage');

  // The top group is our unknown merchant. Our OWN pipeline has no suggestion for it
  // (it would show "none yet"), but Plaid's persisted guess now surfaces — labelled.
  const providerSuggestion = page.getByTestId('triage-provider-suggestion');
  await expect(providerSuggestion).toBeVisible();
  await expect(providerSuggestion).toContainText('Plaid'); // disclosed as Plaid's guess, not our verdict
  // It is NOT presented as our confident suggestion, and it is NOT "none yet".
  await expect(page.getByTestId('triage-suggestion')).toHaveCount(0);
  await expect(page.getByTestId('triage-no-suggestion')).toHaveCount(0);

  // The one-tap accept button discloses the guess right on the control, then files
  // BOTH rows of the group in a single tap (the owner's "pick once for all N").
  const accept = page.getByTestId('triage-accept');
  await expect(accept).toContainText("Plaid's guess");
  await accept.click();

  // The group is filed and leaves the queue — the provider suggestion is gone.
  await expect(providerSuggestion).toHaveCount(0, { timeout: 15_000 });
});
