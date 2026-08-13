/**
 * U.16 — the released handover day is disclosed on the screen a reader opens to
 * AUDIT a figure, in a real browser.
 *
 * The shape being seeded is the one U.13 (DECISIONS #454) deliberately created:
 * a retired feed and the live one that continued it BOTH keep the single day the
 * handover happened inside, because a handover is an instant within a day and a
 * business date here carries no time. Releasing that day is the measured right
 * answer — either whole-day award silently lost real money — and its price is a
 * visible duplicate.
 *
 * Before this slice, that price was not visible at all. The glass-box panel
 * listed both copies of one charge and printed "matched to the penny" beneath
 * them, which does not read as "the arithmetic is consistent"; it reads as
 * confirmation that both belong. This spec proves the cure end to end on a real
 * page: both rows still listed and still counted (never silently dropped —
 * that would invert the failure direction this engine chose), each marked, and
 * the sentence that explains them present.
 *
 * Seeding is direct-to-SQLite on the off-tree e2e DB, mirroring
 * `combined-accounts.spec.ts`, and the reconciliation is inserted already
 * confirmed for the reason that spec gives: the detector proposes one pair at a
 * time, so the post-confirm state is the only way to reach this shape directly.
 */
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

/**
 * The app's own "today", resolved the way `businessToday` resolves it — and it
 * has to be resolved rather than assumed, which cost this spec a red run worth
 * recording: the first draft read `process.env.DEMO_TODAY ?? new Date()`, and
 * the SERVER had `DEMO_TODAY=2026-06-10` from `.env` while the Playwright
 * process did not. So the fixture seeded August rows into a June window and
 * /reports honestly answered "$0.00". The page's own snapshot said "Jun" in the
 * trace Playwright had already written to disk (`the-evidence-was-in-the-trace`).
 *
 * Precedence, matching the server: the process env first (CI sets it for the
 * whole workflow), then `.env` (what a local `next start` picks up), then the
 * real clock. A hard-coded date would be a future or ancient month depending on
 * where the suite ran, and /reports counts THIS month.
 */
function resolveBusinessToday(): string {
  if (process.env.DEMO_TODAY) return process.env.DEMO_TODAY;
  try {
    const env = readFileSync(resolvePath(process.cwd(), '.env'), 'utf8');
    const hit = /^DEMO_TODAY=(\d{4}-\d{2}-\d{2})\s*$/m.exec(env);
    if (hit) return hit[1];
  } catch {
    // No .env in this environment — fall through to the clock, as the app does.
  }
  return new Date().toISOString().slice(0, 10);
}

const TODAY = resolveBusinessToday();
const MONTH_START = `${TODAY.slice(0, 7)}-01`;

