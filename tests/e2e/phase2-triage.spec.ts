/**
 * Phase 2 golden flow at 380×800 — the mobile triage inbox, MERCHANT-GROUP
 * edition (PULSE_CATEGORIZATION_FIX Phase 3c, DECISIONS #143).
 *
 * HUMAN-TIME BUDGET (documented mapping for the "<60 seconds" target, since CI
 * wall-clock ≠ human time): each logged interaction is one thumb action with a
 * decision glance:
 *   swipe  = 1.2s motion + 2.5s glance = 3.7s
 *   tap    = 1.5s motion + 2.5s glance = 4.0s
 *
 * TARGET SCOPE (honesty note): SPEC.md:28 budgets "a simulated week-of-spending
 * review" at <15 interactions / <60s. The OLD per-transaction flow passed that
 * bar for the FULL 60-day backlog — but only by mass-accepting the amount-based
 * bestGuess ('Shopping') on checks and Zelle rows: fast, silently WRONG data.
 * The group flow prices every decision honestly (1 tap when a real suggestion
 * exists, 2 when the user must pick), so this spec asserts BOTH:
 *   (a) the WEEK slice (cards whose newest activity is within 7 days of the
 *       seed asOf) stays under the SPEC budget, and
 *   (b) the whole 60-day backlog clears in ≤ 2×groups+2 interactions — the
 *       structural claim: cost scales with DECISIONS, never with rows.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './helpers/test';

test.describe.configure({ mode: 'serial' });

const SEED_AS_OF = new Date(Date.UTC(2026, 5, 10)); // DEMO_TODAY 2026-06-10
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse the NEWEST 'Mon D' date out of the group card's meta line. */
function newestDateFromMeta(meta: string): Date | null {
  const m = [...meta.matchAll(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/g)];
  if (m.length === 0) return null;
  const last = m[m.length - 1];
  return new Date(Date.UTC(2026, MONTHS.indexOf(last[1]), Number(last[2])));
}

async function signInToTriage(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.getByTestId('bottom-nav-triage').click();
  await page.waitForURL('**/triage');
}

async function interactionLog(page: Page) {
  return page.evaluate(() => window.__triageLog ?? []);
}

test('group cards: honest suggestions, gesture flow, group filing, split — all undoable', async ({ page }) => {
  await signInToTriage(page);
  const card = page.getByTestId('triage-card');
  const inbox = page.getByTestId('triage-inbox');
  await expect(card).toBeVisible();
  const before = Number(await inbox.getAttribute('data-remaining'));
  expect(before).toBeGreaterThan(0);
  // The counter frames MERCHANTS (decisions), never a raw transaction count.
  await expect(page.getByTestId('triage-count')).toContainText('merchant');

  // Top group = the seed's biggest: 6 Zelle payments to J. Park (leverage sort).
  // It is AGGREGATE and UNKNOWN → the suggestion is honestly ABSENT…
  await expect(page.getByTestId('triage-no-suggestion')).toBeVisible();
  await expect(page.getByTestId('triage-suggestion')).toHaveCount(0);

  // …so swipe RIGHT has nothing honest to accept: the card snaps back and the
  // queue is UNCHANGED (the old flow silently filed an amount-based guess here).
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(inbox).toHaveAttribute('data-remaining', String(before));

  // Swipe LEFT → the picker: exactly 3 quick-picks + searchable all-category list.
  const box2 = (await card.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 - 140, box2.y + box2.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('triage-alternatives')).toBeVisible();
  await expect(page.getByTestId('triage-alternatives').locator('button')).toHaveCount(3);

  // Search → tap the exact match ('Rent' also surfaces 'Rental Car') — ALL 6
  // rows file in ONE decision; the queue drops by one GROUP, and no rule
  // prompt appears (aggregate — #23).
  await page.getByTestId('triage-cat-search').fill('Rent');
  await page.getByTestId('triage-cat-option').filter({ hasText: 'Rent & Mortgage' }).click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  await expect(page.getByTestId('rule-prompt')).toHaveCount(0);

  // Next top is a 1-row group → long-press opens SPLIT (both parts pickable).
  const box3 = (await card.boundingBox())!;
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByTestId('triage-split')).toBeVisible();
  await page.getByTestId('split-amount').fill('5');
  await page.getByTestId('split-confirm').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 2));

  // Universal undo: both actions restore, group-sized (no reload needed).
  await page.getByTestId('triage-undo').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before - 1));
  await page.getByTestId('triage-undo').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before));
});


