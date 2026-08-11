/**
 * O.18b — the Conscious Spending strip's legend amounts expand, in place, to
 * the plan rows behind each bucket.
 *
 * The unit suite (conscious-trace.test.ts) proves the per-bucket traces
 * reconcile to `mapToConsciousBuckets` on engine output. What no pure test can
 * see is the SHIPPED wiring: that the legend prints the trace's own headline,
 * that three panels coexist on one page under distinct testids, and that the
 * panel a reader opens sums to the figure they tapped. Every assertion below
 * compares money the page PAINTS against money the panel PAINTS.
 *
 * Read-only on the shared demo: expanding writes nothing (no engagement calls
 * in these components), so the shared-row rule is not in play.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/** "$1,629.44" → 162944. Also handles a signed "−$1,629.44". */
function parseCents(text: string): number {
  const negative = /[-−]/.test(text);
  const digits = text.replace(/[^0-9.]/g, '');
  const value = Math.round(Number(digits) * 100);
  return negative ? -value : value;
}

async function signInDemo(page: Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

/**
 * O.18g — the savings bucket's working-figure state. The demo's savings is
 * provably always $0, so the "no control beside a real number" branch was
 * unit-locked only and the demo test passed vacuously over it. This seeds a
 * THROWAWAY user (the trends-caps / reports-total idiom) where the state
 * binds by construction: two complete months of paycheck income → a pattern,
 * and a 20% savings target → $1,000.00/mo of planned savings.
 *
 * The e2e server pins DEMO_TODAY=2026-06-10 for every user, so April and May
 * are complete months for the income median.
 */
const INCOME_MONTHS: ReadonlyArray<readonly [string, number]> = [
  ['2026-04-05', 500_000], // $5,000.00 April
  ['2026-05-05', 500_000], // $5,000.00 May → pattern $5,000.00
];
/** 20% of $5,000.00 → $1,000.00 planned savings — a working, non-zero figure. */
const SAVINGS_TARGET_BPS = 2000;

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-conscious-buckets-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** One checking account + two months of filed paycheck income, plus a savings
 *  target — the exact DB state the plan's income median and savings target
 *  read (server/spending-plan.ts:192, :523). */
function seedWorkingSavings(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedWorkingSavings: user ${email} not found`);
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
    INCOME_MONTHS.forEach(([date, cents], i) => {
      txn.run(`e2e-inc-${i}-${stamp}`, checkingId, date, cents, 'E2E PAYCHECK', 'paycheck');
    });

    db.prepare('UPDATE User SET savingsTargetBps = ? WHERE id = ?').run(
      SAVINGS_TARGET_BPS,
      user.id,
    );
  } finally {
    db.close();
  }
}

const BUCKETS = ['conscious-fixed', 'conscious-savings', 'conscious-guilt-free'] as const;

test('each bucket amount opens a panel whose rows sum to exactly that amount', async ({ page }) => {
  await signInDemo(page);
  await page.goto('/budgets');
  await expect(page.getByTestId('conscious-buckets')).toBeVisible();

  const legendCents: Record<string, number> = {};
  for (const prefix of BUCKETS) {
    const toggle = page.getByTestId(`${prefix}-toggle`);
    await expect(toggle).toBeVisible();
    legendCents[prefix] = parseCents(await toggle.innerText());

    await toggle.click();
    const panel = page.getByTestId(`${prefix}-panel`);
    await expect(panel).toBeVisible();
    // The panel's Total is the trace's own row sum; the figure the reader
    // tapped is the trace's headline. Equal on screen — the penny match.
    expect(parseCents(await page.getByTestId(`${prefix}-sum`).innerText())).toBe(
      legendCents[prefix],
    );
    await expect(page.getByTestId(`${prefix}-reconciled`)).toBeVisible();
  }

  // Anti-vacuity: Fixed is ONE plan term in this panel (category rollup ∪
  // uncovered recurring — card payments left guilt-free math in #369/#381).
  // Vacuity would be a $0 Fixed that still "reconciles"; require a real figure
  // whose single panel row matches, plus the W.7 heading that opens every
  // Fixed transaction (the multi-row audit lives on the register now).
  expect(legendCents['conscious-fixed']).toBeGreaterThan(0);
  const fixedRows = page.getByTestId('conscious-fixed-rows').locator('li');
  expect(await fixedRows.count()).toBe(1);
  expect(parseCents(await page.getByTestId('conscious-fixed-row-amount').innerText())).toBe(
    legendCents['conscious-fixed'],
  );
  const fixedHeading = page.getByTestId('conscious-fixed-heading');
  await expect(fixedHeading).toBeVisible();
  await expect(fixedHeading).toHaveAttribute('href', /spendClass=fixed/);

  // Guilt-free is the REMAINDER, so its panel is the whole subtraction: income
  // minus fixed minus savings (3 rows after card pay left the identity).
  const gfAmounts = await page
    .getByTestId('conscious-guilt-free-rows')
    .locator('[data-testid="conscious-guilt-free-row-amount"]')
    .allInnerTexts();
  expect(gfAmounts.length).toBe(3);
  expect(parseCents(gfAmounts[0])).toBeGreaterThan(0);
  expect(gfAmounts.slice(1).some((t) => parseCents(t) < 0)).toBe(true);

  // The #93 partition, asserted from PAINTED money alone: the income the
  // guilt-free panel prints equals the three legend figures added up.
  const incomeCents = parseCents(gfAmounts[0]);
  expect(
    legendCents['conscious-fixed'] +
      legendCents['conscious-savings'] +
      legendCents['conscious-guilt-free'],
  ).toBe(incomeCents);

  // The savings bucket is one row by construction. This demo's savings is
  // PROVABLY always $0 — no savings target, no goals (the seed creates neither,
  // and the settings dial is demo-fenced, settings-actions.ts) — so the pin
  // below is a fixture fact, and the control assertion binds. The working-
  // figure state (no control beside a real number) is exercised by the
  // throwaway test at the bottom of this file — never a dead branch here.
  expect(legendCents['conscious-savings']).toBe(0);
  const savingsAction = page.getByTestId('conscious-savings-row-action');
  await expect(savingsAction).toBeVisible();
  await expect(savingsAction).toHaveAttribute('href', '/settings');

  // C.11 / audit P1-14: a one-row panel certifies nothing, so it prints no
  // penny-match — one amount beside the figure it IS. And the provenance
  // clause appears only where every amount is data-derived: the demo's Fixed
  // term is (no overrides, no budget targets in the seed); the savings term
  // never is — goals and targets are chosen by the reader, not computed, and
  // the unset $0 asserts nothing either.
  await expect(page.getByTestId('conscious-fixed-reconciled')).toContainText(
    'This amount is the whole figure',
  );
  await expect(page.getByTestId('conscious-fixed-reconciled')).not.toContainText(
    'matched to the penny',
  );
  await expect(page.getByTestId('conscious-savings-reconciled')).not.toContainText(
    'nothing is invented',
  );
  await expect(page.getByTestId('conscious-guilt-free-reconciled')).toContainText(
    'matched to the penny',
  );

  // Collapse works and does not disturb the figure (a stale-render tell).
  await page.getByTestId('conscious-fixed-toggle').click();
  await expect(page.getByTestId('conscious-fixed-panel')).toBeHidden();
  expect(parseCents(await page.getByTestId('conscious-fixed-toggle').innerText())).toBe(
    legendCents['conscious-fixed'],
  );
});

test('a working savings figure renders no control beside it (O.18g)', async ({ page }) => {
  const email = await signUpThrowaway(page);
  seedWorkingSavings(email);

  await page.goto('/budgets');
  await expect(page.getByTestId('conscious-buckets')).toBeVisible();

  // Anti-vacuity: the working-figure state must PROVABLY bind before the
  // control assertion can pass. If the income pattern or the savings target
  // ever fails to reach it (plan returns null, savings computes $0), this
  // fails first — the `toHaveCount(0)` below can never pass vacuously.
  const toggle = page.getByTestId('conscious-savings-toggle');
  await expect(toggle).toBeVisible();
  const savingsCents = parseCents(await toggle.innerText());
  expect(savingsCents).toBeGreaterThan(0);

  await toggle.click();
  const panel = page.getByTestId('conscious-savings-panel');
  await expect(panel).toBeVisible();
  // The panel painted the working figure — the penny match between the figure
  // the reader tapped and the rows behind it.
  expect(parseCents(await page.getByTestId('conscious-savings-sum').innerText())).toBe(
    savingsCents,
  );
  await expect(page.getByTestId('conscious-savings-reconciled')).toBeVisible();

  // The else branch, bound: a control beside a working figure would read as a
  // correction (L.29 — the action is authored only for the unset-$0 row,
  // plan-row-labels.ts `savingsLabel`), so it must not render.
  await expect(page.getByTestId('conscious-savings-row-action')).toHaveCount(0);
});
