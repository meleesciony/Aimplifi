/**
 * O.11d — free-form tags: the write path end-to-end, and the tag total on the
 * register's OWN basis.
 *
 * Throwaway signup users with a hand-seeded fixture (the action-menu.spec recipe),
 * never the shared demo row — tag writes are demo-fenced, and the money
 * assertions below are hand-computed figures that must never depend on the shared
 * goldens moving. The demo user is exercised only READ-ONLY here (it now ships two
 * seeded tags — SEED_SPEC §Tags), which is exactly what a demo visitor gets.
 *
 * Fixture (all POSTED, June 2026 — the e2e server pins DEMO_TODAY=2026-06-10):
 *   groceries −$40.00
 *   dining    −$25.00
 *   transfer  −$10.00 (isTransfer)
 * Filtered to the tag that ends up on all three rows, "Money out" must read
 * exactly $65.00 — reachable only if the tag filter hands the UNCHANGED
 * `summarizeTransactions` its rows (transfers skipped, nothing else special).
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

const PASSWORD = 'e2e-password-123';

async function signUp(page: Page, label: string): Promise<string> {
  const email = `e2e-tags-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/** The three-row fixture. Returns the user id + each transaction id. */
function seedFixture(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const checkingId = `e2e-tags-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Everyday Checking', 'CHECKING', '4417', 500000, 'USD')`,
    ).run(checkingId, user.id, `ref-tags-chk-${stamp}`);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, 'POSTED', ?, 0)`,
    );
    const ids = {
      groc: `e2e-tags-groc-${stamp}`,
      dine: `e2e-tags-dine-${stamp}`,
      xfer: `e2e-tags-xfer-${stamp}`,
    };
    txn.run(ids.groc, checkingId, '2026-06-05', -4000, 'WHOLEFDS AM 10305', 'groceries', 0);
    txn.run(ids.dine, checkingId, '2026-06-06', -2500, 'CHIPOTLE AM 0042', 'dining', 0);
    txn.run(ids.xfer, checkingId, '2026-06-07', -1000, 'ONLINE TRANSFER TO SAVINGS', 'transfer', 1);
    return { userId: user.id, ...ids };
  } finally {
    db.close();
  }
}

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

/**
 * Drive the toolbar's tag select and wait for the commit. The ONE flake to
 * defend against is the React-hydration race: selectOption fires the DOM
 * change event the instant the element is interactive, which can land before
 * the filter bar's client component has attached its handler — React then
 * re-renders the controlled select back to its old value and no navigation
 * happens. The retry re-fires the change once hydration has certainly landed.
 * If the select were actually broken (a regression), BOTH attempts fail — the
 * retry covers the race, never a dead control.
 */
async function selectTag(page: Page, label: string) {
  const select = page.getByTestId('txn-filter-tag');
  await select.selectOption({ label });
  try {
    await page.waitForURL(/tag=/, { timeout: 5000 });
  } catch {
    await select.selectOption({ label });
    await page.waitForURL(/tag=/, { timeout: 20000 });
  }
}

function rowFor(page: Page, text: string) {
  return page.getByTestId('txn-row').filter({ hasText: text }).first();
}

/** Open a transaction's detail page from its register row. */
async function openDetail(page: Page, text: string) {
  await page.goto('/transactions');
  await rowFor(page, text).getByTestId('txn-detail-link').click();
  await expect(page.getByTestId('txn-detail')).toBeVisible();
}

/** Type a tag into the detail editor and save it. */
async function addTag(page: Page, name: string) {
  await page.getByTestId('detail-tag-input').fill(name);
  await page.getByTestId('detail-tag-add').click();
}

test.describe('O.11d — tags on a real account', () => {
  test.describe.configure({ mode: 'serial' });
  let email = '';
  let tagIdFromUrl = '';

  test('the tag control does not exist until the reader has a tag; the detail page creates the first one', async ({
    page,
  }) => {
    email = await signUp(page, 'a');
    seedFixture(email);

    await page.goto('/transactions');
    // No tags yet → no dropdown (a control that can only say "no matches").
    await expect(page.getByTestId('txn-filter-tag')).toHaveCount(0);

    await openDetail(page, 'Whole Foods');
    await addTag(page, 'work trip');
    await expect(page.getByTestId('detail-tag-chip')).toHaveText(/work trip/);

    // The register now shows the chip on that row AND grows the dropdown.
    await page.goto('/transactions');
    await expect(rowFor(page, 'Whole Foods').getByTestId('txn-tag-badge')).toHaveText(/work trip/);
    await expect(page.getByTestId('txn-filter-tag')).toBeVisible();
  });

  test('filtering by the tag shows only its rows, and the summary is the shared basis', async ({
    page,
  }) => {
    // Same session's account, re-authenticated (the serial idiom — a fresh
    // browser context per test).
    await signIn(page, email);
    await page.goto('/transactions');
    await selectTag(page, 'work trip');
    tagIdFromUrl = new URL(page.url()).searchParams.get('tag') ?? '';
    expect(tagIdFromUrl).not.toBe('');

    await expect(rowFor(page, 'Whole Foods')).toBeVisible();
    await expect(page.getByTestId('txn-row').filter({ hasText: 'Chipotle' })).toHaveCount(0);
    // One row, −$40.00: Money out reads the filtered set, unchanged engine.
    await expect(page.getByTestId('summary-out')).toHaveText('$40.00');
  });

  test('the case-insensitive fold reuses the tag; the transfer joins the list and moves NO figure', async ({
    page,
  }) => {
    await signIn(page, email);
    // Add " Work  TRIP " (new casing, padded) to the dining row — the action
    // must apply the reader's EXISTING tag, not mint a twin spelling.
    await openDetail(page, 'Chipotle');
    await addTag(page, ' Work  TRIP ');
    await expect(page.getByTestId('detail-tag-chip')).toHaveText(/work trip/);

    // Tag the transfer with the exact name too.
    await openDetail(page, 'Transfer');
    await addTag(page, 'work trip');
    await expect(page.getByTestId('detail-tag-chip')).toHaveText(/work trip/);

    // All three rows carry the one tag; the totals show the register's own math:
    // $40.00 + $25.00 out, the −$10.00 transfer NEVER counted (the engine-wide
    // rule), so Money out stays exactly $65.00 — the tag axis changed the SET,
    // never the arithmetic.
    await page.goto(`/transactions?tag=${tagIdFromUrl}`);
    await expect(page.getByTestId('txn-row')).toHaveCount(3);
    await expect(page.getByTestId('summary-out')).toHaveText('$65.00');
    await expect(page.getByTestId('summary-in')).toHaveText('$0.00');
  });

  test('a tag removes cleanly, and the filtered set loses its row', async ({ page }) => {
    await signIn(page, email);
    // Remove from the transfer row.
    await openDetail(page, 'Transfer');
    const chip = page.getByTestId('detail-tag-chip');
    const remove = page.getByTestId('detail-tag-remove-' + tagIdFromUrl);
    await expect(chip).toBeVisible();
    await remove.click();
    await expect(chip).toHaveCount(0);

    // The register filtered by the tag is now the two spend rows, still $65.00.
    await page.goto(`/transactions?tag=${tagIdFromUrl}`);
    await expect(page.getByTestId('txn-row')).toHaveCount(2);
    await expect(page.getByTestId('summary-out')).toHaveText('$65.00');
  });
});

test.describe('O.11d — a foreign tag id leaks nothing', () => {
  test("another user's tag id reads \"(tag not found)\" and the tag-unknown empty state — never their rows, never 'these filters'", async ({
    page,
  }) => {
    // Standalone on purpose (outside the serial chain, so a break above can
    // never skip this coverage): the foreign-id path needs no serial state —
    // any id that is not one of THIS reader's tags exercises the same unknown
    // resolution, so this test owns its signup and its rows.
    const email = await signUp(page, 'b');
    seedFixture(email);
    await page.goto('/transactions?tag=tag-does-not-exist-anywhere');
    // The missing option lives inside a closed <select>, which reports
    // "hidden" — assert its TEXT (the no-dead-ends idiom for the same option),
    // never its visibility.
    await expect(page.getByTestId('txn-filter-tag-missing-option')).toHaveText('(tag not found)');
    // The empty state names the CAUSE (the tag-unknown branch — the account
    // axis's own parity), never "these filters" for a set that is empty by
    // construction.
    await expect(page.getByTestId('txn-empty-tag-unknown')).toBeVisible();
    await expect(page.getByTestId('txn-empty-tag-unknown')).toContainText("isn't one of your own");
    await expect(page.getByTestId('txn-tag-badge')).toHaveCount(0);
  });
});

test.describe('O.11d — the shared demo reads tags, and only reads them', () => {
  test('seeded tags filter the demo register; the detail editor is read-only with its why', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await page.getByTestId('demo-sign-in').click();
    await page.waitForURL('**/dashboard');

    await page.goto('/transactions');
    await expect(page.getByTestId('txn-filter-tag')).toBeVisible();
    await selectTag(page, 'work trip');
    // SEED_SPEC §Tags: exactly 3 work-trip rows, each carrying the chip.
    await expect(page.getByTestId('txn-row')).toHaveCount(3);
    await expect(page.getByTestId('txn-tag-badge')).toHaveCount(3);

    // Detail view of a tagged demo row (the first filtered row — no guess at
    // which merchant construction order put first): chips render, controls do
    // not, AND the fence says why — on the TAGGED row, which is the one a first
    // visitor actually opens (the seeded rows are the tagged ones).
    await page.getByTestId('txn-row').first().getByTestId('txn-detail-link').click();
    await expect(page.getByTestId('detail-tag-chips')).toBeVisible();
    await expect(page.getByTestId('detail-tag-chip').first()).toBeVisible();
    await expect(page.getByTestId('detail-tags-demo-note')).toBeVisible();
    await expect(page.locator('[data-testid^="detail-tag-remove-"]')).toHaveCount(0);
    await expect(page.getByTestId('detail-tag-input')).toHaveCount(0);
  });

  test('an untagged demo row explains the fence instead of offering a dead input', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('demo-sign-in').click();
    await page.waitForURL('**/dashboard');
    await page.goto('/transactions');
    // A grocery row the seed never tags (canonical 'Costco', ask.spec's own
    // spelling) — the fence must explain itself, not render a dead input.
    await rowFor(page, 'Costco').getByTestId('txn-detail-link').first().click();
    await expect(page.getByTestId('detail-tags-demo-note')).toBeVisible();
    await expect(page.getByTestId('detail-tag-input')).toHaveCount(0);
  });
});
