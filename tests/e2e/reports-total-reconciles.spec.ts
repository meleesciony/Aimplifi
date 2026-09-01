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

/** Seed one checking account + one POSTED spend row per entry. A null
 *  categoryId seeds an UNFILED row (folds into the uncategorized bucket). */
function seedCategoryMonth(email: string, rows: ReadonlyArray<readonly [string | null, number]>) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedCategoryMonth: user ${email} not found`);
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
    rows.forEach(([categoryId, cents], i) => {
      txn.run(
        `e2e-${i}-${categoryId ?? 'unfiled'}-${stamp}`,
        checkingId,
        IN_MONTH,
        -cents,
        `E2E ${categoryId ?? 'unfiled'}`,
        categoryId,
      );
    });
  } finally {
    db.close();
  }
}

const seedFourteenCategories = (email: string) => seedCategoryMonth(email, CATS);

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

  // Collapsed: 12 rows render; ranks 13–14 are mounted but hidden (the tail
  // container stays in the DOM so the toggle's aria-controls always resolves).
  await expect(page.getByTestId('category-link-electronics')).toBeVisible();
  await expect(page.getByTestId('category-link-hobbies')).toBeHidden();
  await expect(page.getByTestId('category-link-household')).toBeHidden();

  // …and the tail is a VISIBLE row, so the page still sums: 2 categories, $3.00.
  // "more", never "smaller" (critic P2-1: a rank-13 amount can tie rank-12).
  const restRow = page.getByTestId('reports-everything-else');
  await expect(restRow).toContainText('2 more categories');
  await expect(page.getByTestId('reports-everything-else-amount')).toHaveText('$3.00');

  // The page-level identity, parsed from what is actually rendered: every
  // category row's figure plus the Everything-else figure equals the header
  // total to the penny. This is the assertion the owner's screenshots failed.
  // `:visible` matters: hidden tail rows are in the DOM, and innerText of an
  // unrendered element falls back to textContent — counting them here would
  // double-count the tail against the Everything-else figure.
  const rowTexts = await page.locator('[data-testid^="category-link-"]:visible').allInnerTexts();
  expect(rowTexts).toHaveLength(12);
  const renderedSum =
    rowTexts.reduce((s, t) => s + parseCents(t), 0) +
    parseCents(await page.getByTestId('reports-everything-else-amount').innerText());
  expect(renderedSum).toBe(10500);

  // WCAG 2.5.3 lock (critic P1-1): the accessible name CONTAINS the visible
  // label — they are built from one string, and this assertion is what makes
  // splitting them again a red test instead of a silent regression.
  await expect(page.getByTestId('reports-everything-else-toggle')).toHaveAttribute(
    'aria-label',
    'Everything else: Show 2 more categories',
  );

  // Expanding shows the tail rows as FULL rows — linked, with their own
  // expander panels — and the subtotal row stays beneath the top rows.
  await page.getByTestId('reports-everything-else-toggle').click();
  await expect(page.getByTestId('category-link-hobbies')).toBeVisible();
  await expect(page.getByTestId('category-link-hobbies')).toContainText('$2.00');
  await expect(page.getByTestId('category-link-household')).toContainText('$1.00');
  await expect(page.getByTestId('reports-breakdown-toggle-hobbies')).toBeVisible();
  await expect(page.getByTestId('reports-everything-else-amount')).toHaveText('$3.00');
  // Open state: all 14 rows + the subtotal row still recompose the total.
  const openTexts = await page
    .locator('[data-testid^="category-link-"]:visible')
    .allInnerTexts();
  expect(openTexts).toHaveLength(14);
  expect(openTexts.reduce((s, t) => s + parseCents(t), 0)).toBe(10500);
});

// Owner 2026-08-01: the former "dashboard top spending" remainder lock is covered
// by the /reports test above (Top spending left the Home stack).

// ─── O.19d — residual locks from the O.19 critic (P2-5) ──────────────────────

test('singular tail + tie at the boundary: "1 more category", never "smaller"', async ({
  page,
}) => {
  // 13 categories where rank 12 TIES rank 13 ($1.50 each). The tail is one row,
  // so the copy must be singular — and the tied amounts are why every string
  // says "more", not "smaller": the hidden category is not smaller than the
  // visible rank-12, and "smaller" would be a false claim exactly here.
  const TIED: ReadonlyArray<readonly [string, number]> = [
    ['rent', 1300],
    ['groceries', 1200],
    ['dining', 1100],
    ['shopping', 1000],
    ['utilities', 900],
    ['electricity', 800],
    ['clothing', 700],
    ['coffee', 600],
    ['fast-food', 500],
    ['alcohol', 400],
    ['food-delivery', 300],
    ['electronics', 150], // rank 12 — visible
    ['hobbies', 150], // rank 13 — the tail, tied with rank 12
  ];
  const email = await signUpThrowaway(page);
  seedCategoryMonth(email, TIED);

  await page.goto('/reports');
  await expect(page.getByTestId('category-breakdown')).toBeVisible();
  await expect(page.getByText('$91.00 total')).toBeVisible(); // Σ = 9100

  const restRow = page.getByTestId('reports-everything-else');
  await expect(restRow).toContainText('1 more category'); // singular
  await expect(restRow).not.toContainText('categories');
  await expect(restRow).not.toContainText('smaller');
  await expect(page.getByTestId('reports-everything-else-amount')).toHaveText('$1.50');
  await expect(page.getByTestId('reports-everything-else-toggle')).toHaveAttribute(
    'aria-label',
    'Everything else: Show 1 more category',
  );

  // Identity with the tie: 12 visible rows ($89.50) + tail ($1.50) = $91.00.
  const rowTexts = await page.locator('[data-testid^="category-link-"]:visible').allInnerTexts();
  expect(rowTexts).toHaveLength(12);
  const renderedSum =
    rowTexts.reduce((s, t) => s + parseCents(t), 0) +
    parseCents(await page.getByTestId('reports-everything-else-amount').innerText());
  expect(renderedSum).toBe(9100);
});

test('uncategorized in the tail keeps the O.5 refusal and still counts in the identity', async ({
  page,
}) => {
  // 13 filed categories + one UNFILED row ($0.50) that ranks 14th, inside the
  // tail. The shared row renderer applies the O.5 refusal there too — but no
  // assertion said so until now: expanded, the uncategorized row must render
  // UNLINKED (its affordance is the Inbox, not the register) and its money must
  // still be part of the recomposed total.
  const WITH_UNFILED: ReadonlyArray<readonly [string | null, number]> = [
    ['rent', 1300],
    ['groceries', 1200],
    ['dining', 1100],
    ['shopping', 1000],
    ['utilities', 900],
    ['electricity', 800],
    ['clothing', 700],
    ['coffee', 600],
    ['fast-food', 500],
    ['alcohol', 400],
    ['food-delivery', 300],
    ['electronics', 200], // rank 12 — visible
    ['hobbies', 100], // rank 13 — tail
    [null, 50], // rank 14 — the uncategorized bucket, in the tail
  ];
  const email = await signUpThrowaway(page);
  seedCategoryMonth(email, WITH_UNFILED);

  await page.goto('/reports');
  const section = page.getByTestId('category-breakdown');
  await expect(section).toBeVisible();
  await expect(page.getByText('$91.50 total')).toBeVisible(); // Σ = 9150

  const restRow = page.getByTestId('reports-everything-else');
  await expect(restRow).toContainText('2 more categories');
  await expect(page.getByTestId('reports-everything-else-amount')).toHaveText('$1.50'); // 100 + 50

  await page.getByTestId('reports-everything-else-toggle').click();
  // The refusal, asserted where it was previously only inherited: no register
  // category-select link for the uncategorized bucket — its affordance is Needs a category.
  await expect(section.locator('[data-testid="category-link-uncategorized"]')).toHaveCount(0);
  const needsLink = section.getByRole('link', { name: 'Needs a category →' });
  await expect(needsLink).toBeVisible();
  await expect(needsLink).toHaveAttribute('href', '/transactions?unclassified=1');
  // …and its money is on the page: the ROW prints $0.50 beside "Uncategorized".
  // Scoped to the row's parent div — a bare getByText('$0.50') strict-violates,
  // because the O.18 expander panel prints the same sum twice more.
  await expect(section.getByText('Uncategorized ·')).toBeVisible();
  const uncatRow = section.getByText('Uncategorized ·').locator('..');
  await expect(uncatRow).toContainText('$0.50');
  // Expanded identity: 13 LINKED rows ($91.00) + the unlinked uncategorized
  // row ($0.50, hand-computed — it carries no testid) = the $91.50 header.
  const openTexts = await page.locator('[data-testid^="category-link-"]:visible').allInnerTexts();
  expect(openTexts).toHaveLength(13);
  expect(openTexts.reduce((s, t) => s + parseCents(t), 0) + 50).toBe(9150);
});
