/**
 * Wave 4.6 slice 5 — cross-provider reconciliation, end to end.
 *
 * The exact scenario from the spec (§10 slice 5): seed a SimpleFIN account, "connect" a live Plaid
 * twin (same mask), and prove that linking them stops net worth from double-counting the balance —
 * driving the REAL confirm/undo server actions through the /accounts UI, then reversing it (R9).
 *
 * Seeding is direct-to-SQLite (better-sqlite3) on the off-tree e2e DB, mirroring
 * mobile-overflow.spec.ts. The two accounts differ only by provider + balance; the shared mask
 * ····1234 gives the #192 detector a high-confidence match, and the missing SimpleFinConnection
 * (vs. the present PlaidItem) makes exactly the Plaid side live — the R3 direction the candidate
 * engine requires.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-reconcile-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** A stale SimpleFIN predecessor ($2,400.00) + a live Plaid successor ($2,500.00), same mask. */
function seedReconcilePair(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedReconcilePair: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-recon-item-${suffix}`;
    // Stale SimpleFIN predecessor — no SimpleFinConnection row, so it is NOT live.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'Chase Checking (old)', 'CHECKING', '1234', 240000, 'USD')`,
    ).run(`e2e-recon-pred-${suffix}`, uid, `sf-${suffix}`);
    // Live Plaid successor — its PlaidItem exists, so isAccountLive() is true.
    db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
      `e2e-recon-item-row-${suffix}`,
      uid,
      itemId,
    );
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Chase Checking', 'CHECKING', '1234', 250000, 'USD')`,
    ).run(`e2e-recon-succ-${suffix}`, uid, `pl-${suffix}`, itemId);
  } finally {
    db.close();
  }
}

test('reconciling a stale account with its live twin stops net worth from doubling, and undo restores it', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedReconcilePair(email);
  await page.goto('/accounts');

  // Both accounts count → $2,400 + $2,500 = $4,900.00, and a "continue this account?" candidate.
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/4,900/, { timeout: 20_000 });
  await expect(page.getByTestId('reconcile-candidates')).toBeVisible();

  // Combine → the stale predecessor stops counting → $2,500.00, and the pair is disclosed once.
  await page.getByTestId('reconcile-confirm').click();
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/2,500/, { timeout: 20_000 });
  await expect(page.getByTestId('reconcile-combined')).toBeVisible();
  await expect(page.getByTestId('reconcile-candidates')).toHaveCount(0);
  await expect(page.getByTestId('duplicate-accounts-warning')).toHaveCount(0);

  // Undo → both count again → $4,900.00, and the candidate returns (R9 reversible).
  await page.getByTestId('reconcile-undo').click();
  await expect(page.getByTestId('accounts-net-worth-amount')).toHaveText(/4,900/, { timeout: 20_000 });
  await expect(page.getByTestId('reconcile-candidates')).toBeVisible();
});