async function signUpThrowaway(page: Page): Promise<string> {
  const email = `e2e-handover-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * One retired SimpleFIN card combined into the live Plaid card that replaced it,
 * where BOTH feeds reported the same $50.00 grocery charge on the handover day.
 *
 * The dates are chosen so the boundary actually releases the day rather than
 * de-duplicating it, which is the whole point of the fixture:
 *   - the predecessor's claim is `[first row, min(cutover, last row))` — half-open
 *     at both ends since U.13;
 *   - here first = MONTH_START and cutover = last row = TODAY, so the claim is
 *     `[MONTH_START, TODAY)` and TODAY sits OUTSIDE it;
 *   - so the successor's TODAY row survives, the predecessor keeps its own
 *     (`date <= cutover`), and one real charge is counted twice on that date.
 * The earlier MONTH_START pair is the control: it is strictly inside the claim,
 * so the successor's copy of it is dropped and only one row remains.
 */
function seedHandoverDayDuplicate(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedHandoverDayDuplicate: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const pred = `e2e-ho-pred-${suffix}`;
    const succ = `e2e-ho-succ-${suffix}`;
    const itemId = `e2e-ho-item-${suffix}`;

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'Everyday Card', 'CREDIT', NULL, -120000, 'USD')`,
    ).run(pred, uid, `sf-ho-${suffix}`);
    db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
      `e2e-ho-item-row-${suffix}`,
      uid,
      itemId,
    );
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Everyday Card', 'CREDIT', '4417', -140000, 'USD')`,
    ).run(succ, uid, `pl-ho-${suffix}`, itemId);

    db.prepare(
      `INSERT INTO AccountReconciliation
         (id, userId, predecessorAccountId, successorAccountId, cutoverDate, matchSignal, confidence, confirmedByUserAt)
       VALUES (?, ?, ?, ?, ?, 'name', 'high', CURRENT_TIMESTAMP)`,
    ).run(`e2e-ho-link-${suffix}`, uid, pred, succ, TODAY);

    const insTxn = db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, 'groceries', 'POSTED', 0, 0)`,
    );
    // The control pair, strictly inside the claim: only the predecessor's copy survives.
    insTxn.run(`e2e-ho-p1-${suffix}`, pred, MONTH_START, -3000, 'KROGER EARLY');
    insTxn.run(`e2e-ho-s1-${suffix}`, succ, MONTH_START, -3000, 'KROGER EARLY');
    // The handover day itself: BOTH survive — one real charge, counted twice.
    insTxn.run(`e2e-ho-p2-${suffix}`, pred, TODAY, -5000, 'KROGER HANDOVER');
    insTxn.run(`e2e-ho-s2-${suffix}`, succ, TODAY, -5000, 'KROGER HANDOVER');
  } finally {
    db.close();
  }
}

test('the glass-box panel marks the handover-day rows and explains the double it is certifying', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedHandoverDayDuplicate(email);

  await page.goto('/reports');
  const toggle = page.getByTestId('reports-breakdown-toggle-groceries');
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();

  const panel = page.getByTestId('reports-breakdown-panel-groceries');
  await expect(panel).toBeVisible();

  // THE SHAPE: three rows, not four — the control pair de-duplicated to one,
  // and the handover day kept BOTH. If this reads 4, the boundary stopped
  // de-duplicating; if it reads 2, it started silently dropping a real row,
  // which is the failure direction U.13 measured and rejected.
  await expect(panel.getByTestId('reports-breakdown-row-amount')).toHaveCount(3);

  // THE LOCK U.16 EXISTS FOR: the two identical lines are individually marked,
  // so the reader can tell WHICH rows the sentence is about. The control row on
  // the month's first day is NOT marked — a marker on every row would be a
  // different false claim.
  await expect(panel.getByTestId('reports-breakdown-handover-row')).toHaveCount(2);

  // ...and the sentence is present, in the engine's words.
  await expect(panel).toContainText('2 rows here fall on a day one of your combined accounts was changing connections');
  await expect(panel).toContainText('once for each');

  // The penny-match still prints — the disclosure explains it rather than
  // suppressing it, because the figure really is the sum of the rows shown.
  await expect(page.getByTestId('reports-breakdown-reconciled-groceries')).toBeVisible();
});

test('U.19/U.20/U.22: the register, the /reports total, and the exported CSV disclose the same released day', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedHandoverDayDuplicate(email);

  // U.22 — the figure a reader reads FIRST: the /reports page total now carries
  // the answer-shaped note (no rows sit beside it, so the panel wording would be
  // false), counting the SAME two rows the panel's sentence counts.
  await page.goto('/reports');
  const totalNote = page.getByTestId('reports-handover-total');
  await expect(totalNote).toBeVisible({ timeout: 20_000 });
  await expect(totalNote).toContainText('2 transactions in this figure fall');

  // U.20 — the register is the surface where the two identical lines actually
  // sit next to each other. Both marked; the control row's single survivor not.
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('txn-handover-row')).toHaveCount(2);
  // ...and the totals caption stops sounding exhaustive while omitting the one
  // rule that counts a transaction more than once. The count is the SUMMED
  // rows (both handover rows are posted purchases here, so 2).
  await expect(page.getByTestId('txn-summary-handover')).toContainText(
    '2 rows counted in these totals fall',
  );

  // U.19 — the file that leaves the app entirely: the released rows are marked
  // in their own column and the note rides the end of the file. Fetched through
  // the page's own session, same as the download button would.
  const res = await page.request.get('/api/export?format=transactions-csv');
  expect(res.ok()).toBe(true);
  const csv = await res.text();
  const header = csv.split('\r\n')[0];
  expect(header).toBe(
    'date,account,description,merchant,category,amount,status,changeover_day,' +
      'excluded_from_totals,transfer',
  );
  // Exactly the two released rows say yes — the de-duplicated control day
  // exports one row, unmarked, and 4 yes-rows would mean the export stopped
  // de-duplicating while 1 would mean it started dropping a real row.
  // Read as the THIRD field from the end since U.26 appended two columns after
  // it: `endsWith(',yes')` would now also catch a transfer, and miss a released
  // row that is one.
  const changeoverYes = csv
    .split('\r\n')
    .filter((l) => l.length > 0 && !l.startsWith('"Note:') && l.split(',').slice(-3)[0] === 'yes');
  expect(changeoverYes).toHaveLength(2);
  expect(csv).toContain('Note: rows marked yes in changeover_day');
  expect(csv).not.toMatch(/\btwice\b/);
});

test('U.29: /budgets Fixed/guilt-free panel discloses the same released day it counts twice', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedHandoverDayDuplicate(email);

  await page.goto('/budgets');
  const panel = page.getByTestId('spend-class-panel');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  // Both handover-day rows are groceries (a Fixed-guessed category, DECISIONS
  // #397), so they land in the Fixed subtotal exactly as U.13/`keepsReconciled`
  // already counted them pre-U.29 — the marker discloses the double, it does
  // not remove it. Control pair ($30.00, de-duplicated to one) + two released
  // $50.00 copies = $130.00.
  const groceriesRow = panel.getByTestId('spend-class-row-groceries');
  await expect(groceriesRow).toBeVisible();
  await expect(groceriesRow).toContainText('$130.00 this month');

  // THE LOCK U.29 EXISTS FOR: before this slice, the panel that shows that
  // $130.00 said nothing about the two identical $50.00 lines inside it.
  const note = page.getByTestId('spend-class-handover-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('2 rows here fall on a day one of your combined accounts was changing connections');
  await expect(note).toContainText('once for each');
  // This panel has no per-transaction row list — only category subtotals —
  // so it must not claim a row-by-row tally the reader cannot see.
  await expect(note).not.toContainText('still add up to the figure above');
});

test('U.24: /calendar discloses the released day inside its money tiles, and marks which day', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedHandoverDayDuplicate(email);

  await page.goto('/calendar');
  await expect(page.getByTestId('calendar-list')).toBeVisible({ timeout: 20_000 });

  // The doubling is real and still counted: TODAY's tile shows BOTH $50.00 copies as money
  // out, exactly as the register has them. U.24 does not remove the double — the R1 keep
  // released the day deliberately — it ends the silence around it.
  const dayTile = page.getByTestId('calendar-list').locator('li', { hasText: 'today' }).first();
  await expect(dayTile).toContainText('$100.00');

  // THE LOCK: before this slice the page had no handover vocabulary at all — `PostedTxnLike`
  // carried no flag, so `summarizeTransactions` read its optional-field default of 0 and the
  // month sentence could not exist. Neither testid was in the DOM.
  const note = page.getByTestId('cal-handover-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('2 transactions behind these amounts fall on a day one of your combined accounts was changing connections');
  await expect(note).toContainText('these amounts count it once for each');

  // This surface lists no transaction rows (each day links OUT to Activity), and it prints
  // Money in, Money out AND a net — so the sentence must claim neither a row list nor a
  // single direction. Both would be false where this reader is standing.
  await expect(note).not.toContainText('rows here fall');
  await expect(note).not.toContainText('is listed and counted');
  await expect(note).not.toContainText('too LOW');

  // The note qualifies the POSTED totals, so it must sit above the projected "Expected" line —
  // "these amounts" is a positional claim, and the projected figures contain no released row.
  // Asserted by DOM order rather than by eye (critic F-2: the first draft rendered below it).
  const summary = page.getByTestId('cal-summary');
  await expect(summary.getByTestId('cal-handover-note')).toBeVisible();
  const order = await summary.evaluate((el) =>
    Array.from(el.querySelectorAll('[data-testid]')).map((n) => n.getAttribute('data-testid')),
  );
  expect(order.indexOf('cal-posted-line')).toBeLessThan(order.indexOf('cal-handover-note'));
  if (order.includes('cal-scheduled-line')) {
    expect(order.indexOf('cal-handover-note')).toBeLessThan(order.indexOf('cal-scheduled-line'));
  }

  // ...and the reader is told WHICH day, rather than being handed a count and a month to scan.
  const marker = dayTile.getByTestId('cal-posted-handover-day');
  await expect(marker).toBeVisible();
  // Its TEXT, not just its presence (critic F-1 hid from the first draft of this spec, which
  // asserted visibility alone): the marker states the KEEP, which is unconditionally true, and
  // never the double, which is not knowable from the dates — a released day on which only one
  // connection reported anything is marked too.
  await expect(marker).toContainText('both connections’ records are kept for this day');
  await expect(marker).not.toContainText('counted on both');
  // The control pair's day ($30.00, de-duplicated to the predecessor's single copy) is a
  // normal day and carries no marker — the flag is per (account, day), not per month.
  await expect(page.getByTestId('cal-posted-handover-day')).toHaveCount(1);
});

/**
 * A released handover day whose only duplicated rows are TRANSFERS — money moves no tile
 * (transfers leave every total), so `countedOnHandoverDays` stays 0 and the money-scoped
 * `cal-handover-note` month sentence correctly says nothing. Before U.32 the per-day marker
 * was gated on that same money-scoped count, so this exact shape — a doubled row COUNT with
 * zero changeover vocabulary anywhere on the page — was the defect.
 */
function seedHandoverDayTransferOnly(email: string) {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedHandoverDayTransferOnly: user ${email} not found`);
    const uid = user.id;
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const pred = `e2e-hot-pred-${suffix}`;
    const succ = `e2e-hot-succ-${suffix}`;
    const itemId = `e2e-hot-item-${suffix}`;

    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'simplefin', ?, 'Savings', 'SAVINGS', NULL, 800000, 'USD')`,
    ).run(pred, uid, `sf-hot-${suffix}`);
    db.prepare(`INSERT INTO PlaidItem (id, userId, itemId, accessToken) VALUES (?, ?, ?, 'ct-e2e')`).run(
      `e2e-hot-item-row-${suffix}`,
      uid,
      itemId,
    );
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, plaidItemId, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, ?, 'Savings', 'SAVINGS', '9911', 810000, 'USD')`,
    ).run(succ, uid, `pl-hot-${suffix}`, itemId);

    db.prepare(
      `INSERT INTO AccountReconciliation
         (id, userId, predecessorAccountId, successorAccountId, cutoverDate, matchSignal, confidence, confirmedByUserAt)
       VALUES (?, ?, ?, ?, ?, 'name', 'high', CURRENT_TIMESTAMP)`,
    ).run(`e2e-hot-link-${suffix}`, uid, pred, succ, TODAY);

    // A transfer both connections reported on the released day — real, released, but moves
    // NO tile (transfers leave every money figure) and money-scoped counts stay 0.
    db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, 'transfer', 'POSTED', 1, 0)`,
    ).run(`e2e-hot-p-${suffix}`, pred, TODAY, -20_000, 'TRANSFER TO CHECKING');
    db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, 'transfer', 'POSTED', 1, 0)`,
    ).run(`e2e-hot-s-${suffix}`, succ, TODAY, -20_000, 'TRANSFER TO CHECKING');
  } finally {
    db.close();
  }
}

