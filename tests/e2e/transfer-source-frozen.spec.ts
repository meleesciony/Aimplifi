/**
 * C.7 (CALC_AUDIT P0-2) — the dashboard hero may not tell the reader to move money
 * out of an account whose balance nobody has seen since the feed dropped.
 *
 * The hero prints "Transfer $X from <name> ($Y available)". That is an
 * INSTRUCTION, not a figure (`failure-direction-is-per-role-not-per-value`): its
 * failure mode is a transfer that bounces and a card payment that overdrafts. The
 * page derived its own source list filtering only on `type === 'SAVINGS'` and
 * sorting by balance — and a frozen balance is stale, reads HIGH, and therefore
 * sorts FIRST. Radar applied four guards to the same account array on the same
 * page; the hero applied none.
 *
 * The unit locks (`tests/unit/transfer-source-selection.test.ts`) cover the shared
 * selector. This is the one that fails if a future edit re-derives the source
 * locally on the page — the selector can be perfect and the surface still wrong,
 * which is exactly the class `a-fix-that-cannot-fail-a-test-is-a-hypothesis`
 * recorded (a banner that typechecked, built, passed 225 e2e tests and did
 * nothing).
 *
 * THE FIXTURE'S HARD CASE: the frozen account outranks the live one 10×, so a
 * missing guard is a sort WIN rather than a tie — and the frozen account's
 * presence on the page is asserted through the feed-dropped banner before the
 * absence is asserted anywhere, so this can never pass vacuously because an
 * INSERT silently failed.
 *
 * Throwaway signup user, never the shared demo row (the shared-demo lesson).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The e2e server pins `DEMO_TODAY=2026-06-10` in `.env`; asserted below, not assumed. */
const TODAY = '2026-06-10';
const CARD_DUE_DATE = '2026-06-25';
const DROPPED_AT = '2026-05-20';

const FROZEN_SAVINGS = 'Rainy Day Reserve';
const LIVE_SAVINGS = 'Everyday Savings';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-xfer-src-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
}

function userId(db: Database.Database, email: string): string {
  const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  if (!user) throw new Error(`transfer-source-frozen: user ${email} not found`);
  return user.id;
}

/**
 * A payment account that cannot cover a real statement due this cycle (so the
 * hero produces a transfer recommendation at all), plus two savings accounts:
 * one FROZEN holding ten times more, one LIVE.
 */
function seedShortfallWithFrozenSavings(email: string) {
  const db = openDb();
  try {
    const uid = userId(db, email);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const itemId = `e2e-xfer-item-${stamp}`;
    db.prepare(
      `INSERT INTO PlaidItem (id, userId, itemId, accessToken, institution, institutionId, lastSyncedAt, createdAt)
       VALUES (?, ?, ?, 'ciphertext-not-used-by-this-spec', 'Chase', 'ins_56', ?, CURRENT_TIMESTAMP)`,
    ).run(`e2e-xfer-pi-${stamp}`, uid, itemId, TODAY);

    // $500 against a $9,000 statement — the shortfall is unambiguous.
    const chkId = `e2e-xfer-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Checking', 'CHECKING', '0977', 50000, 'USD')`,
    ).run(chkId, uid, `ref-xfer-chk-${stamp}`, itemId);

    // The trap: stale, large, and therefore first if the guard is missing.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, feedDroppedAt)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'SAVINGS', '9907', 5000000, 'USD', ?)`,
    ).run(`e2e-xfer-frozen-${stamp}`, uid, `ref-xfer-frozen-${stamp}`, itemId, FROZEN_SAVINGS, DROPPED_AT);

    // The only account whose balance anyone can actually vouch for.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, 'SAVINGS', '3318', 500000, 'USD')`,
    ).run(`e2e-xfer-live-${stamp}`, uid, `ref-xfer-live-${stamp}`, itemId, LIVE_SAVINGS);

    const cardId = `e2e-xfer-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency, aprBps, dueDayOfMonth, cycleCloseDayOfMonth)
       VALUES (?, ?, 'plaid', ?, ?, 'Sapphire', 'CREDIT', '4321', 900000, 'USD', 2399, 25, 31)`,
    ).run(cardId, uid, `ref-xfer-card-${stamp}`, itemId);

    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-05-01', '2026-05-31', ?, 900000, 3500, 0)`,
    ).run(`e2e-xfer-stmt-${stamp}`, cardId, CARD_DUE_DATE);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
  } finally {
    db.close();
  }
}

test('the transfer instruction names the live account, never the frozen one holding more', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedShortfallWithFrozenSavings(email);
  await page.reload();

  // The fixture's hard case is PRESENT: the app knows about the frozen account and
  // says so on this very page. Without this, the absence assertion below would
  // also pass if the INSERT had failed and no such account existed at all.
  await expect(page.getByTestId('feed-dropped-banner')).toContainText(FROZEN_SAVINGS);

  const recommendation = page.getByTestId('transfer-recommendation');
  await expect(recommendation).toBeVisible();

  // The whole point: the account that can actually supply the money is named…
  await expect(recommendation).toContainText(`from ${LIVE_SAVINGS}`);
  await expect(recommendation).toContainText('$5,000.00 available');
  // …and the one holding a stale $50,000 is not, anywhere in the instruction.
  await expect(recommendation).not.toContainText(FROZEN_SAVINGS);
});
