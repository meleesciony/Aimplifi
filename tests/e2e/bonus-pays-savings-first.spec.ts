/**
 * DECISIONS #784/#787 — bonuses show as their own line and go toward the
 * savings target first. A throwaway user on regular pay (every two weeks, a
 * cent of drift) with a 20% savings target receives bonus money this month; the
 * Guilt-free page must add it as its own row that pays the savings, say what
 * landed and what it did on screen, and Home and /budgets must print the same
 * figure with the same short note.
 *
 * Never the shared demo row. Every amount is invented.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The e2e server pins `DEMO_TODAY=2026-06-10` (window Mar–May; "this month" is
 *  June). Nine paydays on the 14-day grid, the first before Mar 1: clean. */
const PAYDAYS = ['2026-02-13', '2026-02-27', '2026-03-13', '2026-03-27', '2026-04-10', '2026-04-24', '2026-05-08', '2026-05-22', '2026-06-05'];
const PAYROLL = 'NORTHWIND HEALTH PAYROLL PPD';
const PAYCHECK_CENTS = 451230;
const RENT_CENTS = 300000;
// $4,512.30 × 26 ÷ 12 = $9,776.65; savings 20% = $1,955.33.
const MONTHLY_CENTS = 977665;
const SAVINGS_CENTS = 195533;

function money(n: number): string {
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-bonus-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seed(email: string, bonus: { date: string; cents: number; categoryId: string; descriptor: string }) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chkId = `e2e-bn-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '7712', 2500000, 'USD')`,
    ).run(chkId, uid, `ref-bn-chk-${stamp}`);
    const insert = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    PAYDAYS.forEach((d, i) => {
      // A cent of drift on every third paycheck; the median of the last eight is
      // $4,512.30 and so is the newest.
      insert.run(`e2e-bn-pay-${stamp}-${i}`, chkId, d, PAYCHECK_CENTS + (i % 3 === 0 ? 1 : 0), PAYROLL, 'paycheck');
    });
    ['2026-03-01', '2026-04-01', '2026-05-01'].forEach((d, i) => {
      insert.run(`e2e-bn-rent-${stamp}-${i}`, chkId, d, -RENT_CENTS, 'MAPLE COURT APTS RENT', 'rent');
    });
    insert.run(`e2e-bn-bonus-${stamp}`, chkId, bonus.date, bonus.cents, bonus.descriptor, bonus.categoryId);
    db.prepare('UPDATE User SET paymentAccountId = ?, savingsTargetBps = 2000 WHERE id = ?').run(chkId, uid);
  } finally {
    db.close();
  }
}

// Income $9,776.65 − rent $3,000.00 − savings $1,955.33 + the $1,955.33 the
// bonus paid = $6,776.65 (the bonus covers all of the savings in both tests).
const GUILT_FREE = money(MONTHLY_CENTS - RENT_CENTS);
const SHORT_NOTE = `This month's bonus paid ${money(SAVINGS_CENTS)} of your savings, so guilt-free is ${money(SAVINGS_CENTS)} higher than your pay alone allows — the details are on Guilt-free.`;

test('a deposit filed Bonus pays this month’s savings first — its own row on Guilt-free, the same figure on Home and /budgets', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seed(email, { date: '2026-06-03', cents: 250000, categoryId: 'bonus', descriptor: 'NORTHWIND HEALTH SPOT AWARD' });

  await page.goto('/spending-plan');
  await expect(page.getByTestId('safe-to-spend')).toHaveText(GUILT_FREE);
  const bonusRow = page.getByTestId('plan-row').filter({ hasText: 'Bonus this month, toward savings first' });
  await expect(bonusRow).toHaveCount(1);
  await expect(bonusRow.getByTestId('plan-row-amount')).toHaveText(`+ ${money(SAVINGS_CENTS)}`);
  // The savings row still shows the whole plan.
  await expect(
    page.getByTestId('plan-row').filter({ hasText: 'Savings target (from Settings)' }).getByTestId('plan-row-amount'),
  ).toHaveText(`− ${money(SAVINGS_CENTS)}`);
  await expect(page.getByTestId('plan-total')).toHaveText(GUILT_FREE);
  await expect(page.getByTestId('plan-reconciled')).toContainText('These 4 lines add up to exactly');
  // On screen, not only in the DOM.
  await expect(
    page
      .getByText(
        /Bonus money landed this month — Wed, Jun 3: \$2,500\.00 filed Bonus\. .* it covers all \$1,955\.33 of this month's planned savings, so guilt-free this month is \$1,955\.33 higher than your pay alone allows\. The other \$544\.67 is not counted anywhere in this plan/,
      )
      .filter({ visible: true }),
  ).toHaveCount(1);

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-safe-to-spend-amount')).toHaveText(GUILT_FREE);
  await expect(page.getByTestId('safe-to-spend-bonus-note')).toHaveText(SHORT_NOTE);

  await page.goto('/budgets');
  await expect(page.getByTestId('budgeting-guilt-free')).toHaveText(GUILT_FREE);
  await expect(page.getByTestId('budgeting-bonus')).toHaveText(`+ ${money(SAVINGS_CENTS)}`);
  await expect(page.getByTestId('budgeting-bonus-basis')).toHaveText(SHORT_NOTE);
  await expect(page.getByTestId('conscious-bonus-note')).toHaveText(`${SHORT_NOTE} Savings here is the part your pay funds.`);
});

test('a payroll bonus on a day of its own counts what it brought above the usual paycheck', async ({ page }) => {
  const email = await signUpThrowaway(page);
  // Mon Jun 1: $9,000.00 from the payroll, filed Paycheck, between paydays.
  seed(email, { date: '2026-06-01', cents: 900000, categoryId: 'paycheck', descriptor: PAYROLL });

  await page.goto('/spending-plan');
  await expect(page.getByTestId('safe-to-spend')).toHaveText(GUILT_FREE);
  // Regular pay still plans the month: the off-cycle deposit is not a paycheck.
  await expect(
    page.getByTestId('plan-row').filter({ hasText: 'Income (regular pay, monthly average)' }).getByTestId('plan-row-amount'),
  ).toHaveText(`+ ${money(MONTHLY_CENTS)}`);
  // $9,000.00 − $4,512.30 = $4,487.70 counts; $4,487.70 − $1,955.33 = $2,532.37 is left over.
  await expect(
    page
      .getByText(
        /Bonus money landed this month — Mon, Jun 1: \$9,000\.00 from the payer of your regular paycheck, \$4,487\.70 more than its usual \$4,512\.30\. .*The other \$2,532\.37 is not counted anywhere in this plan/,
      )
      .filter({ visible: true }),
  ).toHaveCount(1);
});
