/**
 * DECISIONS #785 — regular pay plans the month. A throwaway user paid every two
 * weeks (with a cent of drift, the shape the shipped recurring detector refused)
 * must see the Guilt-free income row on the regular-pay basis at its yearly rate,
 * the arithmetic in "How we got there", and the same figure on Home.
 *
 * Never the shared demo row. Every amount is invented.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The e2e server pins `DEMO_TODAY=2026-06-10` (window Mar–May). The first payday
 *  is before Mar 1, so the payroll is not "new" — the clean case. */
// Nine paydays: every-two-weeks is read only with nine on the 14-day grid.
const PAYDAYS = ['2026-02-13', '2026-02-27', '2026-03-13', '2026-03-27', '2026-04-10', '2026-04-24', '2026-05-08', '2026-05-22', '2026-06-05'];
const PAYCHECK_CENTS = 451230;
const RENT_CENTS = 300000;
// $4,512.30 × 26 ÷ 12 = $9,776.65 a month.
const MONTHLY_CENTS = 977665;

function money(n: number): string {
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-regpay-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedPay(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chkId = `e2e-rp-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '7710', 2500000, 'USD')`,
    ).run(chkId, uid, `ref-rp-chk-${stamp}`);
    const insert = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    PAYDAYS.forEach((d, i) => {
      // A cent of drift on every third paycheck (Feb 13, Mar 27, May 8). The last
      // eight (Feb 27 … Jun 5) have a median of $4,512.30 and the newest is
      // $4,512.30, so the paycheck is $4,512.30 and the month exactly $9,776.65.
      insert.run(`e2e-rp-pay-${stamp}-${i}`, chkId, d, PAYCHECK_CENTS + (i % 3 === 0 ? 1 : 0), 'NORTHWIND HEALTH PAYROLL PPD', 'paycheck');
    });
    ['2026-03-01', '2026-04-01', '2026-05-01'].forEach((d, i) => {
      insert.run(`e2e-rp-rent-${stamp}-${i}`, chkId, d, -RENT_CENTS, 'MAPLE COURT APTS RENT', 'rent');
    });
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
  } finally {
    db.close();
  }
}

test('a biweekly paycheck plans the month at its yearly rate, on the Guilt-free page and Home', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedPay(email);

  // Income $9,776.65 − rent $3,000.00 − savings $0.00 (no target set).
  const guiltFree = money(MONTHLY_CENTS - RENT_CENTS);

  await page.goto('/spending-plan');
  await expect(page.getByTestId('safe-to-spend')).toHaveText(guiltFree);
  const incomeRow = page.getByTestId('plan-row').filter({ hasText: 'Income (regular pay, monthly average)' });
  await expect(incomeRow).toHaveCount(1);
  await expect(incomeRow.getByTestId('plan-row-amount')).toContainText(money(MONTHLY_CENTS));
  await expect(
    page.getByText(/\$4,512\.30 every two weeks × 26 ÷ 12 \(\$9,776\.65 a month\) = \$9,776\.65 a month\./).first(),
  ).toBeAttached();

  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-safe-to-spend-amount')).toHaveText(guiltFree);
});
