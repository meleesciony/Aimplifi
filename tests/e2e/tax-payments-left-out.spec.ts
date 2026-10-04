/**
 * DECISIONS #783 — owner 2026-10-03: a large IRS payment in the last complete
 * month put the next month's plan far "Over plan" on Home and on the Guilt-free
 * page — "I think the app got tricked because I had a large tax payment recently
 * … but that was last month not oct", and "Certain things like tax payments
 * shouldn't be considered in budget."
 *
 * Locks the RENDERED surfaces, not the engine (the engine and the real loader are
 * locked in tests/unit/tax-payments-out-of-plan.test.ts): the hero and the Home
 * card read guilt-free, the Fixed list carries no Taxes line and still adds up,
 * and the left-out money is stated on the page and on /budgets instead of
 * vanishing.
 *
 * Throwaway signup user, never the shared demo row. Every amount is invented.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** The e2e server pins `DEMO_TODAY=2026-06-10`, so the Fixed window is Mar–May. */
const WINDOW_MONTHS = ['2026-03', '2026-04', '2026-05'];
const INCOME_CENTS = 800_000;
const GROCERIES_CENTS = 90_000;
const PREP_CENTS = 30_000;
const IRS_CENTS = 4_000_000;

function money(n: number): string {
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-taxout-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedTaxMonth(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chkId = `e2e-tax-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '4410', 2500000, 'USD')`,
    ).run(chkId, uid, `ref-tax-chk-${stamp}`);
    const insert = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, 0)`,
    );
    WINDOW_MONTHS.forEach((m, i) => {
      insert.run(`e2e-tax-inc-${stamp}-${i}`, chkId, `${m}-01`, INCOME_CENTS, 'NORTHWIND PAYROLL', 'paycheck', 0);
      insert.run(`e2e-tax-gro-${stamp}-${i}`, chkId, `${m}-11`, -GROCERIES_CENTS, 'GREENLEAF MARKET', 'groceries', 0);
    });
    // The preparer fee starts the Taxes category's observation clock in April,
    // so before the rule the May payment was divided by 2, not 3.
    insert.run(`e2e-tax-prep-${stamp}`, chkId, '2026-04-07', -PREP_CENTS, 'HILLTOP TAX PREP', 'taxes', 0);
    insert.run(`e2e-tax-irs-${stamp}`, chkId, '2026-05-26', -IRS_CENTS, 'IRS USATAXPYMT', 'taxes', 0);
    // ...funded from a brokerage the day before, which is a transfer and in no income month.
    insert.run(`e2e-tax-xfer-${stamp}`, chkId, '2026-05-25', IRS_CENTS, 'TRANSFER FROM BROKERAGE', 'transfer', 1);
    db.prepare('UPDATE User SET paymentAccountId = ? WHERE id = ?').run(chkId, uid);
  } finally {
    db.close();
  }
}

test('a large tax payment last month leaves this month guilt-free, and the page says what it left out', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedTaxMonth(email);

  // Income $8,000.00 − Fixed $900.00 (groceries) − savings $0.00 (no target set).
  // Before the rule: Taxes priced at ($300 + $40,000) / 2 = $20,150.00 a month,
  // and the hero read "Over plan" $13,050.00.
  const guiltFree = money(INCOME_CENTS - GROCERIES_CENTS);

  await page.goto('/spending-plan');
  const hero = page.getByTestId('spending-plan-hero');
  await expect(hero).toContainText('Guilt-free to spend');
  await expect(hero).not.toContainText('Over plan');
  await expect(page.getByTestId('safe-to-spend')).toHaveText(guiltFree);

  const panel = page.getByTestId('fixed-composition');
  await expect(panel.getByTestId('fixed-composition-row').filter({ hasText: /Taxes/i })).toHaveCount(0);
  await expect(panel.getByTestId('fixed-composition-total')).toHaveText(money(GROCERIES_CENTS));

  // The money is still on the page — what was left out, how many, over which window.
  const leftOut = panel.getByTestId('fixed-composition-taxes-left-out');
  await expect(leftOut).toBeVisible();
  await expect(leftOut).toContainText(
    `Not counted here: ${money(PREP_CENTS + IRS_CENTS)} filed as taxes in your last 12 complete months (2 charges).`,
  );
  await expect(leftOut).toContainText('file it under Property Tax and it counts');
  await expect(leftOut).toContainText('Money you set aside each month');
  // The glass-box basis sentence states the rule on the same page.
  await expect(
    page.getByText(/Charges filed as Taxes or Estimated Tax Payment are never counted here/).first(),
  ).toBeAttached();

  // Home reads the same plan: the card is guilt-free, not "Over plan by …".
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-safe-to-spend-amount')).toHaveText(guiltFree);

  // /budgets prints the same split as percentages, so it carries the same sentence.
  await page.goto('/budgets');
  await expect(page.getByTestId('conscious-taxes-left-out')).toContainText(
    `Not counted here: ${money(PREP_CENTS + IRS_CENTS)} filed as taxes`,
  );
});
