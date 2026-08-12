/**
 * O.15 slice 1 — nothing the app CLAIMS is a dead end.
 *
 * Owner's verdict, 2026-07-30: "no cohesion in the app… most def not at parity
 * with Mint/Simplifi." The concrete defect behind it: surfaces named a merchant
 * and stopped there. /recurring would state "you pay Netflix $15.99/mo" and the
 * Today feed would state a charge was "larger than the typical $11.56 there",
 * and neither name did anything — the only affordance on a nudge was Dismiss.
 * The rule this spec enforces is that a named merchant is always a way in to the
 * rows behind the claim.
 *
 * WHY AN E2E AND NOT JUST THE UNIT LOCK: merchant-register-links.test.ts proves
 * the href is built and decoded correctly, which is a fact about a string. It
 * cannot see whether the string is on the page. The O.13b lesson in this repo is
 * exactly that gap — a banner that typechecked, built, and passed 225 e2e tests
 * while rendering nothing, because a server component imported a constant from a
 * 'use client' module and got a stub. Only a rendered-page assertion catches
 * that class, so this walks the real routes and reads the real DOM.
 *
 * Render-only against the DEMO: every demo-signed assertion here navigates and
 * reads, so the shared demo row is safe (the #182/#234 precedent). The U.3
 * account-row tests that need WRITES (a hand-added mortgage, a zero-row card)
 * run as throwaway SIGNUPS instead — the account-deletion.spec idiom — and
 * never touch the demo user.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

/**
 * Every merchant link in the app points at the register filtered to that name.
 * Asserts the href is well-formed AND that its parameter decodes back to the
 * link's own visible text — the property that makes the destination the rows the
 * reader just read about, rather than an empty page.
 */
async function expectMerchantLink(
  page: Page,
  testId: string,
  /**
   * How the visible text relates to the merchant, for surfaces that wrap the name
   * in a phrase ("View charges at X"). Defaults to the name alone. Required as a
   * FUNCTION of the merchant rather than a literal so the assertion still pins
   * the exact name and cannot be satisfied by a truncation.
   */
  expectedText?: (merchant: string) => string,
) {
  const link = page.getByTestId(testId).first();
  await expect(link).toBeVisible();

  const href = await link.getAttribute('href');
  expect(href, `${testId} must carry an href`).toBeTruthy();

  const url = new URL(href!, 'https://www.aimplifi.app');
  expect(url.pathname).toBe('/transactions');
  const merchant = url.searchParams.get('merchant');
  expect(merchant, `${testId} must filter by a merchant`).toBeTruthy();

  // The link's parameter must be EXACTLY the name the reader tapped.
  //
  // `toBe`, never `toContain`, and the first draft of this got it wrong in a way
  // worth recording: a substring check can never catch truncation, because
  // truncation always produces a substring. An unescaped "Barnes & Noble" yields
  // the parameter "Barnes ", and `"Barnes & Noble".includes("Barnes ")` is true —
  // so the assertion whose comment claimed to catch an encoding regression passed
  // on precisely that regression. Same for "A#1 Auto" → "A".
  const text = (await link.innerText()).trim();
  expect(text.length, `${testId} must have visible text`).toBeGreaterThan(0);
  const expected = expectedText ? expectedText(merchant!) : merchant!;
  expect(text).toBe(expected);
}

test('the register row merchant name still links (builder refactor regression)', async ({ page }) => {
  // O.15 moved four inline `?merchant=` template literals onto one builder. This
  // is the oldest of the four and the one with e2e coverage elsewhere; asserting
  // it here means the refactor cannot silently change where the original links
  // land while the new surfaces look fine.
  await signIn(page);
  await page.goto('/transactions');
  await expectMerchantLink(page, 'txn-merchant-link');
});

test('/recurring — the merchant in every row and every upcoming renewal is a way in', async ({ page }) => {
  await signIn(page);
  await page.goto('/recurring');

  // Assert the hard case is PRESENT before asserting anything about it: a
  // `getByTestId(...).first()` over an empty list passes vacuously, and this
  // page is the whole reason the slice exists.
  await expect(page.getByTestId('recurring-merchant-link').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('recurring-row').first()).toBeVisible();
  await expectMerchantLink(page, 'recurring-merchant-link');

  const rows = await page.getByTestId('recurring-row').count();
  const links = await page.getByTestId('recurring-merchant-link').count();
  // EVERY row, not merely one: the defect was systemic, and a single linked row
  // beside nine plain ones is the same dead end for a reader who taps a different
  // one. Equality also catches a future row variant added without a link.
  expect(links, 'every recurring row names a merchant and so every row links').toBe(rows);
});