// Read-only #162 lock — runs BEFORE the destructive tests below: it asserts against
// the PRISTINE all-ambiguous demo queue, which the singles/write-in/review-cost
// tests permanently consume (serial-residue contract, see the note further down).
test('accept-all banner is absent on the all-ambiguous golden demo (DECISIONS #162)', async ({ page }) => {
  await signInToTriage(page);
  // The inbox still renders its ambiguous carousel normally under the new code…
  await expect(page.getByTestId('triage-inbox')).toBeVisible();
  await expect(page.getByTestId('triage-card')).toBeVisible();
  await expect(page.getByTestId('triage-no-suggestion')).toBeVisible(); // top group = ambiguous
  // …and the bulk-accept banner + button do NOT appear (0 confident groups).
  await expect(page.getByTestId('triage-accept-all-banner')).toHaveCount(0);
  await expect(page.getByTestId('triage-accept-all')).toHaveCount(0);
});

// ── SERIAL-RESIDUE CONTRACT (2026-07-05): this file is mode:'serial' on ONE shared
// seeded DB. The demo queue has exactly ONE multi-row group (the 6-row Zelle
// aggregate) and the write-in test below NET-FILES the top group (its mid-test
// reload discards the client undo stack, so it cannot restore it). The singles-mode
// test NEEDS that multi-row group, so it runs FIRST: it drains the Zelle group's
// rows but leaves every other group intact, which the later tests don't depend on.
// (Previously this ordering bug was invisible: the singles test always died at the
// 60s pending-wedge stall before reaching the multi-row hunt — see DECISIONS #164.)
test('singles mode never leaks onto the next card: write-in on the LAST row resets to idle (cycle-2 P1)', async ({ page }) => {
  await signInToTriage(page);
  const inbox = page.getByTestId('triage-inbox');
  const splitBtn = page.getByTestId('triage-split-btn');
  await expect(splitBtn).toBeVisible();

  // Composition-independent: file 1-row tops away until a MULTI-row group
  // surfaces (its action button reads "One by one"; 1-row tops read "Split").
  for (let i = 0; i < 8; i++) {
    if ((await splitBtn.textContent())?.includes('One by one')) break;
    const remaining = Number(await inbox.getAttribute('data-remaining'));
    expect(remaining, 'queue exhausted before a multi-row group surfaced (fixture drift)').toBeGreaterThan(1);
    const hasSuggestion = (await page.getByTestId('triage-suggestion').count()) > 0;
    await page.getByTestId('triage-accept').click(); // suggestion files; otherwise opens the picker
    if (!hasSuggestion) {
      await page.getByTestId('triage-alternatives').locator('button').first().click();
    }
    await expect(inbox).toHaveAttribute('data-remaining', String(remaining - 1));
  }
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
  await signInToTriage(page);
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

test('review cost scales with DECISIONS: week slice <15/<60s, full backlog ≤ 2×groups+2', async ({ page }) => {
  // 12+ sequential server actions; this machine's documented action-apply stall
  // (STATUS #16/#17) can hold a `pending` button past the default 60s. Wall-clock
  // is NOT the metric here — the human-time budget is computed from the log.
  test.setTimeout(300_000);
  await signInToTriage(page);
  await page.evaluate(() => {
    window.__triageLog = [{ type: 'tap', detail: 'nav → Review', at: 1 }];
  });
  const inbox = page.getByTestId('triage-inbox');
  const initialGroups = Number(await inbox.getAttribute('data-remaining'));
  expect(initialGroups).toBeGreaterThan(0);

  // Clear the whole queue thumb-style, pricing every decision honestly:
  // suggestion → 1 tap; none → open picker + first quick-pick (2 taps).
  // Track which interactions belong to the SPEC's week slice (newest card
  // activity within 7 days of the seed asOf).
  let weekInteractions = 0;
  const weekCut = new Date(SEED_AS_OF.getTime() - 7 * 86_400_000);
  for (let guard = 0; guard < initialGroups + 5; guard++) {
    if (await page.getByTestId('triage-empty').isVisible().catch(() => false)) break;
    const meta = (await page.getByTestId('triage-group-meta').textContent()) ?? '';
    const newest = newestDateFromMeta(meta);
    const inWeek = newest !== null && newest >= weekCut;
    const logBefore = (await interactionLog(page)).length;

    const hasSuggestion = await page.getByTestId('triage-suggestion').isVisible().catch(() => false);
    const remainingBefore = Number(await inbox.getAttribute('data-remaining'));
    // The queue advances optimistically; wait out the previous action's pending
    // window before the next decision (machine-stall tolerance, not human time).
    await expect(page.getByTestId('triage-accept')).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId('triage-accept').click();
    if (!hasSuggestion) {
      await expect(page.getByTestId('triage-alternatives-panel')).toBeVisible();
      await page.getByTestId('triage-alternatives').locator('button').first().click();
    }
    // The last decision unmounts the inbox into the empty state — accept either.
    await expect(async () => {
      if (await page.getByTestId('triage-empty').isVisible().catch(() => false)) return;
      const now = Number(await inbox.getAttribute('data-remaining'));
      expect(now).toBe(remainingBefore - 1);
    }).toPass({ timeout: 20000 });
    if (inWeek) weekInteractions += (await interactionLog(page)).length - logBefore;
  }

  await expect(page.getByTestId('triage-empty')).toBeVisible();

  const log = await interactionLog(page);
  console.log('=== TRIAGE INTERACTION LOG (merchant-group flow) ===');
  for (const entry of log) console.log(`  ${entry.at}. [${entry.type}] ${entry.detail}`);
  const seconds = log.reduce((s, e) => s + (e.type === 'swipe' ? 3.7 : 4.0), 0);
  const weekSeconds = weekInteractions * 4.0;
  console.log(
    `  groups=${initialGroups} total-interactions=${log.length} (~${seconds.toFixed(1)}s human) | week-slice=${weekInteractions} (~${weekSeconds.toFixed(1)}s)`,
  );

  // (a) SPEC.md:28 — the week's review fits the budget. The >0 canary keeps the
  //     lock non-vacuous: the seed HAS in-week review rows, so a meta-format
  //     change that breaks date parsing must fail here, not silently pass.
  expect(weekInteractions).toBeGreaterThan(0);
  expect(weekInteractions).toBeLessThan(15);
  expect(weekSeconds).toBeLessThan(60);
  // (b) Structural: the FULL 60-day backlog costs ≤ 2 interactions per decision
  //     (+ nav + slack) — cost scales with merchants, never with transaction rows.
  expect(log.length).toBeLessThanOrEqual(initialGroups * 2 + 2);

  // the dashboard badge is gone — feed fully reviewed
  await page.goto('/dashboard');
  await expect(page.getByTestId('review-badge')).toHaveCount(0);
});

test('categorization accuracy card shows a measured value (DECISIONS #37)', async ({ page }) => {
  await signInToTriage(page);
  const card = page.getByTestId('accuracy-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Categorization accuracy');
  // seeded known-merchant labels guarantee a measured percentage (n > 0)
  await expect(page.getByTestId('accuracy-value')).toContainText('%');
});

// "Accept all confident" is INERT on the golden demo (DECISIONS #162): every one
// of the seed's review groups is genuinely ambiguous (Zelle payees, checks, an
// estimated Store Card) → 0 confident groups → the bulk-accept banner must NOT
// render, so the golden dataset is byte-identical and nothing can be mass-filed
// without a per-group suggestion. Read-only: this asserts absence + normal render
// (no writes → immune to the #16 action-apply stall). The ACTIVE drain/mint/undo
// path is locked by the deterministic engine+action tests in
// tests/unit/accept-all-confident.test.ts (adding confident rows to the seed
// would move the very golden it must hold — the #160/#123 precedent).
