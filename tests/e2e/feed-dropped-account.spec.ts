/**
 * TASKS L.14 — an account the bank has STOPPED sharing must stop reading as fresh.
 *
 * Plaid Link's update mode ships with `account_selection_enabled`, so a user can untick an
 * account. Nothing pruned the row, so it kept its last balance, kept counting toward every total,
 * and — because a Plaid row's freshness is graded from its BANK's last sync (#293), and the bank
 * goes on syncing perfectly — kept printing "Synced today" over a figure frozen weeks earlier.
 *
 * This is the end-to-end lock on all four halves of the fix, on the two surfaces a person
 * actually looks at:
 *   1. /accounts stops claiming the row is fresh and says what happened,
 *   2. it states that the balance is STILL counted (this slice adjusts no figure on purpose),
 *   3. Delete is offered without demanding the whole bank be disconnected first,
 *   4. the dashboard says so too, since that is the page most people open.
 *
 * A throwaway signup user, never the shared demo row: the demo seed is a fixed golden dataset and
 * a spec that writes into it leaks into whatever runs next (the shared-demo lesson).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-feed-dropped-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * A live Plaid connection with two accounts: one still shared, one the feed has stopped
 * returning. The connection's own `lastSyncedAt` is TODAY — that is the whole point. Before this
 * slice the dropped row inherited that date and rendered "Synced today"; the assertions below
 * fail if it ever inherits it again.
 */
function seedDroppedAccount(email: string, keptName: string, droppedName: string, droppedAt: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedDroppedAccount: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const today = new Date().toISOString().slice(0, 10);
    const itemId = `e2e-item-${stamp}`;

    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-pi-${stamp}`, user.id, itemId, today);

    const keptId = `e2e-kept-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'CHECKING', '0977', 250000, 'USD')`,
    ).run(keptId, user.id, `ref-kept-${stamp}`, itemId, keptName);

    const droppedId = `e2e-dropped-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'SAVINGS', '4321', 421055, 'USD', ?)`,
    ).run(droppedId, user.id, `ref-dropped-${stamp}`, itemId, droppedName, droppedAt);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(keptId, user.id);
    return { keptId, droppedId };
  } finally {
    db.close();
  }
}

test('an unshared account stops reading as fresh, says it is still counted, and can be deleted', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const keptName = 'Everyday Checking';
  const droppedName = 'Rainy Day Savings';
  seedDroppedAccount(email, keptName, droppedName, '2026-07-19');

  // ── /accounts: the surface that carries the controls ───────────────────────────────────
  await page.goto('/accounts');
  const droppedRow = page.getByTestId('account-feed-dropped');
  await expect(droppedRow).toBeVisible({ timeout: 20_000 });

  // Proof the fixture built the HARD case — one dropped account beside one LIVE one — rather than
  // degrading into a single-row page where every assertion below would pass for the wrong reason.
  // (The previous version compared two ids that are distinct by construction: a tautology wearing
  // a comment claiming it proved something — the same class as the `f(x,[]) === f(x)` test L.15
  // had to delete. Asserted here, on /accounts, because that is where the rows are.)
  await expect(page.getByTestId('account-row')).toHaveCount(2);

  // The regression, stated positively: the row names the event and its own frozen figure. It does
  // NOT re-name the account — the line directly above already paints the name and mask, and
  // repeating them printed the identity twice in two different mask glyphs (critic P2-1).
  await expect(droppedRow).toContainText('Your bank stopped sharing this account on');
  await expect(droppedRow).not.toContainText(droppedName);
  await expect(droppedRow).toContainText('$4,210.55');
  // …and the honest half — this slice deliberately moved no number, so it must say so.
  await expect(droppedRow).toContainText('still counted');
  // Both remedies, because only the user knows which one applies. The re-tick is named only
  // because this fixture's bank IS still connected — that control renders once per connection, so
  // the note must stop naming it once the bank is disconnected (critic F-4).
  await expect(droppedRow).toContainText('tick it again');
  await expect(droppedRow).toContainText('delete the row');

  // The freshness label no longer inherits the BANK's sync date. Scoped to the dropped row's own
  // <li>, because the SIBLING account correctly does read "Synced today" — the connection really
  // did sync today, which is precisely what made the old behaviour so convincing.
  const droppedItem = page.locator('li').filter({ has: page.getByTestId('account-feed-dropped') });
  await expect(droppedItem.getByTestId('account-freshness')).toContainText('stopped sharing');
  await expect(droppedItem.getByTestId('account-freshness')).not.toContainText('Synced today');

  // The still-shared sibling is untouched: exactly one row speaks, and the other still reads as
  // the live account it is.
  await expect(page.getByTestId('account-feed-dropped')).toHaveCount(1);
  const keptItem = page.locator('li').filter({ hasText: keptName }).first();
  await expect(keptItem.getByTestId('account-freshness')).toContainText('Synced today');

  // ── Delete is offered even though the bank is still connected ──────────────────────────
  // Before this slice the control was withheld with "Disconnect the bank first", whose premise
  // (the next sync would bring it back) is false for a row the feed no longer sends.
  const deleteButtons = page.getByTestId('synced-delete');
  await expect(deleteButtons).toHaveCount(1);
  await expect(deleteButtons.first()).toHaveAttribute('aria-label', `Delete ${droppedName}`);

  // ── Dashboard: the page most people open, which carries no account list ────────────────
  await page.goto('/dashboard');
  const banner = page.getByTestId('feed-dropped-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText('One account stopped updating');
  await expect(banner).toContainText(droppedName);
  await expect(banner).toContainText('$4,210.55');
  await expect(banner).toContainText('still counted');
  // It points at the route, never at a position — there is nothing on this page to point at.
  await expect(banner).toContainText('Open Accounts');
  await expect(banner).not.toContainText('below');
});

test('an all-healthy user sees neither the banner nor a row note', async ({ page }) => {
  // The abstention half. A disclosure that renders for everyone is noise, and the demo golden
  // depends on this page being byte-identical when nothing is wrong.
  await signUpThrowaway(page);
  await page.goto('/dashboard');
  await expect(page.getByTestId('cash-needed-card').or(page.getByTestId('empty-dashboard'))).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId('feed-dropped-banner')).toHaveCount(0);
  await page.goto('/accounts');
  await expect(page.getByTestId('account-feed-dropped')).toHaveCount(0);
});