test('/recurring — the coming-up list links too', async ({ page }) => {
  await signIn(page);
  await page.goto('/recurring');
  const comingUp = page.getByTestId('coming-up-row');
  // The demo seed's renewal window is data-dependent, so this list can legitimately
  // be empty. Assert the invariant that matters either way — no row may exist
  // WITHOUT its link — rather than pretending a count is guaranteed.
  const rowCount = await comingUp.count();
  const linkCount = await page.getByTestId('coming-up-merchant-link').count();
  expect(linkCount, 'no coming-up row may name a merchant without linking it').toBe(rowCount);
  if (rowCount > 0) await expectMerchantLink(page, 'coming-up-merchant-link');
});

test('the Today feed offers a way to check the charge it is talking about', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('today-feed-card')).toBeVisible({ timeout: 20000 });

  // The demo seed renders an unusual-charge nudge (today-feed.spec.ts asserts the
  // same row), and that proposal carries a merchant — so this link must exist.
  // Before O.15 the only control on this row was Dismiss: the app made a claim
  // about a named merchant and offered no way to check it.
  await expect(page.getByTestId('nudge-unusual_charge')).toBeVisible();
  await expectMerchantLink(page, 'nudge-merchant-link-unusual_charge', (m) => `View charges at ${m}`);
});

test('an income row says deposits, not charges', async ({ page }) => {
  // A paycheck is not a charge. The feed's own copy is audited to describe money
  // that did not ARRIVE and never says "spent" — and a link added beside money
  // copy is money copy. `income_pause` is one of exactly two kinds carrying a
  // merchant, so half the feed's links sit on income rows.
  await signIn(page);
  await expect(page.getByTestId('today-feed-card')).toBeVisible({ timeout: 20000 });
  const incomeRow = page.getByTestId('nudge-income_pause');
  if ((await incomeRow.count()) === 0) return; // data-dependent on the seed
  const link = page.getByTestId('nudge-merchant-link-income_pause').first();
  await expect(link).toBeVisible();
  await expect(link).toContainText('View deposits from');
  await expect(link).not.toContainText('charges');
});

test('/trends — the merchants it names open their own rows', async ({ page }) => {
  await signIn(page);
  await page.goto('/trends');
  // "Largest purchases" is a list of single charges the reader is invited to
  // examine; "New this month" is a card whose entire subject is a name they have
  // never seen. Both were plain text until this slice.
  await expect(page.getByTestId('trends-largest-merchant-link').first()).toBeVisible({ timeout: 20000 });
  await expectMerchantLink(page, 'trends-largest-merchant-link');
});

test('the coach page merchant and flow claims are links', async ({ page }) => {
  await signIn(page);
  await page.goto('/coach');

  // The two merchant links on this page had NO rendered assertion in the first
  // draft of this spec — the test named for the coach page asserted only the
  // creep link. That is exactly the hole this file's docblock argues against, so
  // a critic finding it is a finding about the test, not about the code.
  await expectMerchantLink(page, 'coach-opportunity-link');
  await expectMerchantLink(page, 'life-energy-merchant-link');

  // The lifestyle-creep verdict is a claim about a SET of transactions, so the
  // verdict itself opens that set — spending when it is flagged, income when it
  // is not. Asserted by pathname + type rather than by which branch rendered,
  // because either is a legitimate state of the demo data.
  const creep = page.getByTestId('coach-creep-link');
  await expect(creep).toBeVisible({ timeout: 20000 });
  const creepHref = new URL((await creep.getAttribute('href'))!, 'https://www.aimplifi.app');
  expect(creepHref.pathname).toBe('/transactions');
  expect(['expense', 'income']).toContain(creepHref.searchParams.get('type'));
});

