/**
 * The two triage flows that turn on CREATING a category — which the shared demo user
 * is fenced out of, by design.
 *
 * WHY THEY LIVE HERE AND NOT IN `phase2-triage.spec.ts` (K.6). Both tests used to sign
 * in as the demo user and then write in a new category. O.17 closed the typed leg of
 * `docs/lessons/shared-demo-account-must-not-learn.md`: `createCustomCategory` returns
 * DEMO_ENTRY_BLOCKED for the demo row, because every anonymous visitor IS that row, so
 * a name one visitor types is a name the next one reads in every picker and every
 * report. The fence is correct and is not relaxed here — the FIXTURE moves instead.
 *
 * The defect each test guards is a React dispatch ORDERING inside `createAndFile`
 * (`setExtraCategories`/`setNewCatName` fire before `onPick → fileRow →
 * removeRowLocally`), so the coverage cannot move to a unit test: a component-free test
 * cannot see it. It needs a real browser and a real non-demo user.
 *
 * The seeded queue below replaces the demo queue these tests used to borrow, which also
 * removes their dependency on `phase2-triage.spec.ts`'s serial-residue contract: each
 * test owns a fresh user and a fresh 4-group queue, so neither can be starved by the
 * other's filings and neither is masked when a sibling fails.
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page, tag: string): Promise<string> {
  const email = `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * Four review GROUPS on one checking account, every one of them honestly ambiguous.
 *
 * Shape, and why each part is load-bearing:
 *  - The descriptors are local businesses our ruleset does not know, so
 *    `suggestedCategoryId` is null; `providerCategoryId` is left NULL, so the L.12
 *    provider fallback is null too; and a just-signed-up user has no corrections, so
 *    the `unanimousProposal` last resort is null as well. All three null is exactly the
 *    condition for `triage-no-suggestion` — which the write-in test needs on its top
 *    card, because it reaches the picker by clicking accept on a card with nothing to
 *    accept. `GOOSE POND BAR GRILLE` is the descriptor `triage-provider-suggestion.spec`
 *    already proves our own pipeline cannot categorize.
 *  - The first group holds THREE rows and the rest hold one. Groups sort by row count
 *    DESC (`src/lib/engine/categorize/group.ts:176`), so the multi-row group is
 *    deterministically on top: the singles test finds "One by one" on its first look
 *    rather than filing its way there, and still has two rows to drain before the
 *    write-in lands on the LAST one.
 *  - FOUR groups, not two: the write-in test files its way down to `before - 2` and
 *    still expects a card to open a picker on.
 *
 * No Merchant row is created: triage falls back to a pure `normalizeMerchant(
 * rawDescriptor)` for merchantless rows (`src/server/triage.ts:311`), which is what a
 * CSV or manual row already relies on.
 */
const AMBIGUOUS_TOP = 'GOOSE POND BAR GRILLE';
const AMBIGUOUS_SINGLES = [
  'WHITTIER FEED AND SEED',
  'TALLGRASS CANOE LIVERY',
  'BRIDGEPORT KILN WORKS',
] as const;
/** Groups the fixture puts in the queue — the tests' `before` count. */
const SEEDED_GROUPS = 1 + AMBIGUOUS_SINGLES.length;