test('U.32: a released day whose only duplicates are transfers still marks the day and the caption names the rule', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedHandoverDayTransferOnly(email);

  await page.goto('/calendar');
  await expect(page.getByTestId('calendar-list')).toBeVisible({ timeout: 20_000 });
  const dayTile = page.getByTestId('calendar-list').locator('li', { hasText: 'today' }).first();

  // Money is genuinely untouched by this day — both rows are transfers, so no tile moves and
  // `cal-posted-nonmoney` explains the resulting $0.00 net the ordinary way.
  await expect(dayTile.getByTestId('cal-posted-nonmoney')).toContainText('2 transfers between your accounts');
  // THE LOCK: before U.32 this marker was gated on the day's money-summed count, which is 0
  // for an all-transfer released day — so it stayed silent here even though the day genuinely
  // is a released handover day. It must now fire.
  await expect(dayTile.getByTestId('cal-posted-handover-day')).toBeVisible();
  await expect(dayTile.getByTestId('cal-posted-handover-day')).toContainText(
    'both connections’ records are kept for this day',
  );

  // The MONTH sentence stays money-scoped and correctly silent: no money moved, so "these
  // amounts count it once for each" would be a claim about a figure that isn't affected.
  await expect(page.getByTestId('cal-handover-note')).toHaveCount(0);

  // THE OTHER LOCK: the closing basis caption now states the rule unconditionally, the same
  // family sentence in its own voice, regardless of whether today's month happens to hold a
  // released day.
  await expect(page.getByTestId('cal-basis-handover-note')).toContainText(
    'keeps both connections’ records rather than dropping either',
  );
});