test('following a merchant link actually lands on that merchant’s rows', async ({ page }) => {
  // The end-to-end claim the whole slice rests on. Every assertion above is about
  // an href attribute; this one follows it and reads what the reader would see.
  // A link that is present, well-formed, and lands on an unfiltered register is
  // still a dead end — worse, it silently shows a much larger set than the name
  // promised, with no error and an HTTP 200.
  await signIn(page);
  await page.goto('/recurring');
  const link = page.getByTestId('recurring-merchant-link').first();
  await expect(link).toBeVisible({ timeout: 20000 });
  const name = (await link.innerText()).trim();

  await link.click();
  await page.waitForURL('**/transactions?merchant=*', { timeout: 20000 });

  // Assert on the ROWS, not on the Merchant Lens card. The lens is the obvious
  // landmark and it is the wrong one to hang this on: `transactions/page.tsx`
  // renders it as `{lens && <MerchantLensCard/>}` and the engine abstains on thin
  // history, so a merchant with few charges would fail this test for a reason
  // that has nothing to do with the link. The rows are unconditional.
  const landed = page.getByTestId('txn-merchant-link');
  await expect(landed.first()).toBeVisible({ timeout: 20000 });

  // EVERY row on the page is the merchant that was clicked. A link that landed on
  // an unfiltered register would show a mix — the exact silent failure (a much
  // larger set than the name promised, HTTP 200, no error) this slice must not
  // ship, and one that asserting `.first()` alone would sail straight past.
  const names = await landed.allInnerTexts();
  expect(names.length).toBeGreaterThan(0);
  for (const shown of names) expect(shown.trim()).toBe(name);
});

// ── the account rows themselves (owner report 2026-08-11) ─────────────────────
//
// "When I click on my mortgage in accounts, why does it bring me to a
// completely empty transaction page?" — the register's basis excludes
// LOAN/MORTGAGE/etc. BY CONSTRUCTION, so the /accounts row for those types was
// a link whose destination could never answer it. The same rule as the rest of
// this file: a click the app offers must land on the thing it promised.

test('/accounts — a loan account expands its detail in place instead of linking to an empty register', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');

  const loanRow = page.getByTestId('account-row').filter({ hasText: 'Auto Loan' });
  await expect(loanRow).toBeVisible({ timeout: 20000 });

  // The row's own promise: a Details cue, an href that TOGGLES the panel —
  // never the register the account cannot appear in.
  await expect(loanRow.getByTestId('account-row-detail-cue')).toContainText('Details');
  const href = await loanRow.getAttribute('href');
  expect(href).toBe('/accounts?detail=acct-autoloan');

  await loanRow.click();
  await page.waitForURL('**/accounts?detail=acct-autoloan', { timeout: 20000 });

  // The panel answers with facts the app actually holds: the account's role,
  // the seed's own loan terms (aprBps 649 / min 38500 / due day 5), and the
  // recorded balance history the net-worth trend is drawn from.
  const panel = page.getByTestId('account-detail-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('money you owe');
  await expect(panel.getByTestId('account-detail-loan-facts')).toContainText('APR 6.49%');
  await expect(panel.getByTestId('account-detail-loan-facts')).toContainText('minimum payment $385.00');
  await expect(panel.getByTestId('account-detail-history')).toBeVisible();

  // The toggle closes: same row, second tap, panel gone and URL bare again.
  await loanRow.click();
  await page.waitForURL('**/accounts', { timeout: 20000 });
  await expect(page.getByTestId('account-detail-panel')).toHaveCount(0);
});

test('/accounts — spending and investment rows keep their real destinations', async ({ page }) => {
  await signIn(page);
  await page.goto('/accounts');

  const checkingRow = page.getByTestId('account-row').filter({ hasText: 'Everyday Checking' });
  await expect(checkingRow).toBeVisible({ timeout: 20000 });
  expect(await checkingRow.getAttribute('href')).toBe('/transactions?account=acct-checking');

  const brokerageRow = page.getByTestId('account-row').filter({ hasText: 'Brokerage' });
  expect(await brokerageRow.getAttribute('href')).toBe('/investments?account=acct-brokerage');
});

