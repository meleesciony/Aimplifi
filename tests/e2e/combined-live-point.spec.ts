/**
 * Owner-reported 2026-10-03: "some of my accounts are being counted twice, specifically 0977".
 *
 * The two `CREDIT CARD ····0977` rows were already combined (an active reconciliation link, the
 * old row zeroed), so no figure doubled — but "Net worth today" listed the combined-away row at
 * $0.00 beside the live one, i.e. the card twice, and the combined-away rows made the change line
 * read "No comparison — N accounts joined since …". Balances here are invented.
 *
 * This spec seeds that exact shape (old Plaid row on a disconnected connection, live Plaid row on
 * a live one, the link already confirmed) and locks the cure on BOTH surfaces that draw the trend:
 * the Today breakdown names the card once, and the change line compares again.
 *
 * Seeding is direct-to-SQLite (better-sqlite3) on the off-tree e2e DB, mirroring
 * combined-accounts.spec.ts; the candidate→confirm path is covered by reconcile.spec.ts.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-livepoint-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** Two calendar days before `liveDate` (YYYY-MM-DD) — a recorded point the trend must draw. The
 *  date comes from the SERVER's own live chip, never this process's clock: the server reads its
 *  business "today" from its own environment (business-today.ts), which this process cannot see. */
function twoDaysBefore(liveDate: string): string {
  const base = new Date(`${liveDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 2);
  return base.toISOString().slice(0, 10);
}

async function serverToday(page: Page): Promise<string> {
  const today = page.getByTestId('net-worth-points').locator('[data-testid^="net-worth-point-"]').last();
  await expect(today).toHaveText('Today', { timeout: 20_000 });
  return (await today.getAttribute('data-testid'))!.replace('net-worth-point-', '');
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
}

function seedCombined0977(email: string) {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedCombined0977: user ${email} not found`);
    const uid = user.id;
    const s = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const liveItem = `e2e-lp-item-${s}`;
    const goneItem = `e2e-lp-gone-${s}`; // the old connection: disconnected, so no PlaidItem row
    const chk = `e2e-lp-chk-${s}`;
    const old0977 = `e2e-lp-old-${s}`;
    const live0977 = `e2e-lp-live-${s}`;

    db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
      `e2e-lp-item-row-${s}`,
      uid,
      liveItem,
    );
    const insAccount = db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, subtype, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, ?, ?, ?, ?, ?, 'USD')`,
    );
    insAccount.run(chk, uid, `pl-chk-${s}`, liveItem, 'Checking', 'CHECKING', 'checking', '1111', 1_000_00);
    insAccount.run(old0977, uid, `pl-old-${s}`, goneItem, 'CREDIT CARD', 'CREDIT', 'credit card', '0977', 6_000_00);
    insAccount.run(live0977, uid, `pl-live-${s}`, liveItem, 'CREDIT CARD', 'CREDIT', 'credit card', '0977', 8_000_00);

    db.prepare(
      `INSERT INTO AccountReconciliation
         (id, userId, predecessorAccountId, successorAccountId, cutoverDate, matchSignal, confidence, confirmedByUserAt)
       VALUES (?, ?, ?, ?, '2025-03-15', 'mask', 'high', CURRENT_TIMESTAMP)`,
    ).run(`e2e-lp-link-${s}`, uid, old0977, live0977);
    return { s, chk, old0977, live0977 };
  } finally {
    db.close();
  }
}

/** One recorded point before the server's today. The snapshot writer keeps recording the
 *  disconnected row (measured live), so it gets one too — the boundary must drop it. */
function seedRecordedPoint(ids: ReturnType<typeof seedCombined0977>, date: string) {
  const db = openDb();
  try {
    const insSnap = db.prepare(
      `INSERT INTO BalanceSnapshot (id, accountId, date, balanceCents, accountType) VALUES (?, ?, ?, ?, ?)`,
    );
    insSnap.run(`e2e-lp-snap-chk-${ids.s}`, ids.chk, date, 900_00, 'CHECKING');
    insSnap.run(`e2e-lp-snap-live-${ids.s}`, ids.live0977, date, 7_950_00, 'CREDIT');
    insSnap.run(`e2e-lp-snap-old-${ids.s}`, ids.old0977, date, 6_000_00, 'CREDIT');
  } finally {
    db.close();
  }
}

async function expectTodayListsTheCardOnce(page: Page, prefix: 'net-worth' | 'accounts-net-worth') {
  const chips = page.getByTestId(`${prefix}-points`).locator(`[data-testid^="${prefix}-point-"]`);
  const today = chips.last();
  await expect(today).toHaveText('Today', { timeout: 20_000 });
  await today.click();
  const liveDate = (await today.getAttribute('data-testid'))!.replace(`${prefix}-point-`, '');
  const rows = page.getByTestId(`${prefix}-constituents-rows-${liveDate}`).locator('li');
  // Checking + the ONE live card. Before the fix: three rows, `CREDIT CARD` twice.
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'CREDIT CARD' })).toHaveCount(1);
  // The figure is untouched: 1,000.00 − 8,000.00, matched to the penny by the panel itself.
  await expect(page.getByTestId(`${prefix}-constituents-sum-${liveDate}`)).toContainText('7,000.00');
  await expect(page.getByTestId(`${prefix}-constituents-reconciled-${liveDate}`)).toBeVisible();
}

test('a combined-away card is not listed in "Net worth today" and the change line compares again', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  const ids = seedCombined0977(email);
  await page.goto('/dashboard');
  seedRecordedPoint(ids, twoDaysBefore(await serverToday(page)));

  await page.goto('/dashboard');
  // (−7,000.00) − (900.00 − 7,950.00) = +50.00. Before the fix: "No comparison — 1 account joined".
  const delta = page.getByTestId('net-worth-delta');
  await expect(delta).toBeVisible({ timeout: 20_000 });
  await expect(delta).not.toContainText('No comparison');
  await expect(delta).toContainText('+$50.00');
  await expectTodayListsTheCardOnce(page, 'net-worth');

  // Second surface: /accounts draws the same trend from its own boundary call.
  await page.goto('/accounts');
  const accountsDelta = page.getByTestId('accounts-net-worth-delta');
  await expect(accountsDelta).toBeVisible({ timeout: 20_000 });
  await expect(accountsDelta).not.toContainText('No comparison');
  await expect(accountsDelta).toContainText('+$50.00');
  await expectTodayListsTheCardOnce(page, 'accounts-net-worth');
});
