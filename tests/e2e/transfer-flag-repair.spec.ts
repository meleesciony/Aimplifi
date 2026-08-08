/**
 * H.7b — the transfer-flag repair, end to end: the /settings card states the
 * change before it happens, the apply clears exactly the declined flags, and
 * Undo puts them back — all read from the rendered page plus the database, so
 * the claim survives the round trip.
 *
 * Corpus = the live defect in miniature (see the server test): a settled
 * income row + a settled card purchase flagged by the old coincidence rule
 * (declined today — the card cannot be a sending leg), and a genuine
 * checking→brokerage funding pair (endorsed today — never touched).
 *
 * Throwaway signup user, never the shared demo row (the shared-demo lesson;
 * the demo user is fenced from this write anyway).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-tfr-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: 15_000 });
}

function seed(email: string): { incomeId: string; cardId: string; fundOutId: string } {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const uid = user.id;
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const mkAccount = db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 1000000, 'USD')`,
    );
    const chk = `e2e-tfr-chk-${stamp}`;
    const card = `e2e-tfr-card-${stamp}`;
    const brk = `e2e-tfr-brk-${stamp}`;
    mkAccount.run(chk, uid, 'Everyday Checking', 'CHECKING');
    mkAccount.run(card, uid, 'Rewards Card', 'CREDIT');
    mkAccount.run(brk, uid, 'Brokerage', 'INVESTMENT');

    const insert = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, needsReview, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 1, 0, 0)`,
    );
    const incomeId = `e2e-tfr-income-${stamp}`;
    const cardId = `e2e-tfr-cardrow-${stamp}`;
    const fundOutId = `e2e-tfr-fundout-${stamp}`;
    // DECLINED pair: |$500|, two days apart, sender is a CREDIT card.
    insert.run(incomeId, chk, '2026-05-03', 50_000, '5006-DB/CR-CEF I CEF IV PPD', 'income');
    insert.run(cardId, card, '2026-05-01', -50_000, 'KALSHI INC PAYMENT', 'entertainment');
    // ENDORSED pair: checking sends to brokerage.
    insert.run(fundOutId, chk, '2026-05-10', -200_000, 'WIRE OUT 20260510', 'groceries');
    insert.run(`e2e-tfr-fundin-${stamp}`, brk, '2026-05-11', 200_000, 'INCOMING WIRE', 'income');

    return { incomeId, cardId, fundOutId };
  } finally {
    db.close();
  }
}

function flagOf(id: string): number {
  const db = openDb();
  try {
    const row = db.prepare('SELECT isTransfer FROM "Transaction" WHERE id = ?').get(id) as {
      isTransfer: number;
    };
    return row.isTransfer;
  } finally {
    db.close();
  }
}

test('the repair card states the change, applies it, and undoes it', async ({ page }) => {
  const email = await signUpThrowaway(page);
  const { incomeId, cardId, fundOutId } = seed(email);

  // 1. The preview states what will change, before anything changes.
  await page.goto('/settings');
  const claim = page.getByTestId('transfer-repair-claim');
  await expect(claim).toContainText('2 transactions are being left out of your totals');
  await expect(claim).toContainText('$500.00 of money out and $500.00 of money in');
  await expect(claim).toContainText('1 of them is categorised as income.');

  // The rows themselves are shown behind the disclosure.
  await page.getByTestId('transfer-repair-card').locator('summary').click();
  await expect(page.getByTestId('transfer-repair-rows')).toContainText('KALSHI INC PAYMENT');

  // 2. Apply. The page reloads; the rendered state is the confirmation.
  await page.getByTestId('transfer-repair-apply').click();
  await expect(page.getByTestId('transfer-repair-nothing')).toContainText('Nothing needs repair', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('transfer-repair-last-run')).toContainText(
    'Most recent repair: restored 2 transactions',
  );

  // The database agrees: declined flags cleared, endorsed flag untouched.
  expect(flagOf(incomeId)).toBe(0);
  expect(flagOf(cardId)).toBe(0);
  expect(flagOf(fundOutId)).toBe(1);

  // 3. Undo. The flags return, the run reads as undone, and the preview offers
  // the repair again — the rows are once more flagged and declined.
  await page.getByTestId('transfer-repair-undo').click();
  await expect(page.getByTestId('transfer-repair-undone-line')).toContainText('was undone', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('transfer-repair-claim')).toContainText(
    '2 transactions are being left out of your totals',
  );
  expect(flagOf(incomeId)).toBe(1);
  expect(flagOf(cardId)).toBe(1);
});
