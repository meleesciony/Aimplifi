/**
 * Deploy proof for U.9 (DECISIONS #453), run against PRODUCTION.
 *
 * WHAT THIS CAN AND CANNOT PROVE — stated up front, because for this slice the
 * honest answer is unusually limited and pretending otherwise would be the
 * "wrong-instrument" failure the U.5 record already caught once:
 *
 *   U.9 changes which recorded balance the net-worth trend counts when ONE real
 *   account was connected TWICE — two stale rows continued onto one live row.
 *   Reaching it needs `AccountReconciliation` rows, and `prisma/seed.ts` writes
 *   NONE, so no demo page can render a combined pair at all, let alone a sibling
 *   one. There is therefore NO demo-visible string that differs between the
 *   pre-U.9 and post-U.9 builds: this script CANNOT discriminate the deployment.
 *   It does not pretend to, and it declares that as a SKIP rather than dressing
 *   up a check that an old build would also pass.
 *
 *   What it CAN prove is the half that carries this slice's actual deployment
 *   risk. A change to the reconciliation boundary is a change to the money core
 *   that every surface reads through `getFinanceSnapshot`; the R8 golden
 *   guarantee is that with no effective links the INPUT ARRAYS come back by
 *   reference, untouched. If that broke, the demo — which is exactly the no-link
 *   case — would move. So these checks assert the demo's net-worth surfaces are
 *   intact and unchanged: the trend renders with its points, the headline net
 *   worth is a real figure, the account detail panel still lists recorded balance
 *   history, and NOTHING anywhere claims a balance is uncounted or combined.
 *
 *   The discriminating proof lives where it can actually run: the CI gate, whose
 *   full `VERIFY_E2E=1` suite includes `tests/unit/account-detail-reconciled.test.ts`
 *   › the SIBLINGS block — real Prisma, real server reads, asserting the trend's
 *   own constituents — plus the exhaustive shape probe
 *   `scripts/audit-probes/u9-component-invariant.mts` (210,120 cases).
 *
 * Read-only: one-click demo sign-in, page reads, writes nothing.
 *
 *   node scripts/u9-live-deploy-check.mjs
 */
import { chromium, devices } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const mobile = { ...devices['Pixel 5'], viewport: { width: 380, height: 800 } };

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const skip = (name, why) => console.log(`SKIP  ${name} — ${why}`);

/* Strings that may NEVER appear on a demo surface: the demo has no reconciliation
   rows, so any of these rendering means the boundary started dropping rows on the
   golden path — the exact regression a component-wide collision rule could cause. */
const MUST_BE_ABSENT = [
  'not in your net worth',
  'is not counted twice',
  'more than one row can describe',
  // The sentence U.9 REPLACED. Absent here because it never rendered on the demo
  // either — asserted so a rollback that reinstated it would still be caught if it
  // ever leaked onto a no-link surface.
  'both sides recorded a balance',
];

const browser = await chromium.launch();
const page = await browser.newPage(mobile);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  // Settle before reading: `waitForURL` resolves on navigation, and the first
  // pre-deploy run of this script read the body mid-render and reported a FAIL
  // against a page that was fine.
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // ── /dashboard: the net-worth headline is a real figure, not an error state ──
  const dashBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const netWorthOnDash = /\$[\d,]+\.\d{2}/.test(dashBody);
  check('dashboard renders money figures (the no-link golden path still computes)', netWorthOnDash);
  for (const phrase of MUST_BE_ABSENT) {
    check(`dashboard never says "${phrase}" (demo has no combined accounts)`, !dashBody.includes(phrase));
  }

  // ── /accounts: the trend and its constituents ──
  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const acctBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('/accounts renders', acctBody.length > 200, `${acctBody.length} chars`);
  check('/accounts shows money figures', /\$[\d,]+\.\d{2}/.test(acctBody));
  for (const phrase of MUST_BE_ABSENT) {
    check(`/accounts never says "${phrase}"`, !acctBody.includes(phrase));
  }

  // ── The account detail panel: recorded history still renders, unmarked ──
  // The demo's Auto Loan is the modal panel-opening account (U.3 routes LOAN-class
  // rows to the in-place detail panel rather than the register).
  // Reached by URL, not by tapping the row: the row is a disclosure toggle and a
  // 380px tap is a layout dependency this check has no business asserting. The
  // href is the one /accounts renders for it (verified live: /accounts?detail=acct-autoloan).
  await page.goto(`${BASE}/accounts?detail=acct-autoloan`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  const panel = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('the account detail panel still lists recorded balance history', /Recorded balance history/i.test(panel));
  // The demo's Auto Loan carries a full month-end series. If the boundary started
  // dropping rows on a no-link account, this is where it would show first.
  const historyRows = (panel.match(/−\$1[4-9],\d{3}\.\d{2}|−\$20,\d{3}\.\d{2}/g) ?? []).length;
  check('its recorded history still lists its months (R8 golden path intact)', historyRows >= 15, `${historyRows} dated balances`);
  for (const phrase of MUST_BE_ABSENT) {
    check(`detail panel never says "${phrase}"`, !panel.includes(phrase));
  }

  check('no uncaught page errors across the run', pageErrors.length === 0, pageErrors.join(' | '));

  skip(
    'the U.9 fix itself (one balance per component per date)',
    'unreachable on the demo: prisma/seed.ts writes no AccountReconciliation rows, so no combined ' +
      'pair — let alone a sibling pair — can render. Proven instead by tests/unit/account-detail-reconciled.test.ts ' +
      '(SIBLINGS, real Prisma) and scripts/audit-probes/u9-component-invariant.mts, both under the CI gate.',
  );
  skip(
    'the corrected uncounted-balances note',
    'renders only for an account with uncounted rows, which requires a combined pair — same reason.',
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks PASS`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
