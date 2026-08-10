/**
 * C.23 guided half (DECISIONS #431) — the Fixed-costs SETTINGS card: the app's
 * own basis, the detected proposals with the convert lever, and the reserve
 * figure with its named holding account.
 *
 * WHY A THROWAWAY USER (the O.17 fence, same as `triage-write-in.spec.ts`):
 * every anonymous visitor IS the shared demo row, so a convert or a named
 * holding account typed on /settings would leak into the next visitor's card.
 * The fence is server-side and correct; the FIXTURE moves instead — each test
 * signs up a fresh user and seeds its own transactions with better-sqlite3.
 *
 * THE FIXTURE'S THREE SERIES, and the exactness states they lock end-to-end
 * (each verified against the real union before this spec was written — the
 * same verification the unit suite locks at the engine level).
 *
 * THE DATES ARE CUT AGAINST THE E2E PIN, NOT THE WALL CLOCK — the one
 * "today" the server under test actually lives at. `next start` loads `.env`,
 * which pins `DEMO_TODAY=2026-06-10`, and `businessToday()` gives the pin
 * TOP PRECEDENCE FOR EVERY USER — throwaway e2e accounts included (DECISIONS
 * #58 precedence 1; the same pin the rest of the suite's date assertions are
 * written against — category-breakdown.spec.ts: "the compared month is May",
 * triage-write-in.spec.ts: rows around 2026-06-01). A fixture seeded relative
 * to the wall clock renders under a DIFFERENT "today" than the one it was cut
 * for: the rollup window moves, covered-vs-in-basis flips, and the lever
 * silently disappears. Measured live, not theorized: this fixture in its
 * clock-relative form computed $130.00 with AUTO in-basis on a direct engine
 * probe, while the server — living at 2026-06-10 — rendered $200.00 with
 * every status covered and no lever (fixed-composition spec's own warning:
 * "the e2e server pins DEMO_TODAY=2026-06-10 for every user").
 *
 * At the pin the current month is June and the rollup window
 * (FIXED_TYPICAL_WINDOW_MONTHS = the last three COMPLETE months) is
 * March/April/May 2026:
 *
 *  AUTO CLUB DUES — ANNUAL, $120.00, charged on the 1st of the pin's CURRENT
 *    month (June 1 2026) and one and two years before (gaps exactly 365).
 *    Category 'insurance' (taxonomy FIXED) has ZERO spend in the window —
 *    March/April/May sees no charge — so the union keeps the series at its
 *    smoothed rate: IN-BASIS, lever offered. The current month is
 *    deliberately not a complete one, so the latest charge never creates
 *    rollup mass.
 *
 *  GYM DUES — ANNUAL, $120.00, charged on the 1st of two months BEFORE the
 *    pin (April 1 2026) and one and two years before. The merchant is a
 *    STORED outflow RecurringSeries (the fixedMerchants source), so its rows
 *    classify FIXED even in the taxonomy-DISCRETIONARY 'fitness' category →
 *    the category has positive rollup mass in the window → COVERED: "already
 *    counted under Fitness", NO lever (a reserve would count the money
 *    twice).
 *
 *  INTERNET CO — MONTHLY, $80.00, charged on the 20th of the last three
 *    COMPLETE months at the pin (May 20, April 20, March 20). Category
 *    'internet' is taxonomy FIXED, so its own charges give the category
 *    rollup mass → COVERED, NO lever (also: a MONTHLY series is a bill,
 *    never convertible).
 *
 * THE CONSERVATION ASSERTION (the safety property the whole lever exists
 * for): converting AUTO CLUB must leave the headline fixed figure UNCHANGED
 * to the cent — the union row (−$10.00/mo) leaves and the reserve (+$10.00/mo)
 * enters at the SAME monthlyRateCents, by identity not coincidence.
 */
