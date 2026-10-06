/**
 * DECISIONS #791 — a card payment counts once it leaves checking, before the card side shows it.
 *
 * A throwaway user (never the shared demo row): one checking account, one card whose statement
 * closed May 10 with $2,345.67 due Jun 5, and a "NORTHWIND BANK CRCARDPMT" of exactly $2,345.67
 * that left checking on Jun 5 — while the card side has shown nothing. Before #791 Home demanded
 * the $2,345.67 the checking balance had already paid; now the card is paid and Home names the
 * payment it counted. Every amount is invented. The e2e server pins `DEMO_TODAY=2026-06-10`.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-in-transit-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seed(email: string, withPayment: boolean) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-it-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Northwind Bank', NULL, '2026-06-10', CURRENT_TIMESTAMP)`,
    ).run(`e2e-it-pi-${stamp}`, uid, itemId);
    const chk = `e2e-it-chk-${stamp}`;
    const card = `e2e-it-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '2207', 400000, 'USD')`,
    ).run(chk, uid, `ref-it-chk-${stamp}`, itemId);
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'Northwind Rewards', 'CREDIT', '6631', 290000, 'USD', 2399, 5, 10)`,
    ).run(card, uid, `ref-it-card-${stamp}`, itemId);
    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-04-11', '2026-05-10', '2026-06-05', 234567, 3500, 0)`,
    ).run(`e2e-it-stmt-${stamp}`, card);
    if (withPayment) {
      db.prepare(
        `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
         VALUES (?, ?, '2026-06-05', -234567, 'NORTHWIND BANK CRCARDPMT', 'transfer', 'POSTED', 1, 0)`,
      ).run(`e2e-it-pay-${stamp}`, chk);
    }
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chk, uid);
  } finally {
    db.close();
  }
}

test.describe('a card payment in transit (DECISIONS #791)', () => {
  test('the payment left checking, the card side shows nothing yet: Home counts it paid and says so', async ({ page }) => {
    const email = await signUpThrowaway(page);
    seed(email, true);
    await page.goto('/dashboard');
    const card = page.getByTestId('cash-needed-card');
    await expect(card).toContainText('Cards: nothing due');
    await expect(card.getByTestId('cash-needed-in-transit')).toHaveText(
      'Counted as paid before the card company shows it: $2,345.67 to Northwind Rewards ····6631 (left Everyday Checking Fri, Jun 5). It matches what was left to pay on that card’s statement, to the cent.',
    );
    // /cards says the same, beside its own "Nothing due this cycle".
    await page.goto('/cards');
    await expect(page.getByTestId('scenario-summary')).toContainText('Nothing due this cycle');
    await expect(page.getByTestId('cards-in-transit')).toContainText('$2,345.67 to Northwind Rewards');
  });

  test('control — with no payment out of checking, the bill is still demanded and nothing is named', async ({ page }) => {
    const email = await signUpThrowaway(page);
    seed(email, false);
    await page.goto('/dashboard');
    const card = page.getByTestId('cash-needed-card');
    await expect(card.getByTestId('cash-needed-amount')).toContainText('$2,345.67');
    await expect(card.getByTestId('cash-needed-in-transit')).toHaveCount(0);
  });
});
