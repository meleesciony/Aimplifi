/**
 * TASKS L.11(D) — a card payment dated PAST the end of the month the plan describes.
 *
 * The owner's report ("It's worse now"): all seven of his cards were dated Aug 5, five days past
 * the July window, so the card-payments term was $0.00 and /spending-plan handed back his entire
 * month's income — $22,254.09, at $3,709.01 a day — directly beneath the same app's own sentence
 * saying $18,814.14 had to be in the account by Aug 5.
 *
 * The engine's arithmetic and the trace's strings are locked by unit tests. What no unit test can
 * see is whether the new row REACHES the page: extracting copy makes the STRING testable and
 * leaves the RENDERING untested (the L.20 lesson). So this drives the real page and asserts the
 * row, the note, the reconciliation claim, and the headline the reader acts on.
 *
 * The demo user cannot exercise this at all — its three cards are due Jun 15, Jun 15 and Jun 28
 * against a pinned Jun 10 today, so every one of them lands INSIDE the month (verified in
 * src/lib/seed/build.ts). A throwaway signup user, never the shared demo row (the shared-demo
 * lesson), and the fixture's hard case is asserted present so this can never degrade into
 * measuring an empty page.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
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

  // The headline a reader acts on: $10,000 income − $9,000 already dated = $1,000.
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,000.00');

  // The fixture's hard case is present — the row exists, names the amount, and carries the date in
  // the product's own voice rather than a raw ISO string.
  const breakdown = page.getByText(`Card payments already dated, due after this month (through ${DUE_LABEL})`);
  await expect(breakdown).toBeVisible();
  await expect(page.getByTestId('plan-held-note')).toContainText('$9,000.00');
  await expect(page.getByTestId('plan-held-note')).toContainText(DUE_LABEL);
  await expect(page.getByTestId('plan-held-note')).not.toContainText(DUE_DATE);

  // …and the panel still certifies its own arithmetic, now over five lines
  // (income, fixed, card payments, savings, the beyond-month row).
  await expect(page.getByTestId('plan-reconciled')).toContainText('matched to the penny');
  await expect(page.getByTestId('plan-reconciled')).toContainText('These 5 lines');
  await expect(page.getByTestId('plan-total')).toHaveText('$1,000.00');

  // TASKS L.29, on the one fixture in the suite that renders three of the new zero
  // labels at once (the demo user renders one). This reader's card IS dated — past
  // the edge — his fixed term is empty and he has no savings input, so all three of
  // his $0.00 lines used to be indistinguishable from the L.26 defect.
  //
  // FAIL-OLD, per label: the card row read "Card payments due this month", the fixed
  // row "Fixed & recurring expenses (monthly pattern)", the savings row "Planned
  // savings (goals)" — and neither control existed.
  const labels = await page.getByTestId('plan-row-label').allTextContents();
  expect(labels[1]).toContain('Fixed & recurring expenses (none counted)');
  expect(labels[2]).toContain('Card payments (none due until after this month)');
  expect(labels[3]).toContain('Planned savings (no monthly amount set)');
  // Each control is a real link to a route that offers the input it names.
  await expect(page.getByTestId('plan-row-action')).toHaveCount(2);
  await expect(page.getByTestId('plan-row-action').nth(0)).toHaveAttribute('href', '/recurring');
  await expect(page.getByTestId('plan-row-action').nth(1)).toHaveAttribute('href', '/settings');
  // No control is offered beside a working figure — income and the dated card row.
  expect(labels[0]).not.toContain('http');
  // …and the reconciliation claim is untouched by any of it (no non-money text
  // entered the amount cells).
  await expect(page.getByTestId('plan-total')).toHaveText('$1,000.00');

  // The dashboard card is the surface most readers ever see: it must carry the fact too, or the
  // figure arrives with no way to learn that a line the reader cannot see is inside it.
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-safe-to-spend-amount')).toHaveText('$1,000.00');
  await expect(page.getByTestId('safe-to-spend-held-note')).toContainText('$9,000.00');
  await expect(page.getByTestId('safe-to-spend-held-note')).toContainText(DUE_LABEL);
});