import Database from 'better-sqlite3';
import { expect, test, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';

async function signUpThrowaway(page: Page, tag: string): Promise<string> {
  const email = `e2e-fixed-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * The three series above, on the PIN's calendar — fixed by the suite's own
 * convention (hard-coded dates around 2026-06-10, like every sibling spec),
 * never the run's wall clock: the server under test computes "today" from
 * DEMO_TODAY in .env, so a clock-relative fixture and the engine can never
 * agree about which months the rollup window holds (measured: $130 intent
 * rendered as $200 — see the module docblock).
 */
function seedFixedSetupFixture(email: string): void {
  const file = E2E_DB_URL.replace(/^file:/, '');
  const db = new Database(file, { timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000 });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as
      | { id: string }
      | undefined;
    if (!user) throw new Error(`seedFixedSetupFixture: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const y = 2026; // the pin's year (DEMO_TODAY=2026-06-10)

    const checkingId = `e2e-fixed-chk-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, name, type, currentBalanceCents, currency)
       VALUES (?, ?, 'plaid', 'Everyday Checking', 'CHECKING', 500000, 'USD')`,
    ).run(checkingId, user.id);

    const insert = db.prepare(
      `INSERT INTO "Transaction"
         (id, accountId, date, amountCents, rawDescriptor, merchantId, categoryId,
          confidenceBps, needsReview, isTransfer, status)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 5000, 0, 0, 'POSTED')`,
    );

    // AUTO CLUB DUES — 1st of the pin's CURRENT month (June), then one and
    // two years back: gaps 365/365 → ANNUAL, active (9 days since last), and
    // no rollup mass in March/April/May.
    const autoDates = [`${y}-06-01`, `${y - 1}-06-01`, `${y - 2}-06-01`];
    for (const [i, d] of autoDates.entries()) {
      insert.run(`e2e-auto-${stamp}-${i}`, checkingId, d, -12000, 'AUTO CLUB DUES', 'insurance');
    }

    // GYM DUES — 1st of two months BEFORE the pin (April), then one and two
    // years back: ANNUAL, active (70 days since last), one charge (April 1)
    // inside the window. STORED as a series so its rows classify fixed via
    // fixedMerchants (the covered-state precondition).
    const gymDates = [`${y}-04-01`, `${y - 1}-04-01`, `${y - 2}-04-01`];
    for (const [i, d] of gymDates.entries()) {
      insert.run(`e2e-gym-${stamp}-${i}`, checkingId, d, -12000, 'GYM DUES', 'fitness');
    }
    // The stored series' merchant canonical must equal the engine's own
    // `normalizeMerchant('GYM DUES').canonical` — 'Gym Dues' (title case,
    // probe-verified, not assumed), because detection, the fixedMerchants set
    // and the per-row classification all agree on the NORMALIZED spelling.
    // `Merchant.canonical` is GLOBALLY unique (no userId) and the four tests
    // seed in parallel, so the fixture shares ONE row per run: INSERT OR IGNORE
    // (the unique index serializes the first writer; the others reuse it) and
    // read the winner's id back for the series row.
    db.prepare("INSERT OR IGNORE INTO Merchant (id, canonical) VALUES ('e2e-gym-dues-merchant', 'Gym Dues')").run();
    const merchant = db
      .prepare("SELECT id FROM Merchant WHERE canonical = 'Gym Dues'")
      .get() as { id: string };
    if (!merchant) throw new Error('seedFixedSetupFixture: Gym Dues merchant missing after insert');
    const merchantId = merchant.id;
    db.prepare(
      `INSERT INTO RecurringSeries
         (id, userId, merchantId, cadence, typicalAmountCents, lastAmountCents,
          lastSeenAt, isSubscription)
       VALUES (?, ?, ?, 'ANNUAL', -12000, -12000, ?, 0)`,
    ).run(`e2e-gym-series-${stamp}`, user.id, merchantId, gymDates[0]);

    // INTERNET CO — 20th of the last three COMPLETE months at the pin (May 20,
    // April 20, March 20): gaps 30/31 (inside the MONTHLY band), lastSeen 21
    // days back (inside the 45-day active gate), all three charges in the
    // window → the fixed 'internet' category has rollup mass → covered.
    const netDates = [`${y}-05-20`, `${y}-04-20`, `${y}-03-20`];
    for (const [i, d] of netDates.entries()) {
      insert.run(`e2e-net-${stamp}-${i}`, checkingId, d, -8000, 'INTERNET CO', 'internet');
    }
  } finally {
    db.close();
  }
}

