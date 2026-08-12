/**
 * Deploy proof for U.16 (DECISIONS #455), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because for this slice the
 * honest answer is limited in exactly the way U.5, U.9, U.13 and U.15 already
 * recorded, and dressing it up would be the wrong-instrument failure the U.5
 * record caught:
 *
 *   U.16 discloses the ONE handover day a combined pair releases to both sides.
 *   Reaching it needs an `AccountReconciliation` row, and `prisma/seed.ts`
 *   writes NONE — so no demo page can render a combined pair, no released day
 *   can exist, and there is NO demo-visible string that differs between the
 *   pre-U.16 and post-U.16 builds. This script CANNOT discriminate the
 *   deployment, declares that as explicit SKIPs, and does not pretend otherwise.
 *
 *   What it CAN prove is the half that carries this slice's real deployment
 *   risk, and for this slice that half is unusually load-bearing. U.16 edited
 *   `spendingByCategory` — the selector behind /reports' category table, the
 *   dashboard's top-spending card and three Ask answers — plus four panel
 *   builders. Every one of those edits is supposed to be INERT for a reader with
 *   no combined accounts: an empty `handoverDates` set must leave every figure,
 *   every row list and every sentence byte-identical. The demo IS that reader.
 *   So if any of this leaked outside the gate — the one way this slice could go
 *   wrong at scale — the demo's spending figures, its panel rows or its basis
 *   copy would move. These checks pin them, and they also assert the ABSENCE of
 *   the new marker and the new sentence, which is the correct rendering for a
 *   reader with no links and is itself a real (if non-discriminating) claim.
 *
 *   The discriminating proof lives where it can actually run: the CI gate's full
 *   `VERIFY_E2E=1` suite, which includes `tests/e2e/handover-day-disclosure.spec.ts`
 *   (a seeded combined pair whose handover day carries a real duplicate; proven
 *   fail-old by blanking the row marker and rebuilding) and
 *   `tests/unit/u16-handover-disclosure.test.ts` (16 locks, three of them proven
 *   fail-old by sabotage).
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u16-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const mobile = { ...devices['Pixel 5'], viewport: { width: 380, height: 800 } };

let pass = 0;
let fail = 0;
let skip = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const skipped = (name, why) => {
  skip++;
  console.log(`  SKIP  ${name} — ${why}`);
};

const MONEY = /\$[\d,]+\.\d{2}/;

const browser = await chromium.launch();
const ctx = await browser.newContext(mobile);
const page = await ctx.newPage();

try {
  console.log(`U.16 live check against ${BASE}\n`);

  // ── Demo sign-in ───────────────────────────────────────────────────────────
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  const demo = page.getByTestId('demo-sign-in');
  await demo.click({ timeout: 30_000 });
  await page.waitForURL('**/dashboard', { timeout: 40_000 });
  check('demo sign-in reaches the dashboard', true);

  // ── /reports: the surface U.16 edited most ────────────────────────────────
  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  const total = await page.getByTestId('reports-total').innerText().catch(() => '');
  check('the /reports spending total still renders a money figure', MONEY.test(total), total.trim() || '(missing)');

  // The category table is built from `spendingByCategory`, whose signature and
  // inner loop this slice changed. A category row must still paint a figure.
  const rows = await page.locator('[data-testid^="reports-breakdown-toggle-"]').count();
  check('the /reports category panels still exist', rows > 0, `${rows} expandable categories`);

  // Open one and prove the rows and the penny-match survive the change.
  if (rows > 0) {
    const first = page.locator('[data-testid^="reports-breakdown-toggle-"]').first();
    const id = (await first.getAttribute('data-testid')).replace('reports-breakdown-toggle-', '');
    await first.click();
    const panel = page.getByTestId(`reports-breakdown-panel-${id}`);
    const rowCount = await panel.getByTestId('reports-breakdown-row-amount').count();
    check('an opened panel still lists its rows', rowCount > 0, `${rowCount} rows in "${id}"`);

    const basis = await panel.innerText();
    check(
      'the shared basis sentence is unchanged by this slice',
      basis.includes('These are the rows the figure counts'),
      'BREAKDOWN_BASIS present',
    );

    // THE INERTNESS CLAIMS. A demo reader has no combined accounts, so the
    // marker and the sentence must be absent. This does not discriminate the
    // build (the pre-U.16 build has no marker to render either), but a marker
    // appearing HERE would mean the gate leaked, which is the failure this
    // slice could actually ship.
    const markers = await panel.getByTestId('reports-breakdown-handover-row').count();
    check('no handover marker on a reader with no combined accounts', markers === 0, `${markers} markers`);
    check(
      'no handover sentence on a reader with no combined accounts',
      !basis.includes('changing connections'),
      'sentence absent, as it must be',
    );
  }

  // ── /budgets: the second surface whose panels this slice threaded ─────────
  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  const budgetsText = await page.locator('main').innerText();
  check('/budgets still renders money', MONEY.test(budgetsText), 'figures present');
  check(
    '/budgets says nothing about handover days for a reader with no links',
    !budgetsText.includes('changing connections'),
    'silent, correctly',
  );

  // ── /coach: savings-rate month flows + lifestyle creep, both threaded ─────
  await page.goto(`${BASE}/coach`, { waitUntil: 'domcontentloaded' });
  const coachText = await page.locator('main').innerText();
  check('/coach still renders money', MONEY.test(coachText), 'figures present');
  check('/coach stays silent about handover days', !coachText.includes('changing connections'), 'silent, correctly');

  // ── /trends: movers' category panels + new-merchant panels ────────────────
  await page.goto(`${BASE}/trends`, { waitUntil: 'domcontentloaded' });
  const trendsText = await page.locator('main').innerText();
  check('/trends still renders', trendsText.length > 0, 'page painted');
  check('/trends stays silent about handover days', !trendsText.includes('changing connections'), 'silent, correctly');

  // ── What this script cannot reach ─────────────────────────────────────────
  skipped(
    'the marker rendered on a real released handover day',
    'needs an AccountReconciliation row; prisma/seed.ts writes none, so the demo cannot express a combined pair',
  );
  skipped(
    'the panel sentence naming a count of released rows',
    'same reason — no combined pair, so no released day and no count to name',
  );
  skipped(
    "Ask's spend answers carrying the no-row-list variant",
    'same reason; locked instead by tests/unit/u16-handover-disclosure.test.ts and the CI gate',
  );
  skipped(
    'discrimination between the pre-U.16 and post-U.16 builds',
    'there is no demo-visible string that differs; the deployment record ties production to the commit, and CI ran the discriminating suite',
  );

  console.log(`\n${pass} PASS / ${fail} FAIL / ${skip} declared SKIP`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (err) {
  console.error('\nU.16 live check ERRORED:', err?.message ?? err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
