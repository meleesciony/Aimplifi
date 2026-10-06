/**
 * DECISIONS #788 — "Money you put in" on /investments, read from the bank side.
 *
 * A throwaway user (never the shared demo row) with a checking account and a
 * linked Vanguard account sends money in by the brokerage's name and by the
 * account's last four, gets some back, and sends money to a brokerage that is
 * not linked. The card must print the year's figure, open each month to the rows
 * behind it, and list what it left out with the reason. Then the shared demo:
 * its seeded $750 a month by last four, read-only (no "Link an account").
 * Every amount is invented. The e2e server pins `DEMO_TODAY=2026-06-10`.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-deposits-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seed(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chk = `e2e-dep-chk-${stamp}`;
    const vg = `e2e-dep-vg-${stamp}`;
    const itemId = `e2e-dep-item-${stamp}`;
    // A healthy Plaid connection synced today vouches the checking record complete through
    // yesterday — so no month reads "missing records" (accountRecords).
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'First Example Bank', NULL, '2026-06-10', CURRENT_TIMESTAMP)`,
    ).run(`e2e-dep-pi-${stamp}`, uid, itemId);
    const account = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, institutionName, currentBalanceCents, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')`,
    );
    account.run(chk, uid, 'plaid', `ref-dep-chk-${stamp}`, itemId, 'Everyday Checking', 'CHECKING', '7712', null, 1250000);
    account.run(vg, uid, 'manual', `ref-dep-vg-${stamp}`, null, 'Vanguard Brokerage', 'INVESTMENT', '5521', 'Vanguard', 4800000);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    const rows: [string, number, string, string][] = [
      ['2025-01-02', -1250, 'BLUE DOOR COFFEE', 'coffee'],
      ['2026-04-06', -60000, 'VANGUARD BUY INVESTMENT', 'investment'],
      ['2026-05-04', -45000, 'ONLINE TRANSFER TO XXXXXX5521', 'transfer'],
      ['2026-05-20', 30000, 'VANGUARD REDEMPTION', 'transfer'],
      ['2026-05-22', -15000, 'ROBINHOOD FUNDS', 'investment'],
    ];
    rows.forEach(([date, cents, desc, cat], i) => txn.run(`e2e-dep-t-${stamp}-${i}`, chk, date, cents, desc, cat));
  } finally {
    db.close();
  }
}

test.describe('money you put in (DECISIONS #788)', () => {
  test('the year, each month’s rows, and what was left out — with the reason', async ({ page }) => {
    const email = await signUpThrowaway(page);
    seed(email);
    await page.goto('/investments');

    const card = page.getByTestId('deposit-history-card');
    await expect(card).toBeVisible();
    // $600.00 + $450.00 in; $300.00 out → $750.00 more in than out.
    await expect(card.getByTestId('deposit-lead')).toHaveText(
      '$1,050.00 put in and $300.00 taken out so far this year — $750.00 more in than out.',
    );
    // By where it went: the last four place $450.00 on the account itself; the brokerage's
    // name places $600.00 in and $300.00 out at the firm, never on one account there.
    const dest = card.getByTestId('deposit-destination');
    await expect(dest).toHaveCount(2);
    await expect(dest.nth(0)).toContainText('Vanguard$600.00 put in · $300.00 taken out');
    await expect(dest.nth(0)).toContainText('Matched by name only — your linked account there is Vanguard Brokerage');
    await expect(dest.nth(1)).toContainText('Vanguard Brokerage$450.00 put in');
    await expect(dest.nth(1)).toContainText('Matched by its last four digits');

    const may = card.locator('[data-testid="deposit-month"][data-month="2026-05"]');
    await expect(may.getByTestId('deposit-month-summary')).toContainText('$450.00 put in · $300.00 taken out');
    await may.getByTestId('deposit-month-summary').click();
    const rows = may.getByTestId('deposit-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('ONLINE TRANSFER TO XXXXXX5521');
    await expect(rows.nth(0)).toContainText('Everyday Checking → Vanguard Brokerage');
    await expect(rows.nth(0)).toContainText('$450.00');
    await expect(rows.nth(1)).toContainText('Vanguard → Everyday Checking');

    // A month with nothing says so rather than disappearing — "None matched", never "nothing moved".
    await expect(card.locator('[data-testid="deposit-month"][data-month="2026-03"]').getByTestId('deposit-month-figure')).toHaveText('None matched');
    await expect(card.getByTestId('deposit-month-missing')).toHaveCount(0);

    const uncounted = card.getByTestId('deposit-uncounted');
    await uncounted.locator('summary').click();
    await expect(uncounted.getByTestId('deposit-uncounted-row')).toHaveCount(1);
    await expect(uncounted.getByTestId('deposit-uncounted-row')).toContainText(
      'Left Everyday Checking. No Robinhood investment account is linked here, so it isn’t counted. Link it on Accounts to count it.',
    );
    await expect(card.getByTestId('deposit-link-account')).toHaveAttribute('href', '/accounts');

    await card.getByTestId('deposit-rule').locator('summary').click();
    await expect(card.getByTestId('deposit-rule')).toContainText('Never seen here: retirement contributions taken out of your paycheck');
  });

  test('the shared demo: $750 a month into the Brokerage by its last four, read-only', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('demo-sign-in').click();
    await page.waitForURL('**/dashboard');
    await page.goto('/investments');
    const card = page.getByTestId('deposit-history-card');
    await expect(card.getByTestId('deposit-lead')).toHaveText(
      '$4,500.00 put in and $2,000.00 taken out so far this year — $2,500.00 more in than out.',
    );
    await expect(card.getByTestId('deposit-months').getByTestId('deposit-month')).toHaveCount(13);
    await expect(card.getByTestId('deposit-link-account')).toHaveCount(0);
    await expect(card.getByTestId('deposit-uncounted')).toHaveCount(0);
  });
});
