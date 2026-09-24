/**
 * L.12 (owner's loudest competitive complaint): the categorization inbox showed
 * "Suggestion: none yet" for local merchants our own ruleset misses, even though
 * Plaid had a category for them — because Plaid's `personal_finance_category` was
 * mapped at ingest but never persisted, and the inbox re-guessed without it.
 *
 * Two end-to-end locks, one per suggestion ladder:
 *   1. (#303) a descriptor our ruleset STILL misses, carrying a persisted Plaid
 *      guess → the inbox offers it as a labelled "Plaid's guess" one-tap suggestion.
 *   2. (L.12(c)) the owner's exact merchant ("Goose Pond Bar Grille"): the widened
 *      `GRILLE?S?` dining token now catches it, so rows ALREADY sitting in review
 *      with no provider guess get OUR OWN confident one-tap suggestion — the queue
 *      heals on read (triage re-runs categorize() per row), no data backfill.
 * A throwaway signup user, never the shared demo row: the demo seed has
 * no provider guesses (SimpleFIN/seed rows), so it can only express the "none yet" case.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
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
 * A checking account + TWO review rows for one merchant descriptor, shaped exactly
 * like rows the 2026-07-24 screenshot complained about: stored `uncategorized` /
 * needsReview (they sit in the inbox), optionally carrying a LOW-confidence Plaid
 * guess of `dining` — the exact shape a Plaid sync produces for a small merchant
 * Plaid can categorize but our table cannot.
 */
function seedReviewRows(
  email: string,
  opts: { descriptor: string; withProviderGuess: boolean },
) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedReviewRows: user ${email} not found`);
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
       VALUES (?, ?, ?, ?, ?, NULL, 'uncategorized', 5000, 1, 0, 'POSTED', ?, ?)`,
    );
    const providerCategoryId = opts.withProviderGuess ? 'dining' : null;
    const providerBps = opts.withProviderGuess ? 4000 : null;
    insert.run(`e2e-txn-a-${stamp}`, checkingId, '2026-06-09', -2100, opts.descriptor, providerCategoryId, providerBps);
    insert.run(`e2e-txn-b-${stamp}`, checkingId, '2026-06-02', -1850, opts.descriptor, providerCategoryId, providerBps);
  } finally {
    db.close();
  }
}

test('L.12: an unknown merchant with a persisted Plaid guess shows a labelled one-tap suggestion that files the group', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  // "GOOSE POND HIDEAWAY" is a verified true miss of the ruleset (categorize() →
  // uncategorized, needsReview), so this spec still exercises the PROVIDER ladder:
  // our own pipeline has no suggestion ("none yet"), but Plaid's persisted guess
  // surfaces — labelled.
  seedReviewRows(email, { descriptor: 'GOOSE POND HIDEAWAY', withProviderGuess: true });

  await page.goto('/triage');

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
  await expect(providerSuggestion).toHaveCount(0, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
});

test('L.12(c): the owner Grille merchant our widened dining rule catches shows our own one-tap suggestion on rows already in review', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  // The owner's live shape: "GOOSE POND BAR GRILLE" rows sitting in review from
  // BEFORE the ruleset fix, with NO provider guess persisted (pre-#303 Plaid rows).
  // The inbox re-runs categorize() on read, so the widened \bGRILLE?S?\b token
  // revives the suggestion on the existing queue — no data backfill needed.
  seedReviewRows(email, { descriptor: 'GOOSE POND BAR GRILLE', withProviderGuess: false });

  await page.goto('/triage');

  // OUR OWN confident suggestion now exists where the 2026-07-24 screenshot said
  // "Suggestion: none yet" — and it outranks every fallback by construction.
  const suggestion = page.getByTestId('triage-suggestion');
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText(/dining/i);
  await expect(page.getByTestId('triage-provider-suggestion')).toHaveCount(0);
  await expect(page.getByTestId('triage-no-suggestion')).toHaveCount(0);

  // One tap files BOTH rows of the group ("pick once for all N"); the group then
  // leaves the queue and the suggestion with it.
  const accept = page.getByTestId('triage-accept');
  await expect(accept).toContainText('File all 2');
  await accept.click();
  await expect(suggestion).toHaveCount(0, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
});
