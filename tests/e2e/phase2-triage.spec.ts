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
 *
 * NOT HERE (K.6): the two write-in tests — singles-mode reset and create-and-file —
 * moved to `triage-write-in.spec.ts`. They create a category, which the shared demo
 * user is fenced out of (O.17), so they seed their own non-demo user instead of
 * borrowing this file's demo queue.
 */
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

// ── SERIAL-RESIDUE CONTRACT (rewritten K.6, 2026-08-06) ──────────────────────────
// This file is mode:'serial' on ONE shared seeded demo DB, so declaration order IS
// the fixture. The rule is now a single ordering invariant rather than a per-test
// hand-off: EVERY TEST THAT LEAVES THE QUEUE AS IT FOUND IT COMES FIRST, AND THE ONE
// TEST THAT DRAINS IT COMES LAST.
//
// The tests below file only what they undo (or skip without filing), so each one
// hands the next a queue with the same groups in it. `review cost` is the exception:
// it clears the queue to empty by design, which is its whole claim — so nothing that
// needs a card may be declared after it.
//
// This replaces a contract written around the two write-in tests, which used to sit
// between `accept-all banner` and `review cost` and drained the demo's only multi-row
// group on their way through. They moved to `triage-write-in.spec.ts` in K.6, and the
// ordering rule outlived the reason: `Skip for now` (#374) was declared AFTER
// `review cost` and had therefore NEVER run green in a full-file run — it opens by
// requiring a card, and there is none left. It passed alone, so the failure was pure
// declaration order, and it was invisible because the two write-in tests aborted the
// serial file before it was ever reached.

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


// Read-only #162 lock — asserts against the PRISTINE all-ambiguous demo queue, which
// the test above restores by undoing both of its filings.
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

// Skips, never files — so the queue it hands on is the one it was given. Declared
// BEFORE `review cost` (K.6): it needs a card, and `review cost` leaves none.
test('Skip for now rotates to the next merchant without filing (#374)', async ({ page }) => {
  await signInToTriage(page);
  const inbox = page.getByTestId('triage-inbox');
  await expect(page.getByTestId('triage-card')).toBeVisible();
  const before = Number(await inbox.getAttribute('data-remaining'));
  expect(before).toBeGreaterThan(1);
  const firstHeading = await page.getByTestId('triage-merchant-heading').innerText();
  await expect(page.getByTestId('triage-open-detail')).toBeVisible();
  await page.getByTestId('triage-skip').click();
  await expect(inbox).toHaveAttribute('data-remaining', String(before));
  await expect(page.getByTestId('triage-merchant-heading')).not.toHaveText(firstHeading);
});

test('categorization accuracy card shows a measured value (DECISIONS #37)', async ({ page }) => {
  await signInToTriage(page);
  const card = page.getByTestId('accuracy-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Categorization accuracy');
  // seeded known-merchant labels guarantee a measured percentage (n > 0)
  await expect(page.getByTestId('accuracy-value')).toContainText('%');
});

// ── DRAINS THE QUEUE — must stay LAST in this serial file (see the contract above).
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

// "Accept all confident" is INERT on the golden demo (DECISIONS #162): every one
// of the seed's review groups is genuinely ambiguous (Zelle payees, checks, an
// estimated Store Card) → 0 confident groups → the bulk-accept banner must NOT
// render, so the golden dataset is byte-identical and nothing can be mass-filed
// without a per-group suggestion. Read-only: this asserts absence + normal render
// (no writes → immune to the #16 action-apply stall). The ACTIVE drain/mint/undo
// path is locked by the deterministic engine+action tests in
// tests/unit/accept-all-confident.test.ts (adding confident rows to the seed
// would move the very golden it must hold — the #160/#123 precedent).
