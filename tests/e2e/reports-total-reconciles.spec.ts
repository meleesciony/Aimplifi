/**
 * O.19 (owner report 2026-07-31, with screenshots) — "These numbers do not add
 * up to July monthly total."
 *
 * /reports printed `totalCents` (summed over EVERY category) above a list
 * silently capped at 12 rows, so eleven visible rows summing to $19,312.25 sat
 * under "$28,253.04 total". The fix folds the tail into a visible "Everything
 * else" row summed from the same array the header sums, so the page recomposes
 * its own total in both states. The dashboard Top Spending card had the same
 * defect at slice(0, 4) beside "`totalCents` this month".
 *
 * The demo month carries only 11 spend categories (measured — the row never
 * renders there), so this spec seeds a THROWAWAY user with a 14-category month
 * of hand-computed amounts: $14.00 down to $1.00, total $105.00. Top 12 sum to
 * $102.00; the tail (hobbies $2.00 + household $1.00) is exactly $3.00.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** Descending, distinct amounts — ties would make the sort order ambiguous. */
const CATS: ReadonlyArray<readonly [string, number]> = [
  ['rent', 1400],
  ['groceries', 1300],
  ['dining', 1200],
  ['shopping', 1100],
  ['utilities', 1000],
  ['electricity', 900],
  ['clothing', 800],
  ['coffee', 700],
  ['fast-food', 600],
  ['alcohol', 500],
  ['food-delivery', 400],
  ['electronics', 300],
  ['hobbies', 200], // rank 13 — first tail row
  ['household', 100], // rank 14
];
/** The e2e server pins DEMO_TODAY=2026-06-10 for every user (business-today.ts
 *  precedence 1), so the rendered month is June 2026 regardless of wall clock. */
const IN_MONTH = '2026-06-05';

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-reports-total-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedFourteenCategories(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedFourteenCategories: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    // "Transaction" is a SQLite reserved word — quote it or prepare() fails.
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    for (const [categoryId, cents] of CATS) {
      txn.run(`e2e-${categoryId}-${stamp}`, checkingId, IN_MONTH, -cents, `E2E ${categoryId}`, categoryId);
    }
  } finally {
    db.close();
  }
}

/** "$102.00" → 10200. */
const parseCents = (s: string): number => {
  const m = s.match(/\$([\d,]+)\.(\d{2})/);
  if (!m) throw new Error(`no money figure in ${JSON.stringify(s)}`);
  return Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
};

test('reports: the category list visibly recomposes the header total, tail included', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedFourteenCategories(email);

  await page.goto('/reports');
  const section = page.getByTestId('category-breakdown');
  await expect(section).toBeVisible();

  // The header total covers all 14 categories: $105.00.
  await expect(page.getByText('$105.00 total')).toBeVisible();

  // Collapsed: 12 rows render, ranks 13–14 do not…
  await expect(page.getByTestId('category-link-electronics')).toBeVisible();
  await expect(page.getByTestId('category-link-hobbies')).toHaveCount(0);
  await expect(page.getByTestId('category-link-household')).toHaveCount(0);

  // …and the tail is a VISIBLE row, so the page still sums: 2 categories, $3.00.
  const restRow = page.getByTestId('reports-everything-else');
  await expect(restRow).toContainText('2 smaller categories');
  await expect(page.getByTestId('reports-everything-else-amount')).toHaveText('$3.00');

  // The page-level identity, parsed from what is actually rendered: every
  // category row's figure plus the Everything-else figure equals the header
  // total to the penny. This is the assertion the owner's screenshots failed.
  const rowTexts = await page.locator('[data-testid^="category-link-"]').allInnerTexts();
  expect(rowTexts).toHaveLength(12);
  const renderedSum =
    rowTexts.reduce((s, t) => s + parseCents(t), 0) +
    parseCents(await page.getByTestId('reports-everything-else-amount').innerText());
  expect(renderedSum).toBe(10500);

  // Expanding shows the tail rows as FULL rows — linked, with their own
  // expander panels — and the subtotal row stays, now a footer beneath them.
  await page.getByTestId('reports-everything-else-toggle').click();
  await expect(page.getByTestId('category-link-hobbies')).toContainText('$2.00');
  await expect(page.getByTestId('category-link-household')).toContainText('$1.00');
  await expect(page.getByTestId('reports-breakdown-toggle-hobbies')).toBeVisible();
  await expect(page.getByTestId('reports-everything-else-amount')).toHaveText('$3.00');
  // Open state: all 14 rows + the subtotal row still recompose the total.
  const openTexts = await page.locator('[data-testid^="category-link-"]').allInnerTexts();
  expect(openTexts.reduce((s, t) => s + parseCents(t), 0)).toBe(10500);
});

test('dashboard top spending: four rows plus a stated remainder equal the printed total', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedFourteenCategories(email);

  await page.goto('/dashboard');
  const card = page.getByTestId('dashboard-top-spending');
  await expect(card).toBeVisible();
  await expect(card).toContainText('$105.00 this month');
  // Top 4 = 14+13+12+11 = $50.00, so the stated remainder must be $55.00
  // across the other 10 — the identity the card silently failed before.
  const rest = page.getByTestId('top-spending-rest');
  await expect(rest).toContainText('$55.00');
  await expect(rest).toContainText('10 more categories');
});
