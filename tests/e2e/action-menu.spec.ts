/**
 * O.15 slice 2 — the one action menu, the exclusion basis, the reimbursement
 * tracker (380×800 viewport).
 *
 * Runs as a THROWAWAY signup user with a hand-seeded fixture (the
 * budgets-basis.spec recipe): the flag writes are demo-fenced (one visitor's
 * exclusion would rewrite every visitor's totals), and the assertions here are
 * hand-computed money figures that must never depend on the shared goldens.
 *
 * Fixture (all POSTED unless noted, on one CHECKING account, June 2026 —
 * the e2e server pins DEMO_TODAY=2026-06-10 for EVERY user):
 *   groceries  −$40.00   ← excluded/reimbursed in the tests
 *   dining     −$25.00
 *   transfer   −$10.00   (isTransfer)
 *   paycheck   +$40.00   (dated after the groceries row — the exact-amount match)
 * Register "Money out" is $65.00 with nothing excluded, $25.00 once the
 * groceries row is excluded — each digit is only reachable through the basis.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const PASSWORD = 'e2e-password-123';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-action-menu-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedFixture(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-am-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-am-chk-${stamp}`);

    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, 0)`,
    );
    txn.run(`e2e-am-groc-${stamp}`, checkingId, '2026-06-05', -4000, 'WHOLEFDS AM 10305', 'groceries', 0);
    txn.run(`e2e-am-dine-${stamp}`, checkingId, '2026-06-06', -2500, 'CHIPOTLE AM 0042', 'dining', 0);
    txn.run(`e2e-am-xfer-${stamp}`, checkingId, '2026-06-07', -1000, 'ONLINE TRANSFER TO SAVINGS', 'transfer', 1);
    txn.run(`e2e-am-pay-${stamp}`, checkingId, '2026-06-08', 4000, 'EXPENSE REIMB PAYROLL', 'paycheck', 0);
    return { grocId: `e2e-am-groc-${stamp}` };
  } finally {
    db.close();
  }
}

/** The register row containing the given merchant text. */
function rowFor(page: Page, text: string) {
  return page.getByTestId('txn-row').filter({ hasText: text }).first();
}

