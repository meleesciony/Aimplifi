/**
 * DECISIONS #790 — "Money you set aside" on Guilt-free: what the reader actually moved
 * into their linked savings and investment accounts, against the plan's savings line.
 *
 * 1. The shared demo (read-only): $500.00 a month into High-Yield Savings and $750.00 a
 *    month into the Brokerage by its last four — $1,250.00 so far this June; over the 12
 *    complete months Jun 2025 – May 2026, $14,520.00 ($6,000.00 + four $380.00 shop
 *    payouts into savings, + $9,000.00 − $2,000.00 into the Brokerage) → $1,210.00 a month.
 *    The plan's line is not asserted here: other specs add goals to the shared demo.
 * 2. A throwaway user (never the demo row) whose savings account earns interest and
 *    pays a card: interest is listed, never counted; money out of savings counts as out.
 *
 * Every amount is invented. The e2e server pins `DEMO_TODAY=2026-06-10`.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-measured-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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
    const chk = `e2e-ms-chk-${stamp}`;
    const sav = `e2e-ms-sav-${stamp}`;
    const itemId = `e2e-ms-item-${stamp}`;
    // A healthy connection synced today vouches both records complete through yesterday,
    // so no month reads "missing records".
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'First Example Bank', NULL, '2026-06-10', CURRENT_TIMESTAMP)`,
    ).run(`e2e-ms-pi-${stamp}`, uid, itemId);
    const account = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, institutionName, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, NULL, ?, 'USD')`,
    );
    account.run(chk, uid, `ref-ms-chk-${stamp}`, itemId, 'Everyday Checking', 'CHECKING', '2207', 600000);
    account.run(sav, uid, `ref-ms-sav-${stamp}`, itemId, 'Rainy Day Savings', 'SAVINGS', '4419', 900000);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, 0)`,
    );
    const rows: [string, string, number, string, string, number][] = [
      // Records begin before the window; pay in March–May makes a plan.
      [chk, '2025-01-02', -1_250, 'BLUE DOOR COFFEE', 'coffee', 0],
      [sav, '2025-01-02', 2_00, 'INTEREST PAYMENT', 'interest-income', 0],
      [chk, '2026-03-01', 400_000, 'NORTHWIND PAYROLL PPD', 'paycheck', 0],
      [chk, '2026-04-01', 400_000, 'NORTHWIND PAYROLL PPD', 'paycheck', 0],
      [chk, '2026-05-01', 400_000, 'NORTHWIND PAYROLL PPD', 'paycheck', 0],
      [chk, '2026-06-01', 400_000, 'NORTHWIND PAYROLL PPD', 'paycheck', 0],
      // May: $600.00 in, $150.00 out to pay a card, $3.21 interest → +$450.00 set aside.
      [chk, '2026-05-02', -60_000, 'ONLINE TRANSFER TO SAVINGS X4419', 'transfer', 1],
      [sav, '2026-05-02', 60_000, 'ONLINE TRANSFER FROM CHECKING X2207', 'transfer', 1],
      [sav, '2026-05-20', -15_000, 'CARD PAYMENT TO TRAVEL CARD', 'credit-card-payment', 0],
      [sav, '2026-05-31', 321, 'INTEREST PAYMENT', 'interest-income', 0],
      // June so far: $250.00 in.
      [chk, '2026-06-02', -25_000, 'ONLINE TRANSFER TO SAVINGS X4419', 'transfer', 1],
      [sav, '2026-06-02', 25_000, 'ONLINE TRANSFER FROM CHECKING X2207', 'transfer', 1],
    ];
    rows.forEach(([acct, date, cents, desc, cat, isTransfer], i) =>
      txn.run(`e2e-ms-t-${stamp}-${i}`, acct, date, cents, desc, cat, isTransfer),
    );
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chk, uid);
  } finally {
    db.close();
  }
}

test.describe('money you set aside (DECISIONS #790)', () => {
  test('the shared demo: this month, the average, and a month’s rows', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('demo-sign-in').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
    await page.goto('/spending-plan');

    const card = page.getByTestId('measured-savings');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('measured-lead')).toContainText('So far this month you’ve set aside $1,250.00');
    await expect(card.getByTestId('measured-this-month-savings-figure')).toHaveText('+$500.00');
    await expect(card.getByTestId('measured-this-month-investments-figure')).toHaveText('+$750.00');
    await expect(card.getByTestId('measured-average')).toContainText(
      'Over the 12 complete months with full records (Jun 2025 – May 2026), you set aside an average of $1,210.00 a month.',
    );

    // March 2026: $500.00 + $380.00 into savings, $750.00 in and $2,000.00 back out of the Brokerage.
    const march = card.locator('[data-testid="measured-month"][data-month="2026-03"]');
    await expect(march.getByTestId('measured-month-figure')).toHaveText('−$370.00');
    await march.getByTestId('measured-month-summary').click();
    await expect(march.getByTestId('measured-month-savings-figure')).toHaveText('+$880.00');
    await expect(march.getByTestId('measured-month-investments-figure')).toHaveText('−$1,250.00');
    await march.getByTestId('measured-month-savings-rows-toggle').click();
    await expect(march.getByTestId('measured-savings-row')).toHaveCount(2);

    // The plan's Savings legend opens this section.
    await expect(page.getByTestId('plan-legend-savings')).toHaveAttribute('href', '#money-set-aside');
  });

  test('a reader’s own savings: interest listed, never counted; a card paid from savings counts as out', async ({ page }) => {
    const email = await signUpThrowaway(page);
    seed(email);
    await page.goto('/spending-plan');

    const card = page.getByTestId('measured-savings');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('measured-lead')).toContainText('So far this month you’ve set aside $250.00');

    const may = card.locator('[data-testid="measured-month"][data-month="2026-05"]');
    await expect(may.getByTestId('measured-month-figure')).toHaveText('+$450.00');
    await may.getByTestId('measured-month-summary').click();
    await expect(may.getByTestId('measured-month-savings-figure')).toHaveText('+$450.00');
    await expect(may.getByTestId('measured-month-earnings-figure')).toHaveText('+$3.21');
    // No investment account is linked: no "Investment accounts" line at all, never a bare $0.00.
    await expect(may.getByTestId('measured-month-investments')).toHaveCount(0);
  });
});
