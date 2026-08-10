/**
 * TASKS H.1(b) — the per-connection history-depth line, end to end on /accounts.
 *
 * The owner's standing question is "why haven't we populated 2023-2026 yet" (DECISIONS #421).
 * /transactions answers it once, globally, with "History available from <date>" — and that date
 * is set by whichever single account reaches furthest back. On the live corpus (probe re-run
 * 2026-08-08) that is 2024-08-11, from ONE Chase connection, while twelve other connections
 * start in July 2026. So the global line reads as a claim about all history when it is a claim
 * about one connection. This spec locks the per-bank answer that replaces the guess.
 *
 * Four connections, four different truths, all on one screen — which is exactly the point:
 *   deep    → holds two years of its own rows
 *   empty   → real connection, real account, no transactions at all
 *   claimed → holds rows, owns NONE (every one falls inside a predecessor's claim after a
 *             combine). This is the live Q3 shape, and the state whose COPY is easiest to get
 *             wrong: a date here is a fabrication, "no transactions yet" is false the other way.
 *   mortgage → holds rows the REGISTER never lists (a mortgage is outside registerRowWhere's
 *             spending types). The first cut printed a date here and the critic executed the
 *             contradiction against the real register.
 *
 * Seeding is direct-to-SQLite on the off-tree e2e DB (the duplicate-connections.spec.ts pattern);
 * a demo user cannot be used because /accounts fences the connection controls for the shared demo.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-depth-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedFourConnections(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedFourConnections: user ${email} not found`);
    const uid = user.id;
    const s = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const insItem = db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', ?, '2026-08-08')`,
    );
    const insAcct = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CREDIT', ?, 0, 'USD')`,
    );
    const insTxn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, confidenceBps, needsReview, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, -1234, ?, 'shopping', 9000, 0, 'POSTED', 0, 0)`,
    );

    // 1. deep — two years of its own history, nothing claimed.
    insItem.run(`e2e-depth-item-deep-${s}`, uid, `deep-${s}`, 'Chase');
    insAcct.run(`e2e-depth-acct-deep-${s}`, uid, `pl-deep-${s}`, `deep-${s}`, 'Sapphire', '4411');
    for (const d of ['2024-08-11', '2025-03-02', '2026-08-07']) {
      insTxn.run(`e2e-depth-txn-deep-${d}-${s}`, `e2e-depth-acct-deep-${s}`, d, `DEEP ${d}`);
    }

    // 2. empty — a real connection whose account has never had a transaction.
    insItem.run(`e2e-depth-item-empty-${s}`, uid, `empty-${s}`, 'Truist');
    insAcct.run(`e2e-depth-acct-empty-${s}`, uid, `pl-empty-${s}`, `empty-${s}`, 'Checking', '5522');

    // 4. outside-register — a mortgage-only connection. The rows are real and /transactions
    //    lists none of them (registerRowWhere shows only spending types), so a date here is one
    //    the register denies on the same screenload. Live shape: the Truist item whose only
    //    account is "Mortgage 1192".
    insItem.run(`e2e-depth-item-mortgage-${s}`, uid, `mortgage-${s}`, 'U.S. Bank');
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Mortgage 1192', 'MORTGAGE', '1192', -25000000, 'USD')`,
    ).run(`e2e-depth-acct-mortgage-${s}`, uid, `pl-mortgage-${s}`, `mortgage-${s}`);
    for (const d of ['2026-05-18', '2026-06-18']) {
      insTxn.run(`e2e-depth-txn-mortgage-${d}-${s}`, `e2e-depth-acct-mortgage-${s}`, d, `MORT ${d}`);
    }

    // 3. claimed — every row it holds sits inside its predecessor's claim, so the boundary
    //    gives all of them to the account it was combined with. Predecessor rows run
    //    2026-05-05..2026-07-09 and the cutover is 2026-07-20, so the claim window covers the
    //    successor's rows entirely.
    insItem.run(`e2e-depth-item-claimed-${s}`, uid, `claimed-${s}`, 'American Express');
    insAcct.run(`e2e-depth-acct-claimed-${s}`, uid, `pl-claimed-${s}`, `claimed-${s}`, 'Bonvoy', '7788');
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, NULL, 'Old Bonvoy', 'CREDIT', '7788', 0, 'USD')`,
    ).run(`e2e-depth-acct-pred-${s}`, uid, `sf-pred-${s}`);
    for (const d of ['2026-05-05', '2026-07-09']) {
      insTxn.run(`e2e-depth-txn-pred-${d}-${s}`, `e2e-depth-acct-pred-${s}`, d, `PRED ${d}`);
      insTxn.run(`e2e-depth-txn-claimed-${d}-${s}`, `e2e-depth-acct-claimed-${s}`, d, `SUCC ${d}`);
    }
    db.prepare(
      `INSERT INTO AccountReconciliation
         (id, userId, predecessorAccountId, successorAccountId, cutoverDate, matchSignal, confidence)
       VALUES (?, ?, ?, ?, '2026-07-20', 'mask', 'high')`,
    ).run(
      `e2e-depth-recon-${s}`,
      uid,
      `e2e-depth-acct-pred-${s}`,
      `e2e-depth-acct-claimed-${s}`,
    );
  } finally {
    db.close();
  }
}

test('every bank connection says how far its own history reaches, and none of them guesses', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedFourConnections(email);
  await page.goto('/accounts');
  await expect(page.getByTestId('plaid-connections')).toBeVisible();

  const lines = (await page.getByTestId('plaid-item-history').allInnerTexts()).map((t) => t.trim());
  expect(lines).toHaveLength(4);

  // The deep connection prints its OWN floor, formatted for a reader, not an ISO string.
  // Same verb AND same date shape as the register's own global line — two lines making the
  // same kind of claim must not read as two different claims. The weekday is redundant but
  // `formatISODate`'s only other style drops the YEAR, which a depth claim cannot lose.
  expect(lines).toContain('History available from Sun, Aug 11, 2024.');
  // The empty one says nothing happened, without implying anything was taken away.
  expect(lines).toContain('No transactions yet.');
  // The mortgage-only one never prints a date the register would deny, and never says "yet"
  // about transactions that are never coming (there is no investments ingest in this app).
  expect(lines).toContain("Balances only — investment, loan and mortgage accounts don't send transactions.");
  // The claimed one names where its rows went. Asserted as the whole sentence: the failure this
  // guards is a WRONG sentence, not a missing element.
  expect(lines).toContain(
    'No history of its own — every date it covers belongs to another account. See "Account cleanup" on this page.',
  );

  // The claimed connection must never print a date — that is the fabrication this state exists
  // to prevent, and the predecessor's own dates (May/July 2026) are the ones it would print.
  const claimedRow = page.locator('[data-testid="plaid-item-history"]', { hasText: 'belongs to another account' });
  await expect(claimedRow).toHaveCount(1);
  await expect(claimedRow).not.toContainText('2026');

  // And the page as a whole must not have gone quiet: the depth line is additive, so every
  // connection still renders its status line beside it.
  await expect(page.getByTestId('plaid-item-status')).toHaveCount(4);
});