test.describe('O.15 slice 2 — one action menu per transaction', () => {
  test.describe.configure({ mode: 'serial' });
  let email = '';
  let grocId = '';

  test('every action is listed on a register row; inapplicable ones are disabled with a reason', async ({
    page,
  }) => {
    email = await signUpThrowaway(page);
    ({ grocId } = seedFixture(email));

    await page.goto('/transactions');
    await rowFor(page, 'Whole Foods').getByTestId('txn-action-trigger').click();
    const menu = page.getByTestId('txn-action-menu');
    await expect(menu).toBeVisible();
    // All TEN actions, always — the menu is the row's complete verb list. This
    // list had drifted to eight while the engine returned ten (`markRecurring`
    // from O.13f and `status` from O.15 slice 7 were both missing), so the
    // completeness lock had stopped locking completeness. The count is asserted
    // too: a future action added to `txnActionAvailability` and forgotten here
    // now fails rather than passing quietly.
    const ALL_MENU_KINDS = [
      'category',
      'rule',
      'renamePayee',
      'note',
      'taxTag',
      'split',
      'markRecurring',
      'reimbursement',
      'excludeFromTotals',
      'status',
    ];
    for (const kind of ALL_MENU_KINDS) {
      await expect(menu.locator(`[data-testid="txn-action-${kind}"]`)).toBeVisible();
    }
    await expect(menu.locator('[role="menuitem"], button[disabled]')).toHaveCount(
      ALL_MENU_KINDS.length,
    );

    // A transfer: exclude/split/reimburse are disabled AND say why — never hidden.
    await page.keyboard.press('Escape');
    await rowFor(page, 'Transfer').getByTestId('txn-action-trigger').click();
    await expect(page.getByTestId('txn-action-excludeFromTotals')).toBeDisabled();
    await expect(page.getByTestId('txn-action-excludeFromTotals-reason')).toContainText(
      'already outside every total',
    );
    await expect(page.getByTestId('txn-action-split')).toBeDisabled();
    await expect(page.getByTestId('txn-action-reimbursement')).toBeDisabled();

    // An inflow: reimbursement is disabled as money-in. (The seeded deposit's
    // canonical is "Expense Reimbursement" — probed, not guessed.)
    await page.keyboard.press('Escape');
    await rowFor(page, 'Expense Reimbursement').getByTestId('txn-action-trigger').click();
    await expect(page.getByTestId('txn-action-reimbursement')).toBeDisabled();
    await expect(page.getByTestId('txn-action-reimbursement-reason')).toContainText('money in');
  });

  test('excluding a row removes it from the money figures but keeps it listed, undoably', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    await page.goto('/transactions');
    // Hand-computed: −$40.00 −$25.00 spend, transfer excluded → out $65.00.
    await expect(page.getByTestId('summary-out')).toHaveText('$65.00');

    await rowFor(page, 'Whole Foods').getByTestId('txn-action-trigger').click();
    await page.getByTestId('txn-action-excludeFromTotals').click();
    await page.waitForURL('**/transactions**');
    await expect(page.getByTestId('summary-out')).toHaveText('$25.00');
    // Still listed — the badge, not absence, is the disclosure.
    const excludedRow = rowFor(page, 'Whole Foods');
    await expect(excludedRow).toBeVisible();
    await expect(excludedRow.getByTestId('txn-excluded-badge')).toBeVisible();
    await expect(page.getByTestId('txn-summary')).toBeVisible();
    await expect(page.locator('text=rows marked')).toBeVisible();

    // /budgets reads the same basis: groceries no longer counts there either.
    await page.goto('/budgets');
    await expect(page.locator('body')).not.toContainText('$40.00');

    // Undo: the same slot, relabelled — and every figure comes back.
    await page.goto('/transactions');
    await rowFor(page, 'Whole Foods').getByTestId('txn-action-trigger').click();
    const toggle = page.getByTestId('txn-action-excludeFromTotals');
    await expect(toggle).toHaveText('Include in totals again');
    await toggle.click();
    await page.waitForURL('**/transactions**');
    await expect(page.getByTestId('summary-out')).toHaveText('$65.00');
    await expect(page.getByTestId('txn-excluded-badge')).toHaveCount(0);
  });

  test('the reimbursement tracker: awaiting → coach line → received → matched inflow', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    // Mark awaiting from the register menu.
    await page.goto('/transactions');
    await rowFor(page, 'Whole Foods').getByTestId('txn-action-trigger').click();
    await page.getByTestId('txn-action-reimbursement').click();
    await page.waitForURL('**/transactions**');
    await expect(rowFor(page, 'Whole Foods').getByTestId('txn-reimb-badge')).toHaveText(
      'Awaiting reimbursement',
    );

    // The coach line counts it, verbatim, and links to exactly these rows.
    await page.goto('/coach');
    const card = page.getByTestId('outstanding-reimbursements-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('outstanding-reimbursements-total')).toContainText('$40.00');
    await page.getByTestId('outstanding-reimbursements-link').click();
    await page.waitForURL('**/transactions?reimb=awaiting');
    await expect(page.getByTestId('txn-row')).toHaveCount(1);
    await expect(rowFor(page, 'Whole Foods')).toBeVisible();
    // Critic P1-4: the landing filter is VISIBLE and clearable — the bar shows
    // the active axis as a chip and offers Clear, so this is not a dead end.
    await expect(page.getByTestId('txn-filter-reimb')).toHaveText(/Awaiting reimbursement/);
    await expect(page.getByTestId('txn-clear')).toBeVisible();
    await page.getByTestId('txn-filter-reimb').click();
    await page.waitForURL('**/transactions');
    await expect(page.getByTestId('txn-row')).toHaveCount(4);

    // Received, on the detail view — the matcher proposes the exact-amount
    // deposit seeded three days later, as a suggestion, not a link.
    await page.goto(`/transactions/${grocId}`);
    await page.getByTestId('txn-action-trigger').click();
    await page.getByTestId('txn-action-reimbursement').click();
    await page.waitForURL(`**/transactions/${grocId}**`);
    await expect(page.getByTestId('detail-reimb-badge')).toHaveText('Reimbursed');
    await expect(page.getByTestId('detail-reimb-match')).toContainText('$40.00');

    // The tracker never changed a total: the register still reads $65.00 out.
    await page.goto('/transactions');
    await expect(page.getByTestId('summary-out')).toHaveText('$65.00');

    // The coach line is gone — nothing outstanding.
    await page.goto('/coach');
    await expect(page.getByTestId('outstanding-reimbursements-card')).toHaveCount(0);
  });

  test('the detail view carries the same menu, with split-parent reasons', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    // Split the dining row from its own detail page (the menu's split action).
    await page.goto('/transactions');
    await rowFor(page, 'Chipotle').getByTestId('txn-action-trigger').click();
    await page.getByTestId('txn-action-split').click();
    await page.waitForURL('**/transactions/**');
    await page.getByTestId('detail-split-open').click();
    await page.getByTestId('detail-split-amount').fill('10.00');
    await page.getByTestId('detail-split-confirm').click();
    // The split lands on the PARENT's page after reload.
    await expect(page.getByTestId('detail-split-parts')).toBeVisible({ timeout: 15_000 });

    // On the container, the menu disables the money actions with reasons.
    await page.getByTestId('txn-action-trigger').click();
    await expect(page.getByTestId('txn-action-excludeFromTotals')).toBeDisabled();
    await expect(page.getByTestId('txn-action-excludeFromTotals-reason')).toContainText(
      'exclude its pieces instead',
    );
    await expect(page.getByTestId('txn-action-category')).toBeDisabled();
    await expect(page.getByTestId('txn-action-taxTag')).toBeDisabled();
    await expect(page.getByTestId('txn-action-split')).toBeDisabled();
    // The rule links stay live everywhere.
    await expect(page.getByTestId('txn-action-rule')).toBeVisible();
    await expect(page.getByTestId('txn-action-renamePayee')).toBeVisible();
  });
});