test('U.30: the dashboard Recent transactions card marks the released day rows too', async ({
  page,
}) => {
  const email = await signUpThrowaway(page);
  seedHandoverDayDuplicate(email);

  await page.goto('/dashboard');
  const list = page.getByTestId('dashboard-recent-list');
  await expect(list).toBeVisible({ timeout: 20_000 });

  // Same three-row shape /reports counts: the control pair de-duplicated to
  // one survivor, the handover day keeping both copies.
  await expect(page.getByTestId('dashboard-recent-row')).toHaveCount(3);

  // THE LOCK: before this slice, the FIRST screen a reader sees carried no
  // reconciliation vocabulary at all — not even the account name the
  // register at least has (`TxnView.onHandoverDay`'s own docblock).
  await expect(page.getByTestId('dashboard-recent-handover-row')).toHaveCount(2);
});

test('a reader with no combined accounts is told nothing about handover days', async ({ page }) => {
  // The `dataDerived` gate (C.11/#407): a disclosure that fired on the rule's
  // mere existence would nag every reader about something that never touched
  // their money. This is the control that keeps the sentence honest.
  const email = await signUpThrowaway(page);
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error('control: user not found');
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const acct = `e2e-ho-solo-${suffix}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', ?, 'Everyday Card', 'CREDIT', '4417', -120000, 'USD')`,
    ).run(acct, user.id, `pl-solo-${suffix}`);
    db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, -5000, 'KROGER', 'groceries', 'POSTED', 0, 0)`,
    ).run(`e2e-ho-solo-t-${suffix}`, acct, TODAY);
  } finally {
    db.close();
  }

  await page.goto('/reports');
  const toggle = page.getByTestId('reports-breakdown-toggle-groceries');
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();

  const panel = page.getByTestId('reports-breakdown-panel-groceries');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('reports-breakdown-handover-row')).toHaveCount(0);
  await expect(panel).not.toContainText('changing connections');
  // U.22: the page total carries no note either.
  await expect(page.getByTestId('reports-handover-total')).toHaveCount(0);

  // U.20: the register shows no marker and its caption keeps the pre-U.20 text.
  await page.goto('/transactions');
  await expect(page.getByTestId('txn-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('txn-handover-row')).toHaveCount(0);
  await expect(page.getByTestId('txn-summary-handover')).toHaveCount(0);

  // U.29: /budgets' Fixed/guilt-free panel carries no note either.
  await page.goto('/budgets');
  await expect(page.getByTestId('spend-class-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('spend-class-handover-note')).toHaveCount(0);

  // U.24: /calendar shows neither the month sentence nor any day marker. This reader has a
  // row on the very date that is a handover day for the OTHER fixture — which is the point:
  // the flag is a fact about an (account, day) pair, and this account is in no pair at all.
  await page.goto('/calendar');
  await expect(page.getByTestId('calendar-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cal-handover-note')).toHaveCount(0);
  await expect(page.getByTestId('cal-posted-handover-day')).toHaveCount(0);
  // U.32: the closing basis caption's rule clause is UNCONDITIONAL — this reader has no
  // combined accounts at all, and it still renders, exactly like every other rule the same
  // paragraph states regardless of whether it currently applies (pending charges, due badges).
  await expect(page.getByTestId('cal-basis-handover-note')).toBeVisible();

  // U.30: the dashboard's Recent transactions card shows no marker either.
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-recent-list')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('dashboard-recent-handover-row')).toHaveCount(0);

  // U.19: the column is UNCONDITIONAL (one schema for every reader) but empty,
  // and no CHANGEOVER note row is appended. This fixture's single row is neither
  // excluded nor a transfer, so U.26's two columns are empty here too — but its
  // basis note (U.25) is unconditional and rides every file, which is why the
  // assertion below names the changeover note rather than the word "Note:".
  const res = await page.request.get('/api/export?format=transactions-csv');
  expect(res.ok()).toBe(true);
  const csv = await res.text();
  expect(csv.split('\r\n')[0].endsWith(',changeover_day,excluded_from_totals,transfer')).toBe(true);
  expect(csv).not.toContain(',yes');
  expect(csv).not.toContain('changeover_day fall on a day');
  expect(csv).not.toContain('rows marked yes in excluded_from_totals');
  expect(csv).toContain('Note: this file lists transactions');
});
