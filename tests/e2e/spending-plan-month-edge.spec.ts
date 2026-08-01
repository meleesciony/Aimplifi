/**
 * Owner 2026-08-01 — card payments dated past the month are cash-needed liquidity,
 * not guilt-free subtractions. This fixture still seeds a July-due statement against
 * a June plan (the L.11(D) shape) and asserts the plan page does NOT subtract it:
 * headline = full pattern income, three-line identity, basis points at Cash needed.
 *
 * Throwaway signup user only (never the shared demo row).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The e2e server pins `DEMO_TODAY=2026-06-10` for EVERY user (businessToday precedence 1), the
 *  same premise calendar-frozen.spec.ts is written against. Asserted below, never assumed. */
const TODAY = '2026-06-10';
/** A Friday in the NEXT month: past June's edge, and no business-day rollback to reason about. */
const DUE_DATE = '2026-07-10';
const DUE_LABEL = 'Fri, Jul 10';
const STATEMENT_CENTS = 900000; // $9,000.00
const INCOME_CENTS = 1000000; // $10,000.00

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-plan-edge-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
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

/**
 * One checking account holding paychecks, and one card whose only statement is due in JULY.
 * `dueDate` is the whole fixture: move it inside June and this spec is measuring nothing.
 * L.22: the paychecks land in the two COMPLETE months (April + May — the trailing pattern's
 * basis); a June paycheck is present too and deliberately changes nothing (the pattern does
 * not read the current month).
 */
