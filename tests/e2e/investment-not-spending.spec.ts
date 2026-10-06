/**
 * DECISIONS #789 — money filed Investment & Savings is never spending.
 *
 * A throwaway user (never the shared demo row) with one checking account spends
 * $400.00 on groceries in June, sends $1,000.00 to Vanguard and takes $250.00
 * back — both brokerage rows filed Investment & Savings the way the categorizer
 * files them ("VANGUARD BUY INVESTMENT"), neither transfer-flagged. Before #789
 * /reports printed $1,150.00 of spending ($400 + $1,000 − $250) with an
 * "Investment & Savings" bucket; now it prints $400.00. /budgets no longer offers
 * the category as a target, and a target already stored on it is named, not
 * tracked as "$0.00 spent". Every amount is invented. The e2e server pins
 * `DEMO_TODAY=2026-06-10`.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-invest-not-spend-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seed(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const { id: uid } = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const chk = `e2e-ins-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '3318', 800000, 'USD')`,
    ).run(chk, uid, `ref-ins-chk-${stamp}`);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    const rows: [string, number, string, string][] = [
      ['2026-06-03', -40_000, 'KROGER #0412', 'groceries'],
      ['2026-06-04', -100_000, 'VANGUARD BUY INVESTMENT', 'investment'],
      ['2026-06-08', 25_000, 'VANGUARD SELL INVESTMENT', 'investment'],
    ];
    rows.forEach(([date, cents, desc, cat], i) => txn.run(`e2e-ins-t-${stamp}-${i}`, chk, date, cents, desc, cat));
    // A target stored before #789 on Investment & Savings, and one on groceries.
    const budget = db.prepare('INSERT INTO Budget (id, userId, categoryId, monthCents) VALUES (?, ?, ?, ?)');
    budget.run(`e2e-ins-b1-${stamp}`, uid, 'investment', 100_000);
    budget.run(`e2e-ins-b2-${stamp}`, uid, 'groceries', 50_000);
  } finally {
    db.close();
  }
}

test.describe('money filed Investment & Savings is never spending (DECISIONS #789)', () => {
  test('/reports counts the groceries only; /budgets names the old target instead of tracking it', async ({ page }) => {
    const email = await signUpThrowaway(page);
    seed(email);

    await page.goto('/reports');
    await expect(page.getByTestId('category-breakdown')).toBeVisible();
    // $400.00 of groceries — the $1,000.00 deposit is not spending and the
    // $250.00 back is not a refund netting it down.
    await expect(page.getByTestId('reports-category-total')).toContainText('$400.00 total');
    await expect(page.getByTestId('category-link-groceries')).toContainText('$400.00');
    await expect(page.getByTestId('category-link-investment')).toHaveCount(0);

    await page.goto('/budgets');
    await expect(page.getByTestId('budget-list')).toBeVisible();
    await expect(page.getByTestId('budget-row-groceries')).toBeVisible();
    await expect(page.getByTestId('budget-row-investment')).toHaveCount(0);
    await expect(page.getByTestId('budgets-untracked-target')).toHaveText(
      'Your $1,000.00 monthly target on Investment & Savings isn’t tracked here: money moved into investing or savings is saving, not spending, so no spending figure counts it.',
    );
    // Not offered as a new target either.
    await expect(page.getByTestId('budget-category').locator('option[value="investment"]')).toHaveCount(0);
    await expect(page.getByTestId('budget-category').locator('option[value="groceries"]')).toHaveCount(1);
    // …and the old target can be removed, so the sentence is not permanent (critic cycle 1, P2-3).
    await page.getByTestId('budget-untracked-remove-investment').click();
    await expect(page.getByTestId('budgets-untracked-target')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('budget-row-groceries')).toBeVisible();
  });
});
