/**
 * O.6 critic P1-4 — the two /budgets narrowings that nothing could fail on.
 *
 * The slice's own drill-down spec runs as the shared DEMO account, and the demo
 * cannot see either change:
 *   - its only PENDING rows sit on CHECKING/CREDIT accounts, so removing the
 *     `status: 'POSTED'` clause is visible there (that much IS locked), but
 *   - it has ZERO transactions on a non-spending account, so the newly added
 *     `type: { in: SPENDING_ACCOUNT_TYPES }` clause — described in the diff as
 *     "a plain defect" — had no coverage of any kind. Deleting it again would
 *     have left the whole suite green.
 *
 * This seeds a user whose grocery total is only correct if BOTH clauses hold, so
 * each one is load-bearing on a hand-computed figure:
 *   CHECKING  −$40.00 POSTED   ✓ counts
 *   CHECKING  −$25.00 PENDING  ✓ counts   (drop it and the page reads $40.00)
 *   INVESTMENT −$90.00 POSTED  ✗ excluded (count it and the page reads $155.00)
 *   ⇒ Groceries must read exactly $65.00.
 *
 * A throwaway signup user, never the shared demo row (the shared-demo lesson).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const POSTED_CENTS = -4000;
const PENDING_CENTS = -2500;
const INVESTMENT_CENTS = -9000;
/** −(POSTED + PENDING), the only total both clauses together can produce. */
const EXPECTED = '$65.00';
/**
 * The e2e server pins `DEMO_TODAY=2026-06-10` in `.env`, and that pin applies to
 * EVERY user, not just the demo row (`business-today.ts:34` — precedence 1, ahead
 * of the demo-user branch). So the month /budgets renders is June 2026 regardless
 * of the wall clock, and a fixture dated "today" lands in the wrong month and
 * renders "No spending recorded yet this month" — which is exactly how the first
 * draft of this spec failed.
 */
const IN_MONTH = '2026-06-05';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-budgets-basis-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedBasisFixture(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedBasisFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    // The account type the missing clause let through. A brokerage's activity is
    // not cash spending (DECISIONS #62) — but nothing stops it carrying a
    // spending category, which is exactly how it reached a budget figure.
    const brokerageId = `e2e-inv-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Brokerage', 'INVESTMENT', '5555', 1200000, 'USD')`,
    ).run(brokerageId, user.id, `ref-inv-${stamp}`);

    // "Transaction" is a SQLite reserved word — it must be quoted or `prepare`
    // fails with a syntax error at the table name.
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, 'groceries', ?, 0, 0)`,
    );
    txn.run(`e2e-t1-${stamp}`, checkingId, IN_MONTH, POSTED_CENTS, 'SAFEWAY #1234', 'POSTED');
    txn.run(`e2e-t2-${stamp}`, checkingId, IN_MONTH, PENDING_CENTS, 'WHOLE FOODS MKT', 'PENDING');
    txn.run(`e2e-t3-${stamp}`, brokerageId, IN_MONTH, INVESTMENT_CENTS, 'SAFEWAY #9999', 'POSTED');

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(checkingId, user.id);
  } finally {
    db.close();
  }
}

test('budgets counts a pending charge and excludes a non-spending account, and the link agrees', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedBasisFixture(email);

  await page.goto('/budgets');
  const row = page.getByTestId('budget-row-groceries');
  await expect(row).toBeVisible();

  // The hand-computed figure. $40.00 means the pending row was dropped; $155.00
  // means the brokerage row was counted; $115.00 means both regressed at once.
  await expect(row).toContainText(EXPECTED);

  // …and the figure is the audit gesture the owner asked for: follow it and the
  // register must net to the same number, which is only true because BOTH sides
  // now read the same rows.
  const link = page.getByTestId('budget-category-link-groceries');
  await expect(link).toBeVisible();
  await expect(link).toHaveText(EXPECTED);
  await link.click();
  await page.waitForURL('**/transactions?category=groceries**');

  const net = await page.getByTestId('summary-net').innerText();
  expect(net.replace(/[^0-9.]/g, '')).toBe('65.00');
  // Anti-vacuity, both directions. The register renders the NORMALIZED merchant
  // ("Whole Foods"), not the raw descriptor, so assert on what is actually shown.
  const list = page.getByTestId('txn-list');
  // The pending row is present and labelled as pending — the figure above is not
  // reaching $65.00 by some other route.
  await expect(list).toContainText('Whole Foods');
  await expect(list).toContainText('Pending');
  // …and the brokerage row is absent from the destination too. Without this the
  // two sides could agree at $155.00 and this test would pass while both surfaces
  // were wrong together.
  await expect(list).toContainText('Safeway');
  await expect(list.getByText('$90.00')).toHaveCount(0);
});