function seedCardDueNextMonth(email: string) {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`spending-plan-month-edge: user ${email} not found`);
    const uid = user.id;
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const chkId = `e2e-pe-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Investor Checking', 'CHECKING', '1234', 980000, 'USD')`,
    ).run(chkId, uid, `ref-pe-chk-${stamp}`);

    const cardId = `e2e-pe-card-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Travel Card', 'CREDIT', '4321', ?, 'USD')`,
    ).run(cardId, uid, `ref-pe-card-${stamp}`, STATEMENT_CENTS);

    const insTxn = db.prepare(
      // "Transaction" is a reserved word in SQLite — it must be quoted here.
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, confidenceBps, needsReview, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, 'ACME PAYROLL', 'income', 9900, 0, 'POSTED', 0, 0)`,
    );
    insTxn.run(`e2e-pe-txn-apr-${stamp}`, chkId, '2026-04-03', INCOME_CENTS);
    insTxn.run(`e2e-pe-txn-may-${stamp}`, chkId, '2026-05-03', INCOME_CENTS);
    insTxn.run(`e2e-pe-txn-jun-${stamp}`, chkId, '2026-06-03', INCOME_CENTS);

    db.prepare(
      `INSERT INTO Statement (id, accountId, cycleStart, cycleEnd, dueDate, statementBalanceCents, minimumPaymentCents, isEstimated)
       VALUES (?, ?, '2026-05-11', '2026-06-10', ?, ?, 3500, 0)`,
    ).run(`e2e-pe-stmt-${stamp}`, cardId, DUE_DATE, STATEMENT_CENTS);

    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
  } finally {
    db.close();
  }
}

/**
 * A repeating bill the projection RECORDED as uncountable — the L.26 signature,
 * frozen as a fixture. `projectionStatus: 'off-scope'` with no ScheduledTransaction
 * row is exactly the state the owner's live data was in for four sessions: a real
 * charging bill, detected and stored, reaching no projection, printing $0.00.
 *
 * Seeded rather than driven through a re-link because the RENDERING is what no unit
 * test can see (the L.20 lesson) — the unit suite proves the classifier assigns
 * 'off-scope', and this proves the page turns it into a sentence.
 */
function seedUncountedRecurringSeries(email: string) {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`spending-plan-month-edge: user ${email} not found`);
    // Merchant rows are global (keyed by canonical, not by user), so reuse one the
    // seed already created rather than inventing a column set this spec would have
    // to keep in step with the schema.
    const merchant = db.prepare('SELECT id FROM Merchant LIMIT 1').get() as { id: string } | undefined;
    if (!merchant) throw new Error('spending-plan-month-edge: no Merchant row to attach a series to');
    db.prepare(
      `INSERT INTO RecurringSeries (id, userId, merchantId, cadence, typicalAmountCents, lastAmountCents,
                                    possiblyUnused, lastSeenAt, nextExpectedAt, isSubscription, projectionStatus)
       VALUES (?, ?, ?, 'MONTHLY', -17679, -17679, 0, '2026-06-06', '2026-07-06', 0, 'off-scope')`,
    ).run(`e2e-pe-series-${Date.now()}`, user.id, merchant.id);
  } finally {
    db.close();
  }
}

test('a repeating bill the projection could not count is named — a broken zero does not read as a true one (L.30)', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedCardDueNextMonth(email);
  seedUncountedRecurringSeries(email);

  await page.goto('/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible({ timeout: 20_000 });

  // THE FIXTURE'S HARD CASE, asserted present so this can never pass vacuously
  // (the L.29 no-op-lock finding): the fixed row must really be at $0.00, or the
  // label under test is not the one being rendered.
  const labels = await page.getByTestId('plan-row-label').allTextContents();
  const amounts = await page.getByTestId('plan-row-amount').allTextContents();
  expect(amounts[1]).toContain('$0.00');

  // FAIL-OLD: before L.30 this identical state printed "Fixed & recurring expenses
  // (none counted)" with a link — the same line a reader with genuinely no bills
  // saw, which is how the defect survived being looked at.
  expect(labels[1]).toContain('Fixed & recurring expenses (1 bill found, not counted here)');
  // …and it is NOT the unproven-zero wording a reader with no known bills gets.
  expect(labels[1]).not.toBe('Fixed & recurring expenses (none counted)');
  const action = page.getByTestId('plan-row-action').filter({ hasText: 'See your recurring bills' });
  await expect(action).toHaveAttribute('href', '/recurring');

  // …and the direction is stated in prose, on the surface, not left to be inferred
  // from a parenthetical: this figure is too generous, and by how much is knowable
  // only from the list.
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();
  await expect(page.locator('body')).toContainText(
    'One repeating bill we found is not in the fixed-expenses line',
  );
  await expect(page.locator('body')).toContainText('the real amount free to spend is smaller than shown');

  // The same fact reaches /budgets, which re-partitions the same plan into
  // percentages against a target — a split it would otherwise certify as correct.
  // /budgets gets the SURFACE'S OWN NOUN, not this page's: it prints no
  // fixed-expenses line at all, only a "Fixed costs" bucket that also holds card
  // payments, so naming a line there would point at nothing (copy critic P2-3).
  await page.goto('/budgets');
  await expect(page.getByTestId('conscious-fixed-uncounted')).toContainText(
    'not in your fixed costs',
  );
  await expect(page.getByTestId('conscious-fixed-uncounted')).not.toContainText(
    'fixed-expenses line',
  );
});

test('a card dated past the month’s edge is reserved, shown as its own line, and named on the page', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedCardDueNextMonth(email);

  await page.goto('/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible({ timeout: 20_000 });

  // The premise: the pinned today is in JUNE, so a July due date really is past the edge. If the
  // pin ever moves, this fails loudly here instead of the assertions below failing mysteriously.
  await expect(page.getByTestId('safe-to-spend')).toBeVisible();
  expect(TODAY.slice(0, 7)).toBe('2026-06');

  // Owner 2026-08-01: guilt-free = pattern income − fixed − savings. A $9,000 card
  // due past the month's edge is cash-needed liquidity, not a plan subtraction —
  // so this fixture's headline is the full $10,000 pattern.
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$10,000.00');

  // Card dues are not a breakdown row (they would double-count spend).
  await expect(
    page.getByText(`Card payments already dated, due after this month (through ${DUE_LABEL})`),
  ).toHaveCount(0);
  await expect(page.getByTestId('plan-held-note')).toHaveCount(0);

  // Three-line identity: income, fixed, savings.
  await expect(page.getByTestId('plan-reconciled')).toContainText('matched to the penny');
  await expect(page.getByTestId('plan-reconciled')).toContainText('These 3 lines');
  await expect(page.getByTestId('plan-total')).toHaveText('$10,000.00');

  const labels = await page.getByTestId('plan-row-label').allTextContents();
  expect(labels).toHaveLength(3);
  expect(labels[1]).toContain('Fixed & recurring expenses (none counted)');
  expect(labels[2]).toContain('Planned savings (no monthly amount set)');
  await expect(page.getByTestId('plan-row-action')).toHaveCount(2);
  await expect(page.getByTestId('plan-row-action').nth(0)).toHaveAttribute('href', '/recurring');
  await expect(page.getByTestId('plan-row-action').nth(1)).toHaveAttribute('href', '/settings');
  expect(labels[1]).not.toContain('not counted here');
  expect(labels[0]).not.toContain('http');
  await expect(page.getByTestId('plan-total')).toHaveText('$10,000.00');

  // Basis points cards at Cash needed instead of subtracting them.
  await expect(page.getByText(/Card statement payments are not subtracted here/i)).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-safe-to-spend-amount')).toHaveText('$10,000.00');
  await expect(page.getByTestId('safe-to-spend-held-note')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-recent-transactions')).toBeVisible();
});