test('proposals render from the detected series — one lever, exactly, where the swap is exact', async ({ page }) => {
  const email = await signUpThrowaway(page, 'proposals');
  seedFixedSetupFixture(email);
  await page.goto('/settings');

  await expect(page.getByTestId('fixed-costs-card')).toBeVisible();
  // Every counted expense series becomes a proposal — 1:1 with the loader's
  // array (the engine's totality contract, read off the real page).
  await expect(page.getByTestId('fixed-proposal-row')).toHaveCount(3);

  const autoRow = page.locator('[data-testid="fixed-proposal-row"]', { hasText: 'AUTO CLUB DUES' });
  await expect(autoRow.getByTestId('fixed-proposal-status')).toContainText('In your fixed costs');
  // In-basis + long cadence + named → the ONE lever, and only one on the page.
  await expect(autoRow.getByTestId('convert-to-reserve')).toBeVisible();
  await expect(page.getByTestId('convert-to-reserve')).toHaveCount(1);

  // Covered series are not second commitments: the money IS in the figure
  // under the category, and the row says so instead of offering a lever.
  const gymRow = page.locator('[data-testid="fixed-proposal-row"]', { hasText: 'GYM DUES' });
  await expect(gymRow.getByTestId('fixed-proposal-status')).toContainText('Already counted under Fitness');
  // The row's label is the engine's NORMALIZED canonical — 'Internet', never
  // the raw descriptor 'INTERNET CO' (the same probe-verified spelling the
  // fixture comments call out for 'Gym Dues').
  const netRow = page.locator('[data-testid="fixed-proposal-row"]', { hasText: 'Internet' });
  await expect(netRow.getByTestId('fixed-proposal-status')).toContainText('Already counted under Internet & Cable');

  // The headline is the SAME figure everywhere in the app (one authority).
  await expect(page.getByTestId('fixed-costs-total')).not.toHaveText('');
});

test('converting the in-basis bill keeps the fixed figure to the cent — the bill becomes a reserve line', async ({ page }) => {
  const email = await signUpThrowaway(page, 'convert');
  seedFixedSetupFixture(email);
  await page.goto('/settings');
  await expect(page.getByTestId('fixed-costs-card')).toBeVisible();

  const totalBefore = await page.getByTestId('fixed-costs-total').innerText();
  const proposalsBefore = await page.getByTestId('fixed-proposal-row').count();
  expect(proposalsBefore).toBe(3);

  await page.getByTestId('convert-to-reserve').click();
  // The reloaded card is the confirmation that cannot lie: the bill's basis
  // row is gone and a RESERVE line sits inside the total in its place.
  const reserveRow = page.locator('[data-testid="fixed-costs-basis-row"]', { hasText: 'AUTO CLUB DUES' });
  await expect(reserveRow.getByTestId('fixed-costs-basis-reserve-chip')).toBeVisible();

  // THE CONSERVATION ASSERTION: −union row + reserve at the same
  // monthlyRateCents = 0, to the cent, on the real page.
  await expect(page.getByTestId('fixed-costs-total')).toHaveText(totalBefore);
  // The series is demoted from detection output — the proposal is gone and
  // the figure sentence now names the set-aside.
  await expect(page.getByTestId('fixed-proposal-row')).toHaveCount(proposalsBefore - 1);
  await expect(page.getByTestId('reserves-monthly-figure')).toContainText('$10.00');
});

