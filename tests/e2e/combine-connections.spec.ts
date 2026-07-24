/**
 * TASKS L.6 / L.10 — two LIVE connections at one bank pulling the same card.
 *
 * The owner's own state, from his 2026-07-24 /accounts screenshots: two Plaid connections at
 * Chase, each carrying `CREDIT CARD ····0977`, both live, both counting, and — before this build
 * — nothing on the page offering to resolve it, because a reconciliation needs one stale side.
 *
 * What this locks, at the UI:
 *   1. the double count is visible (the seeded card counts twice in net worth), and the card
 *      that offers to fix it renders, naming BOTH connections the way the page names them;
 *   2. confirming it actually fixes the money — the card counts ONCE afterwards — and the one
 *      thing that could not happen here is disclosed rather than swallowed: this environment has
 *      no Plaid credentials, so the token revoke fails, and the flash says so. The local half
 *      (drop one connection, link the pair) commits on its own precisely so a bank that never
 *      answers cannot leave the user half-done;
 *   3. it is reversible — undo puts both rows back to counting separately.
 *
 * Seeding is direct-to-SQLite (better-sqlite3) on the off-tree e2e DB, mirroring reconcile.spec.
 * A throwaway signup user, never the shared demo row (which is fenced out of this feature).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-combine-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** Two LIVE Chase connections, each with the same card ····0977 at $1,000.00. */
function seedDuplicateConnections(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedDuplicateConnections: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const insertItem = db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', 'ins_56', '2026-07-24', ?)`,
    );
    const insertAccount = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, subtype, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'CREDIT CARD', 'CREDIT', '0977', 'credit card', 100000, 'USD')`,
    );
    for (const [n, createdAt] of [
      ['first', '2026-01-01T00:00:00.000Z'],
      ['second', '2026-06-01T00:00:00.000Z'],
    ] as const) {
      const itemId = `e2e-combine-item-${n}-${suffix}`;
      insertItem.run(`e2e-combine-item-row-${n}-${suffix}`, uid, itemId, createdAt);
      insertAccount.run(`e2e-combine-acct-${n}-${suffix}`, uid, `pl-${n}-${suffix}`, itemId);
    }
  } finally {
    db.close();
  }
}

test('a card arriving through two live connections is combined into one, and what did not happen is disclosed', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedDuplicateConnections(email);
  await page.goto('/accounts');

  // The symptom: one real card, counted twice → −$2,000.00 of liabilities.
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/2,000/, { timeout: 20_000 });

  // The offer, naming both connections exactly as the connection list below it does.
  const card = page.getByTestId('combine-connections-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('CREDIT CARD ····0977');
  await expect(card).toContainText('Chase · connection 1 of 2');
  await expect(card).toContainText('Chase · connection 2 of 2');
  // The two claims a reader needs before tapping.
  await expect(card).toContainText('stop being counted twice');
  await expect(card).toContainText('not something this page can undo');

  // Both directions are offered, since neither connection carries anything else.
  await expect(page.getByTestId('combine-connections-alternative')).toBeVisible();

  // Destructive, so it arms before it acts — the prompt names the irreversible half.
  await page.getByTestId('combine-connections-confirm').click();
  await expect(page.getByTestId('combine-connections-confirm-row')).toContainText('can’t be undone', {
    timeout: 20_000,
  });

  // Confirm. The local half — drop one connection, link the pair — commits on its own, so the
  // money is fixed even though Plaid is unreachable in this environment (the seeded access token
  // is not real ciphertext). The card counts ONCE: −$1,000.00.
  await page.getByTestId('combine-connections-confirm-yes').click();
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/1,000/, { timeout: 20_000 });
  await expect(page.getByTestId('combine-connections-card')).toHaveCount(0);
  await expect(page.getByTestId('reconcile-combined')).toBeVisible();

  // …and the one thing that did NOT happen is disclosed rather than swallowed: the bank never
  // confirmed it revoked access.
  await expect(page.getByTestId('manual-success')).toContainText('didn’t confirm it revoked access');

  // Reversible: undo puts both rows back to counting separately.
  await page.getByTestId('reconcile-undo').click();
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/2,000/, { timeout: 20_000 });
});
