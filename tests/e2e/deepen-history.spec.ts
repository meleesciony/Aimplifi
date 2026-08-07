/**
 * H.6 / DECISIONS #424 — the door to Plaid's full 730-day window, end to end.
 *
 * Owner, 2026-08-07: *"Unacceptable we don't have at least plaid maximal dates."* He was right,
 * and the cause was ours: Plaid freezes an Item's history window when Transactions is added to it
 * (*"Once Transactions has been added to an Item, this value cannot be updated"*,
 * plaid.com/docs/api/link/), so reaching two years means a NEW Item returning the SAME accounts —
 * and `decideAndPersistItem` was handing exactly that shape straight back to Plaid as a
 * duplicate. The provider half of the fix is locked in tests/unit/plaid-link-collision-wiring
 * (real provider, real database, stubbed Plaid). This file locks the half a unit test cannot
 * reach: that the owner can FIND the door, and that it says what it costs before he taps it.
 *
 * What is deliberately NOT asserted here: the Plaid Link session itself. Opening it needs a live
 * link token from a real Plaid, which this environment has no credentials for — so the outcome
 * of the link (kept, not discarded) is proven in the unit gate against a stubbed Plaid server,
 * and what this spec proves is the affordance and its disclosure.
 *
 * Seeding is direct-to-SQLite on the off-tree e2e DB — the duplicate-connections.spec pattern.
 * A demo user cannot be used: the connect controls are demo-fenced, and a demo user owns no
 * PlaidItem row, which is the very condition that decides whether this panel renders.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-deepen-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** One ordinary live Plaid connection carrying one card — the state every one of the owner's
 *  thirteen connections is in: linked, healthy, and ninety days deep. */
function seedOneConnection(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedOneConnection: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-deepen-item-${suffix}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, lastSyncedAt)
       VALUES (?, ?, ?, 'ct-e2e', 'Chase', '2026-08-07')`,
    ).run(`e2e-deepen-item-row-${suffix}`, uid, itemId);
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'CREDIT CARD', 'CREDIT', '0977', 120000, 'USD')`,
    ).run(`e2e-deepen-acct-${suffix}`, uid, `pl-deepen-${suffix}`, itemId);
  } finally {
    db.close();
  }
}

test.describe('H.6 — reaching Plaid’s full two years', () => {
  test('the door exists on /accounts, and says what it costs before it is tapped', async ({
    page,
  }) => {
    const email = await signUpThrowaway(page);
    seedOneConnection(email);
    await page.goto('/accounts');

    const panel = page.getByTestId('deepen-history-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('deepen-history-btn')).toBeVisible();

    // The four things the owner must know BEFORE the tap, because after it he owns two
    // connections to one bank and a figure that counts twice until he finishes.
    const explainer = page.getByTestId('deepen-history-explainer');
    await expect(explainer).toBeVisible();
    // 1. Why a second connection is the only way — otherwise this reads as the duplicate bug
    //    he reported, arriving from the app that promised to refuse it.
    await expect(explainer).toContainText(/can’t be widened afterwards/);
    // 2. That he must share the SAME accounts — combine refuses a direction that would strand
    //    an account, so ticking fewer this time silently forecloses the last step.
    await expect(explainer).toContainText(/the same accounts/);
    // 3. That the double-count is real and temporary.
    await expect(explainer).toContainText(/count twice/);
    // 4. What combining COSTS him. An earlier draft of this page promised the opposite — that
    //    his categories and notes would simply stay — and a fresh-context critic executed the
    //    combine and disproved it: the cutover clamps to the old account's first transaction
    //    whenever the new connection reaches further back, which is exactly what a successful
    //    deepen guarantees, so hand-filed work on the old copies stops being applied. The
    //    caveat is a separate element from the explainer so it cannot be lost in an edit to
    //    the paragraph above it.
    const caveat = page.getByTestId('deepen-history-caveat');
    await expect(caveat).toBeVisible();
    await expect(caveat).toContainText(/stop being applied/);
    await expect(caveat).toContainText(/Nothing is deleted and no balance changes/);
  });

  test('the door is not offered to someone with no bank connected', async ({ page }) => {
    // With nothing to deepen there is nothing to say: the ordinary Connect front door already
    // asks Plaid for the full window, so offering "get the full two years" here would send a
    // first-time user down a two-connection flow to reach what one connection gives them.
    await signUpThrowaway(page);
    await page.goto('/accounts');

    await expect(page.getByTestId('connect-bank-btn').first()).toBeVisible();
    await expect(page.getByTestId('deepen-history-panel')).toHaveCount(0);
  });
});