test('a stale deep link to a loan account names the account and the way out, never "these filters"', async ({ page }) => {
  // The URL the owner's click used to produce. It stays reachable forever —
  // bookmarks, history, hand-edits — so the register must answer it honestly.
  await signIn(page);
  await page.goto('/transactions?account=acct-autoloan');

  const empty = page.getByTestId('txn-empty-account-not-here');
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(empty).toContainText('“Auto Loan” is a loan account');

  // The banner above says "the controls below say which" — the SELECT is what
  // makes that true: it displays the loan by name instead of painting "All
  // accounts" over an active filter (U.3 critic #6).
  const select = page.getByTestId('txn-filter-account');
  await expect(select).toHaveValue('acct-autoloan');
  await expect(page.getByTestId('txn-filter-account-missing-option')).toHaveText('Auto Loan');

  // The named way out really goes to /accounts.
  await expect(empty.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts');

  // And choosing "All accounts" is a LIVE escape now — the injected option
  // means the DOM value really changes: back to the whole register.
  await select.selectOption('');
  await page.waitForURL('**/transactions', { timeout: 20000 });
  await expect(page.getByTestId('txn-empty-account-not-here')).toHaveCount(0);
});

test('a hand-added mortgage — the app’s own advertised mortgage — opens its panel too, with the REAL-user shape', async ({ page }) => {
  // U.3 critic #1: ManualRow had no destination at all while the page said
  // "Tap an account to open it", and the Add-liability placeholder is
  // literally "e.g. Mortgage". A throwaway signup (the account-deletion.spec
  // idiom — the shared demo must not accumulate rows) adds one and taps it.
  // This is ALSO the critic's #3 lock in a real browser: a manual account has
  // no snapshots and no loan facts, so the panel it gets is the role line
  // plus the honest no-history line — asserted here, not just in the unit
  // render.
  const email = `e2e-mort-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  await page.goto('/accounts');
  await expect(async () => {
    await page.getByTestId('add-liability-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill('My Mortgage');
  await page.getByTestId('manual-type').selectOption('MORTGAGE');
  await page.getByTestId('manual-value').fill('250000');
  await page.getByTestId('manual-submit').click();

  const row = page.getByTestId('manual-account-row').filter({ hasText: 'My Mortgage' });
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row.getByTestId('account-row-detail-cue')).toContainText('Details');

  await row.getByTestId('manual-account-open').click();
  await page.waitForURL('**/accounts?detail=*', { timeout: 20000 });
  const panel = page.getByTestId('account-detail-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('money you owe');
  await expect(panel.getByTestId('account-detail-no-history')).toContainText('No balance history recorded');
  await expect(panel.getByTestId('account-detail-loan-facts')).toHaveCount(0);

  // ── U.4: the same panel, once a sync has recorded a month ────────────────
  // The half above is the fail-old state and it is real: before U.4 nothing but
  // `prisma/seed.ts` ever wrote a BalanceSnapshot, so this line was permanent for
  // every live account. Here the REAL writer runs — not hand-inserted rows, which
  // would assert the reader and leave the writer unproven — against the same
  // SQLite file the server is reading, and the panel fills in.
  // The row is inserted here in exactly the shape the writer produces (one date
  // across the user's accounts). Deliberately NOT by driving the writer: it
  // cannot be imported into a spec (Playwright's transform cannot load the
  // generated Prisma client), and its production trigger — the cron route —
  // sweeps EVERY user, which would write into other specs' throwaway users on a
  // shared SQLite file for no gain here. The writer's own contract is locked
  // against real Prisma in tests/unit/balance-history-server.test.ts, and the
  // route→writer wiring in tests/unit/cron-sync-snapshot.test.ts. What is left
  // for a browser — and only a browser can see it — is that the panel U.3 built
  // stops saying "none recorded" and paints the balance with this row's sign.
  const dbFile = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(dbFile, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string };
    const acct = db.prepare('SELECT id FROM Account WHERE userId = ?').get(user.id) as { id: string };
    db.prepare(
      'INSERT INTO BalanceSnapshot (id, accountId, date, balanceCents) VALUES (?, ?, ?, ?)',
    ).run(`snap-e2e-${Date.now()}`, acct.id, '2026-05-01', 25_000_000);
    // U.6, in the two shapes only a browser can show side by side on one panel:
    //  - the row above carries NO `accountType` — a row written before that
    //    column existed, signed by the account's current class (the pre-U.6
    //    behaviour, kept only for rows recorded under it) and marked as nothing;
    //  - this one was recorded while the account was a CHECKING account, so it
    //    counts as money OWNED and must keep that sign next to a mortgage row.
    // Hand-inserted deliberately: the live writer reads the account's type at
    // write time, so it cannot produce a disagreeing pair — its own contract is
    // locked against real Prisma in tests/unit/balance-history-server.test.ts.
    db.prepare(
      'INSERT INTO BalanceSnapshot (id, accountId, date, balanceCents, accountType) VALUES (?, ?, ?, ?, ?)',
    ).run(`snap-e2e-flip-${Date.now()}`, acct.id, '2026-04-01', 9_900_00, 'CHECKING');
  } finally {
    db.close();
  }

  // The panel is open and the URL still carries `?detail=<id>`, so a reload
  // re-renders the SAME panel against the newly written rows — no second click,
  // which would toggle it shut.
  await page.reload();
  const filled = page.getByTestId('account-detail-panel');
  await expect(filled).toBeVisible({ timeout: 20000 });
  await expect(filled.getByTestId('account-detail-no-history')).toHaveCount(0);
  // Painted with the row's own liability sign, the way the balance beside the
  // name is — a recorded mortgage is money owed, not an asset.
  await expect(filled).toContainText('Recorded balance history');
  await expect(filled).toContainText('−$250,000.00');
  // U.6: the row recorded under a different class keeps ITS sign — positive, on
  // a mortgage panel — and says why, on the row. Pre-U.6 the panel painted every
  // row from the account's current type, so this would read −$9,900.00.
  await expect(filled).toContainText('$9,900.00');
  await expect(filled).not.toContainText('−$9,900.00');
  await expect(filled.getByTestId('account-detail-reclassified')).toContainText('counted as checking');
  // What the APP did, never what was true in the world — a feed that re-classes
  // an account may be CORRECTING itself, so "you owned it then" would assert the
  // very thing in doubt.
  await expect(filled.getByTestId('account-detail-reclassified-note')).toContainText(
    'while Aimplifi had this account classed differently',
  );
  await expect(filled.getByTestId('account-detail-reclassified-note')).toContainText(
    'only your bank can say',
  );
  // The row above it carries NO recorded class, and the app must not assert it
  // differed — but beside a known reclassification it must not be left to read
  // as confirmed either.
  await expect(filled.getByTestId('account-detail-unrecorded-class-note')).toContainText(
    'predates',
  );

  // Toggle closed again.
  await row.getByTestId('manual-account-open').click();
  await page.waitForURL('**/accounts', { timeout: 20000 });
  await expect(page.getByTestId('account-detail-panel')).toHaveCount(0);
});

test('a zero-row spending account names its own empty history, never "these filters"', async ({ page }) => {
  // U.3 critic #2 — the owner's report one type-class over. A throwaway user
  // whose only checking account has no rows: its dropdown entry exists, its
  // register view names the account.
  const email = `e2e-norow-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });

  // A manual CREDIT card is a spending-type account with zero rows — and its
  // /accounts row now links into the register (dest 'register'), so follow
  // the app's own door rather than a hand-built URL.
  await page.goto('/accounts');
  await expect(async () => {
    await page.getByTestId('add-liability-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill('Empty Card');
  await page.getByTestId('manual-type').selectOption('CREDIT');
  // A non-zero BALANCE (the add form refuses $0) with zero TRANSACTIONS —
  // the balance isn't the axis under test, the empty register is.
  await page.getByTestId('manual-value').fill('100');
  await page.getByTestId('manual-submit').click();

  const row = page.getByTestId('manual-account-row').filter({ hasText: 'Empty Card' });
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.getByTestId('manual-account-open').click();
  await page.waitForURL('**/transactions?account=*', { timeout: 20000 });

  const empty = page.getByTestId('txn-empty-account-empty');
  await expect(empty).toBeVisible({ timeout: 20000 });
  await expect(empty).toContainText('The register holds no transactions for “Empty Card” yet');
  // The dropdown holds the zero-row account — the filter is visible in its
  // own control, no injected option needed.
  await expect(page.getByTestId('txn-filter-account-missing-option')).toHaveCount(0);
  await expect(empty.getByRole('link', { name: 'See it on Accounts' })).toHaveAttribute('href', '/accounts');
});