function seedAmbiguousReviewQueue(email: string): void {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedAmbiguousReviewQueue: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const checkingId = `e2e-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 250000, 'USD')`,
    ).run(checkingId, user.id);

    // "Transaction" is a reserved SQLite keyword — quote the table name.
    const insert = db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, merchantId, categoryId,
          confidenceBps, needsReview, isTransfer, status)
       VALUES (?, ?, ?, ?, ?, NULL, 'uncategorized', 5000, 1, 0, 'POSTED')`,
    );

    // The multi-row group: three visits to one unknown merchant.
    const topRows: Array<[string, number]> = [
      ['2026-06-08', -4210],
      ['2026-06-01', -3675],
      ['2026-05-24', -5130],
    ];
    topRows.forEach(([date, cents], i) => {
      insert.run(`e2e-top-${i}-${stamp}`, checkingId, date, cents, AMBIGUOUS_TOP);
    });

    // Three one-row groups, so the queue has somewhere to advance to.
    AMBIGUOUS_SINGLES.forEach((descriptor, i) => {
      insert.run(`e2e-single-${i}-${stamp}`, checkingId, '2026-06-05', -1900 - i * 25, descriptor);
    });
  } finally {
    db.close();
  }
}

/** Sign up, seed the queue, and land on the inbox with all four groups present. */
async function arriveAtSeededTriage(page: Page, tag: string): Promise<void> {
  const email = await signUpThrowaway(page, tag);
  seedAmbiguousReviewQueue(email);
  await page.goto('/triage');
  await expect(page.getByTestId('triage-inbox')).toHaveAttribute(
    'data-remaining',
    String(SEEDED_GROUPS),
  );
  // The fixture's whole point: nothing here is auto-suggestible, so every path below
  // goes through a real human decision. If the ruleset ever learns one of these
  // merchants, this fails HERE with a clear cause instead of deep inside a flow.
  await expect(page.getByTestId('triage-no-suggestion')).toBeVisible();
}

test('singles mode never leaks onto the next card: write-in on the LAST row resets to idle (cycle-2 P1)', async ({ page }) => {
  await arriveAtSeededTriage(page, 'triage-singles');
  const inbox = page.getByTestId('triage-inbox');
  const splitBtn = page.getByTestId('triage-split-btn');
  await expect(splitBtn).toBeVisible();

  // The seeded top group is the multi-row one (groups sort by count DESC), so the
  // per-row mode is reachable immediately: 1-row tops read "Split", multi-row "One by one".
  await expect(splitBtn).toContainText('One by one');

  const before = Number(await inbox.getAttribute('data-remaining'));
  await splitBtn.click();
  await expect(page.getByTestId('triage-singles')).toBeVisible();

  // Drain the group to its LAST row via per-row quick-picks…
  let rows = await page.getByTestId('triage-single-row').count();
  expect(rows).toBeGreaterThan(1);
  while (rows > 1) {
    await page.getByTestId('single-pick').first().click();
    await page.getByTestId('triage-alternatives').locator('button').first().click();
    await expect(page.getByTestId('triage-single-row')).toHaveCount(rows - 1);
    rows -= 1;
  }

  // …then file the last row through the WRITE-IN. createAndFile dispatches
  // setExtraCategories/setNewCatName BEFORE onPick→fileRow→removeRowLocally —
  // exactly the ordering under which the pre-fix reset (a side effect inside
  // the setGroups updater, skipped when React defers the updater) silently
  // no-oped and singles mode leaked onto the NEXT merchant's card (cycle-2 P1).
  await page.getByTestId('single-pick').click();
  await page.getByTestId('triage-add-category').click();
  await page.getByTestId('new-category-name').fill(`Leak ${Date.now().toString().slice(-6)}`);
  await page.getByTestId('new-category-submit').click();

  // Group emptied → queue advanced AND mode reset: the next card renders
  // COLLAPSED (no pre-expanded, untapped singles list).
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  await expect(page.getByTestId('triage-singles')).toHaveCount(0);
  await expect(page.getByTestId('triage-card')).toBeVisible();
});

test('write-in category: create + file the whole group, joins pickers, errors stay inline (#136)', async ({ page }) => {
  await arriveAtSeededTriage(page, 'triage-write-in');
  const catName = `Golf ${Date.now().toString().slice(-6)}`; // unique per run (retry-safe)
  const inbox = page.getByTestId('triage-inbox');
  const before = Number(await inbox.getAttribute('data-remaining'));
  expect(before).toBeGreaterThan(1);

  // ── Lock (critic P1): a half-typed write-in form must NOT survive when the
  // top card changes without advance(). File the top group via a quick-pick,
  // open the form on the next card and type into it, then UNDO — reopening the
  // picker on the restored card must show the button, not a stale form.
  await page.getByTestId('triage-accept').click(); // no suggestion → opens the picker
  await expect(page.getByTestId('triage-alternatives-panel')).toBeVisible();
  // Keyboard path (critic P1): opening the panel lands focus ON it.
  await expect(page.getByTestId('triage-alternatives-panel')).toBeFocused();
  await page.getByTestId('triage-alternatives').locator('button').first().click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  await page.getByTestId('triage-more').click();
  await page.getByTestId('triage-add-category').click();
  await page.getByTestId('new-category-name').fill('Stale draft');
  await page.getByTestId('triage-undo').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before));
  await page.getByTestId('triage-more').click();
  await expect(page.getByTestId('triage-new-category')).toHaveCount(0); // form closed
  await expect(page.getByTestId('triage-add-category')).toBeVisible();

  // Open the write-in mini-form; the group select is prefilled (spending groups
  // only) and the whole page stays WCAG A/AA clean with the form open.
  await page.getByTestId('triage-add-category').click();
  await expect(page.getByTestId('triage-new-category')).toBeVisible();
  await expect(page.getByTestId('new-category-group')).not.toHaveValue('');
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // Create & file — the WHOLE top group files under the new category in one step.
  await page.getByTestId('new-category-name').fill(catName);
  await page.getByTestId('new-category-submit').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));

  // The fresh category is assignable on the NEXT card without a reload — and
  // the picker SEARCH narrows ~84 options to exactly it (#137).
  await page.getByTestId('triage-more').click();
  await page.getByTestId('triage-cat-search').fill(catName);
  await expect(page.getByTestId('triage-cat-option')).toHaveCount(1);
  await expect(page.getByTestId('triage-cat-option')).toHaveText(catName);
  await page.getByTestId('triage-cat-search').fill('zzz no such category');
  await expect(page.getByTestId('triage-cat-no-match')).toBeVisible();
  await expect(page.getByTestId('triage-add-category')).toBeVisible(); // create-hint synergy
  // A GROUP-label query must find the group's categories (critic P1).
  await page.getByTestId('triage-cat-search').fill('bills');
  await expect(page.getByTestId('triage-cat-option').first()).toBeVisible();
  await expect(page.getByTestId('triage-cat-no-match')).toHaveCount(0);
  await page.getByTestId('triage-cat-search').fill('');

  // ── Lock (critic P1): a REJECTED create action degrades to the inline error —
  // never the route error boundary. Abort the next action POST.
  let abortedOnce = false;
  await page.route('**/triage*', async (route) => {
    if (!abortedOnce && route.request().method() === 'POST') {
      abortedOnce = true;
      await route.abort('connectionfailed');
    } else {
      await route.continue();
    }
  });
  await page.getByTestId('triage-add-category').click();
  await page.getByTestId('new-category-name').fill(`${catName} B`);
  await page.getByTestId('new-category-submit').click();
  await expect(page.getByTestId('new-category-error')).toBeVisible();
  await expect(inbox).toBeVisible(); // the island survived — no error boundary
  await page.unroute('**/triage*');

  // …and a duplicate name errors INLINE, filing nothing (queue count unchanged).
  await page.getByTestId('new-category-name').fill(catName);
  await page.getByTestId('new-category-submit').click();
  await expect(page.getByTestId('new-category-error')).toBeVisible();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));

  // Persistence: a full server re-render must offer the category — proves the
  // DB row, not the client overlay. Then Enter-files-single-match end-to-end,
  // and undo restores the whole GROUP.
  await page.reload();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  await page.getByTestId('triage-more').click();
  await page.getByTestId('triage-cat-search').fill(catName);
  await expect(page.getByTestId('triage-cat-option')).toHaveCount(1);
  await page.getByTestId('triage-cat-search').press('Enter');
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 2));
  await page.getByTestId('triage-undo').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  // The search filter must NOT survive the undo's card change (critic P2).
  await page.getByTestId('triage-more').click();
  await expect(page.getByTestId('triage-cat-search')).toHaveValue('');

  // GUARD (checker): a MULTI-match query + Enter must do nothing.
  await page.getByTestId('triage-cat-search').fill('bills');
  await page.getByTestId('triage-cat-search').press('Enter');
  await expect(page.getByTestId('triage-new-category')).toHaveCount(0);
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));

  // Prefill (#139): zero matches + Enter opens the write-in prefilled with the
  // query; a HELD Enter's auto-repeat must NOT chain into create+file.
  await page.getByTestId('triage-cat-search').fill('Pickleball Dues');
  await expect(page.getByTestId('triage-cat-no-match')).toBeVisible();
  await page.keyboard.down('Enter');
  await expect(page.getByTestId('triage-new-category')).toBeVisible();
  await expect(page.getByTestId('new-category-name')).toHaveValue('Pickleball Dues');
  await page.keyboard.down('Enter'); // repeat keydown lands on the name input
  await page.keyboard.up('Enter');
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1)); // nothing filed
  await expect(page.getByTestId('triage-new-category')).toBeVisible(); // form intact

  // GUARD (checker P1): with the form OPEN, Enter on a fresh zero-match query
  // must NOT re-open/prefill — the user's edited draft survives.
  await page.getByTestId('new-category-name').fill('Pickleball Edited');
  await page.getByTestId('triage-cat-search').fill('Croquet Fees');
  await page.getByTestId('triage-cat-search').press('Enter');
  await expect(page.getByTestId('new-category-name')).toHaveValue('Pickleball Edited');

  // iOS focus-zoom guard (#140): touch form controls ≥16px.
  for (const id of ['triage-cat-search', 'new-category-name']) {
    const fs = await page
      .getByTestId(id)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fs, `${id} touch font-size floor (iOS zoom guard)`).toBeGreaterThanOrEqual(16);
  }
});