test('the holding account is a NAME the reader gives the money\'s home — never a transfer', async ({ page }) => {
  const email = await signUpThrowaway(page, 'holding');
  seedFixedSetupFixture(email);
  await page.goto('/settings');
  await expect(page.getByTestId('fixed-costs-card')).toBeVisible();

  await page.getByTestId('reserves-holding-account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('reserves-holding-account-save').click();
  // The reloaded sentence is the confirmation: the home is named in words,
  // and the app says "set aside in", never "moved to".
  await expect(page.getByTestId('reserves-monthly-figure')).toContainText('set aside in Everyday Checking');
});

test('deleting the converted reserve restores the fixed figure AND the lever — the full undo (critic P1-2)', async ({ page }) => {
  const email = await signUpThrowaway(page, 'delete');
  seedFixedSetupFixture(email);
  await page.goto('/settings');
  await expect(page.getByTestId('fixed-costs-card')).toBeVisible();

  const totalBefore = await page.getByTestId('fixed-costs-total').innerText();
  const proposalsBefore = await page.getByTestId('fixed-proposal-row').count();
  expect(proposalsBefore).toBe(3);

  await page.getByTestId('convert-to-reserve').click();
  await expect(page.locator('[data-testid="fixed-costs-basis-row"]', { hasText: 'AUTO CLUB DUES' }).getByTestId('fixed-costs-basis-reserve-chip')).toBeVisible();

  // The delete lives on the plan page beside the reserves section it feeds;
  // returning here re-renders the settings card fresh (dynamic page).
  await page.goto('/spending-plan');
  const reserveRow = page.locator('[data-testid="reserve-row"]', { hasText: 'AUTO CLUB DUES' });
  await reserveRow.getByTestId('reserve-delete').click();
  await reserveRow.getByTestId('reserve-delete-confirm').click();
  // The delete reloads the page; the row being GONE is the confirmation the
  // commit landed. Waiting on a section that already exists on the PRE-reload
  // DOM passes immediately, and the next navigation then aborts the reload in
  // flight (net::ERR_ABORTED — seen twice on a loaded runner).
  await expect(
    page.locator('[data-testid="reserve-row"]', { hasText: 'AUTO CLUB DUES' }),
  ).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('reserves-section')).toBeVisible();

  // THE FULL UNDO (critic P1-2): the delete withdraws the paired NOT_BILL in
  // the same transaction, so detection re-arms and the union row returns. The
  // old test certified only "nothing set aside" — HALF the undo — while the
  // money sat out of the fixed figure with no way back but a re-typed
  // instruction. The whole pair unwinds at once:
  await page.goto('/settings');
  await expect(page.getByTestId('reserves-monthly-figure')).toContainText('Nothing is set aside to reserves yet');
  // The fixed figure is back to the pre-convert total, to the cent.
  await expect(page.getByTestId('fixed-costs-total')).toHaveText(totalBefore);
  // The reserve line is gone from the basis and the bill is a unioned
  // repeating bill again — the chip proves the KIND, not just the label.
  const autoBasisRow = page.locator('[data-testid="fixed-costs-basis-row"]', { hasText: 'AUTO CLUB DUES' });
  await expect(autoBasisRow.getByTestId('fixed-costs-basis-reserve-chip')).toHaveCount(0);
  await expect(autoBasisRow.getByTestId('fixed-costs-basis-bill-chip')).toBeVisible();
  // The proposal row is back WITH its lever — a fresh conversion is on the
  // table, so the undo is not a one-way door.
  await expect(page.getByTestId('fixed-proposal-row')).toHaveCount(proposalsBefore);
  const autoRow = page.locator('[data-testid="fixed-proposal-row"]', { hasText: 'AUTO CLUB DUES' });
  await expect(autoRow.getByTestId('fixed-proposal-status')).toContainText('In your fixed costs');
  await expect(autoRow.getByTestId('convert-to-reserve')).toBeVisible();
});

test('the shared demo sees the card without the write controls (O.17 fence)', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await page.goto('/settings');

  // The card renders for the demo (reads are fine)…
  await expect(page.getByTestId('fixed-costs-card')).toBeVisible();
  // …but the lever and the picker are absent, and the honest note explains
  // why — the same fence every reserve write applies server-side.
  await expect(page.getByTestId('convert-to-reserve')).toHaveCount(0);
  await expect(page.getByTestId('reserves-holding-account')).toHaveCount(0);
  await expect(page.getByTestId('reserves-demo-note')).toBeVisible();
});
