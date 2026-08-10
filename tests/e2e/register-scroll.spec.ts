/**
 * Editing a field in Activity keeps the reader where they were (owner report,
 * 2026-08-03: "changing a field in activity … completely refresh page and bring
 * me to the top … very annoying when I'm trying to log many at a time").
 *
 * The register's mutation recipe is deliberately a FULL RELOAD, not
 * router.refresh() — the re-rendered row is the confirmation that cannot lie
 * (#164/#166/#167, docs/lessons/mutation-form-recipe.md). That stays. What this
 * spec locks is the reader's PLACE across that reload: the browser's own
 * scroll restoration cannot do it here, because `(app)/loading.tsx` paints a
 * ~600px skeleton first and a restore into a short document clamps to the top.
 *
 * Runs as a THROWAWAY signup user with a hand-seeded fixture (the
 * action-menu.spec recipe): the flag and class writes are demo-fenced, and a
 * shared demo row would make the row count — and therefore the scroll depth —
 * depend on whatever another spec left behind.
 *
 * Fixture: one CHECKING account, 40 POSTED rows on 40 consecutive dates ending
 * 2026-06-09 (the e2e server pins DEMO_TODAY=2026-06-10). 40 dates = 40 sticky
 * date headers, so page 1 (PAGE_SIZE 100) is several thousand px tall at
 * 380×800 and a row in the middle is only reachable by scrolling.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const PASSWORD = 'e2e-password-123';

/** How far the restored position may sit from where the reader left it. One
 *  row's chrome can legitimately change height (an "Excluded from totals" badge
 *  wraps onto a new line), so this is a "same place", not a pinned pixel. */
const SCROLL_TOLERANCE_PX = 150;

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-reg-scroll-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

function seedFixture(email: string): void {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-rs-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '0977', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-rs-chk-${stamp}`);

    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 0, 0)`,
    );
    // One row per day, newest 2026-06-09, walking backwards — every row lands on
    // its own date header so the list is tall.
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 5, 9));
      d.setUTCDate(d.getUTCDate() - i);
      const date = d.toISOString().slice(0, 10);
      txn.run(
        `e2e-rs-row-${i}-${stamp}`,
        checkingId,
        date,
        -1000 - i,
        `CHIPOTLE RS ${String(i).padStart(4, '0')}`,
        'dining',
      );
    }
  } finally {
    db.close();
  }
}

/** Scroll the list until the given row is on screen, and report where we landed. */
async function scrollToRow(page: Page, index: number): Promise<number> {
  await page.getByTestId('txn-row').nth(index).scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  // The whole point of the spec is a position a reload can lose — if the fixture
  // ever stops being tall enough to scroll, fail here rather than pass vacuously.
  expect(y).toBeGreaterThan(600);
  return y;
}

/**
 * Stamp the CURRENT document so the reload it is about to do is observable.
 *
 * Measured, not assumed: without this, the first version of this spec passed in
 * 1.2s on code that loses the position, because `window.scrollY` was read off
 * the pre-reload document while the new one was still in flight — the poll saw
 * the old position and stopped. The stamp is gone in the new document, so
 * waiting for its absence is the reload actually having landed.
 */
async function stampDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __preReload?: true }).__preReload = true;
  });
}

async function waitForReload(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __preReload?: true }).__preReload !== true,
    null,
    { timeout: 20_000 },
  );
}

test.describe('Activity keeps your place across an inline edit', () => {
  test.describe.configure({ mode: 'serial' });
  let email = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    email = await signUpThrowaway(page);
    seedFixture(email);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  });

  test('excluding a row from the action menu returns to the same place, not the top', async ({
    page,
  }) => {
    await page.goto('/transactions');
    await expect(page.getByTestId('txn-row').first()).toBeVisible();

    const before = await scrollToRow(page, 20);
    await stampDocument(page);

    await page.getByTestId('txn-row').nth(20).getByTestId('txn-action-trigger').click();
    await page.getByTestId('txn-action-excludeFromTotals').click();

    await waitForReload(page);
    // …and the write's confirmation is on the row, so this is the real new page.
    await expect(page.getByTestId('txn-excluded-badge')).toBeVisible({ timeout: 20_000 });

    // Poll: the restore runs on mount, which is after the reload's first paint.
    await expect
      .poll(async () => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeGreaterThan(before - SCROLL_TOLERANCE_PX);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(
      before + SCROLL_TOLERANCE_PX,
    );
  });

  test('re-filing a category returns to the same place, not the top', async ({ page }) => {
    await page.goto('/transactions');
    await expect(page.getByTestId('txn-row').first()).toBeVisible();

    const before = await scrollToRow(page, 25);

    const row = page.getByTestId('txn-row').nth(25);
    await row.getByTestId('category-chip').click();
    await page.getByTestId('cat-option').filter({ hasText: 'Groceries' }).first().click();
    await stampDocument(page);
    await page.getByTestId('recat-once').click();

    await waitForReload(page);
    await expect(row.getByTestId('category-chip')).toHaveText(/Groceries/, { timeout: 20_000 });

    await expect
      .poll(async () => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeGreaterThan(before - SCROLL_TOLERANCE_PX);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(
      before + SCROLL_TOLERANCE_PX,
    );
  });
});
