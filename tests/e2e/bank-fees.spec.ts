/**
 * DECISIONS #796 — "Fees you paid" on /coach: the bank fees in the last 12 months of the
 * reader's records, by kind, net of what came back.
 *
 * 1. The shared demo (read-only): nothing in its records is filed as a fee, so the card names
 *    that zero and still prints its rule.
 * 2. A throwaway user (never the demo row) with two overdraft fees (one refunded), a monthly
 *    service fee, a card late fee, an interest charge, an apartment's late fee and an
 *    overdraft-protection transfer the categorizer files as fees: the lead, the kinds largest
 *    first, the refund, the apartment fee listed and not counted, the transfer never "came
 *    back", the interest left out, and a fee row that opens its transaction with the way back
 *    to /coach.
 *
 * Every amount is invented. The e2e server pins `DEMO_TODAY=2026-06-10` for every user, so
 * the window is 2025-06-11 – 2026-06-10.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-fees-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seed(email: string): { lateFeeId: string } {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chk = `e2e-fee-chk-${stamp}`;
    const card = `e2e-fee-card-${stamp}`;
    const itemId = `e2e-fee-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'First Example Bank', NULL, '2026-06-10', CURRENT_TIMESTAMP)`,
    ).run(`e2e-fee-pi-${stamp}`, uid, itemId);
    const account = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, institutionName, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, NULL, ?, 'USD')`,
    );
    account.run(chk, uid, `ref-fee-chk-${stamp}`, itemId, 'Everyday Checking', 'CHECKING', '3318', 250000);
    account.run(card, uid, `ref-fee-card-${stamp}`, itemId, 'Travel Card', 'CREDIT', '6604', 120000);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    const lateFeeId = `e2e-fee-t-${stamp}-late`;
    const rows: [string, string, string, number, string, string][] = [
      // Records begin before the window, so the lead says "in the last 12 months".
      [`e2e-fee-t-${stamp}-0`, chk, '2025-03-02', -1_250, 'BLUE DOOR COFFEE', 'coffee'],
      // The day before the window: never counted.
      [`e2e-fee-t-${stamp}-1`, chk, '2025-06-10', -3_400, 'OVERDRAFT ITEM FEE', 'fees'],
      [`e2e-fee-t-${stamp}-2`, chk, '2026-05-04', -3_400, 'OVERDRAFT ITEM FEE', 'fees'],
      [`e2e-fee-t-${stamp}-3`, chk, '2026-05-05', -3_400, 'OVERDRAFT ITEM FEE', 'fees'],
      [`e2e-fee-t-${stamp}-4`, chk, '2026-05-12', 3_400, 'OVERDRAFT FEE REFUND', 'fees'],
      [`e2e-fee-t-${stamp}-5`, chk, '2026-04-30', -1_500, 'MONTHLY SERVICE FEE', 'fees'],
      [lateFeeId, card, '2026-05-21', -3_900, 'LATE FEE', 'late-fee'],
      // Interest: left out, and named.
      [`e2e-fee-t-${stamp}-7`, card, '2026-05-21', -2_817, 'INTEREST CHARGE ON PURCHASES', 'fees'],
      // Filed as fees, not a bank's or card's: listed, not counted.
      [`e2e-fee-t-${stamp}-8`, chk, '2026-05-01', -5_000, 'APARTMENT LATE FEE', 'fees'],
      // Money in filed as fees that is not a fee coming back.
      [`e2e-fee-t-${stamp}-9`, chk, '2026-05-06', 30_000, 'OVERDRAFT PROTECTION FROM SAVINGS', 'fees'],
    ];
    for (const [id, acct, date, cents, desc, cat] of rows) txn.run(id, acct, date, cents, desc, cat);
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chk, uid);
    return { lateFeeId };
  } finally {
    db.close();
  }
}

test.describe('fees you paid (DECISIONS #796)', () => {
  test('the shared demo: no fees counted, the zero named, the rule printed', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('demo-sign-in').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
    await page.goto('/coach');

    const card = page.getByTestId('bank-fees-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('bank-fees-lead')).toHaveText('No bank or card fees counted in the last 12 months.');
    await expect(card.getByTestId('bank-fees-kinds')).toHaveCount(0);
    // The zero's basis is one tap away.
    await expect(card.getByTestId('bank-fees-rule')).toBeHidden();
    await card.getByTestId('bank-fees-how').locator('summary').click();
    await expect(card.getByTestId('bank-fees-rule')).toBeVisible();
    await expect(card.getByTestId('bank-fees-rule')).toContainText('Fees & Charges, ATM Fee or Late Fee');
  });

  test('a reader’s own fees: by kind, the refund, the not-counted, interest left out, a row one tap away', async ({ page }) => {
    const email = await signUpThrowaway(page);
    const { lateFeeId } = seed(email);
    await page.goto('/coach');

    const card = page.getByTestId('bank-fees-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('bank-fees-lead')).toHaveText(
      'You paid $122.00 in bank and card fees (4 charges) in the last 12 months, and $34.00 in fees came back.',
    );
    const kinds = card.getByTestId('bank-fees-kinds').locator('details');
    await expect(kinds).toHaveCount(3);
    await expect(kinds.nth(0)).toHaveAttribute('data-testid', 'bank-fees-kind-overdraft');
    await expect(kinds.nth(0).locator('summary')).toHaveText('Overdraft and returned-item fees — $68.00 (2 charges)');
    await expect(kinds.nth(1).locator('summary')).toHaveText('Late fees — $39.00 (1 charge)');
    await expect(kinds.nth(2).locator('summary')).toHaveText('Monthly account fees — $15.00 (1 charge)');
    await expect(card.getByTestId('bank-fees-given-back').locator('summary')).toHaveText(
      'Came back — $34.00 (1 fee returned)',
    );
    await expect(card.getByTestId('bank-fees-uncounted').locator('summary')).toHaveText(
      'Filed as fees, not counted — $50.00 (1 charge)',
    );
    await expect(card.getByTestId('bank-fees-left-out')).toContainText(
      'Not counted here: $28.17 of interest and finance charges (1 charge).',
    );

    // Open the late fees and follow the row to its transaction, then back to Coach.
    await kinds.nth(1).locator('summary').click();
    const lateRows = card.getByTestId('bank-fees-rows-late');
    await expect(lateRows).toContainText('May 21, 2026');
    await lateRows.getByTestId('bank-fee-row-link').click();
    await page.waitForURL(`**/transactions/${lateFeeId}?back=_coach`);
    const back = page.getByRole('link', { name: 'Back to your coach' });
    await expect(back).toBeVisible();
    await back.click();
    await page.waitForURL('**/coach');
    await expect(page.getByTestId('bank-fees-card')).toBeVisible();
  });
});
