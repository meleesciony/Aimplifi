/**
 * O.20h — one discretionary definition: the /coach creep bar classifies rows
 * with the register's own Fixed/Discretionary spend class.
 *
 * The unit suite locks the engine (a reader-marked-Fixed row leaves the bar and
 * the panel; an overridden guilt-free row counts; a detected recurring series'
 * merchant classifies fixed; the demo seed is byte-identical with no reader
 * input). What a pure test cannot see is the SHIPPED WIRING end to end: the
 * reader's per-row override, stored through the register's own action menu,
 * moves the figure the /coach bar prints — the exact contradiction the owner
 * reported (a row reading "Fixed · you set this" that the bar still counted).
 *
 * The e2e server pins DEMO_TODAY=2026-06-10 for EVERY user, so the compared
 * window is 2025-12 … 2026-05 for the throwaway user too.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const WINDOW = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'] as const;

async function signUpThrowaway(page: Page, tag: string): Promise<string> {
  const email = `e2e-o20h-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function openDb() {
  return new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
}

/**
 * A checking account, a paycheck every window month, and one discretionary-
 * category charge every month at a DIFFERENT payee (no recurring series is
 * engineered, and each merchant holds one row — so the action menu writes the
 * class directly, no "All N" scope question). The classifier rides the
 * category's guilt-free suggestion, so the bar is measurable and the ONLY thing
 * that can move it is the reader's own override.
 */
function seedCreepFixture(email: string) {
  const db = openDb();
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedCreepFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-chk-${stamp}`);

    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    WINDOW.forEach((month, i) => {
      txn.run(`e2e-o20h-inc-${i}-${stamp}`, checkingId, `${month}-05`, 500_000, 'E2E INCOME', 'paycheck');
      txn.run(
        `e2e-o20h-buy-${i}-${stamp}`,
        checkingId,
        `${month}-${String(6 + i * 3).padStart(2, '0')}`,
        -100_000,
        `O20H STORE ${String.fromCharCode(65 + i)}`,
        'shopping',
      );
    });
  } finally {
    db.close();
  }
}

test('a row the reader marks Fixed leaves the creep bar the register badge says it left', async ({
  page,
}) => {
  const email = await signUpThrowaway(page, 'fixed');
  seedCreepFixture(email);

  // Baseline, before any override: the bar counts the $1,000.00/month shopping
  // rows (flat spend, flat income — "Tracking income").
  await page.goto('/coach');
  const card = page.getByTestId('creep-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Tracking income');
  const bars = card.locator('[data-testid^="creep-bar-"]');
  await expect(bars.first()).toBeVisible();
  const month = (await bars.first().getAttribute('data-testid'))!.replace('creep-bar-', '');
  await bars.first().click();
  const panel = page.getByTestId(`creep-bar-panel-${month}`);
  await expect(panel).toBeVisible();
  // The unified basis sentence names the register's own label.
  await expect(panel).toContainText('the same Fixed or Discretionary label the register shows');
  // The panel renders ONE <ul data-testid="creep-bar-rows-…"> whose children are
  // the listed rows — count the <li> children, not the container (critic
  // cycle-1 P2-5). December is the oldest window month (the pinned e2e clock)
  // and Store A exists only there, so the before/after pair isolates the row.
  const rows = panel.locator('[data-testid^="creep-bar-rows-"] > li');
  await expect(rows.first()).toBeVisible();
  const rowCountBefore = await rows.count();
  expect(rowCountBefore).toBeGreaterThan(0);
  await page.getByTestId(`creep-bar-toggle-${month}`).click();
  await expect(panel).toHaveCount(0);

  // The reader opens the register and marks one shopping row (December's
  // "O20H Store A") Fixed from the row's own action menu — the same writer
  // /budgets and the badge read. The trigger's aria-label names the merchant,
  // which scopes every later lookup to exactly this row.
  await page.goto('/transactions');
  const trigger = page.getByRole('button', { name: 'All actions for this O20H Store A transaction' });
  await expect(trigger).toBeVisible();
  const row = page.locator('li', { has: trigger });
  await expect(row.getByTestId('txn-spend-class')).toHaveAttribute('data-spend-class', 'guilt-free');
  await trigger.click();
  await expect(page.getByTestId('txn-action-menu')).toBeVisible();
  // The verb opens the pick step inside the menu (C.16), then the choice —
  // each seeded merchant holds exactly one row, so there is no "All N" scope
  // question after it.
  await page.getByTestId('txn-action-spendClass').click();
  await page.getByTestId('txn-spend-class-fixed').click();

  // The write lands on the register: the badge flips to Fixed and carries the
  // reader-set marker.
  await expect(
    row.getByTestId('txn-spend-class').filter({ has: page.getByTestId('txn-spend-class-reader-set') }),
  ).toHaveAttribute('data-spend-class', 'fixed', { timeout: 15_000 });

  // Back on /coach: that row has left the bar's panel — the bar and the badge
  // now state one definition.
  await page.goto('/coach');
  await expect(card).toContainText('Tracking income');
  await bars.first().click();
  const panel2 = page.getByTestId(`creep-bar-panel-${month}`);
  await expect(panel2).toBeVisible();
  const rows2 = panel2.locator('[data-testid^="creep-bar-rows-"] > li');
  const rowCountAfter = await rows2.count();
  expect(rowCountAfter).toBe(rowCountBefore - 1);
});
