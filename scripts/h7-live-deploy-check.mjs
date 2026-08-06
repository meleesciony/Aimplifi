/**
 * Deploy proof for H.7 (#415), run against PRODUCTION.
 *
 * WHAT THIS SLICE CAN AND CANNOT PROVE LIVE — stated up front, because H.7 has
 * NO UI of its own and the usual "grep for a new testid" discriminator does not
 * exist here:
 *
 *  - The change is entirely a server path: the pure `planTransferUpdates` gate
 *    plus `refreshTransferFlags`, which runs ONLY inside a Plaid or SimpleFIN
 *    sync. The shared demo is fenced from provider egress by construction
 *    (#242 F1), so production cannot be made to run the sweep. There is also NO
 *    schema change in this slice, so there is no migration to observe either.
 *  - What production CAN prove, and what this script actually checks:
 *      1. the new build is serving — the deployment is aliased and the app
 *         renders for a signed-in user;
 *      2. THE REAL RISK OF THIS DEPLOY did not materialise: `transfer-refresh`
 *         now imports `activeTerminalSuccessorMap` from the reconciliation
 *         server module, and both providers now read a THIRD field off its
 *         return value. A bad import or a shape mismatch would 500 the routes
 *         whose server modules pull that graph in — /accounts, /transactions,
 *         /dashboard, /reports;
 *      3. the surfaces that READ `isTransfer` still render real figures: the
 *         register (which lists rows the flag excludes from sums) and /reports
 *         (whose income and spending totals are exactly what a wrong flag
 *         moves).
 *
 *  - NOT PROVEN HERE, and proven by the unit gate instead: that a coincidental
 *    pair no longer reverses a settled verdict, that two rows on one reconciled
 *    account never pair, and that both writes re-assert their premise. Those
 *    live in tests/unit/transfer-pair-filing.test.ts and
 *    tests/unit/h7-transfer-boundary.test.ts against real Prisma, with five
 *    executed sabotages, because production has no sync this script may trigger.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/h7-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // 1 — THE RECONCILIATION GRAPH THE SWEEP NOW IMPORTS STILL LOADS.
  // /accounts is the page that owns reconciliation state; `transfer-refresh`
  // now depends on the same server module for `activeTerminalSuccessorMap`.
  const accountsRes = await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const accountsOk = (accountsRes?.status() ?? 0) < 400;
  check(
    'the accounts page renders after the reconciliation-identity import',
    accountsOk,
    `status=${accountsRes?.status()}`,
  );

  // 2 — THE REGISTER RENDERS REAL ROWS. This is the surface that lists the
  // transactions `isTransfer` withholds from every sum; a broken transfer module
  // would take the route down.
  const txnRes = await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const span = page.getByTestId('txn-history-span');
  await span.waitFor({ timeout: 30_000 });
  const spanText = (await span.textContent()) ?? '';
  check(
    'the register renders and reads real transaction history',
    (txnRes?.status() ?? 0) < 400 && /\b(19|20)\d{2}\b/.test(spanText),
    spanText.trim().slice(0, 60),
  );

  // 3 — THE FIGURES A WRONG FLAG WOULD MOVE. /reports prints income and spending
  // totals built by excluding `isTransfer` rows; it must render a real amount.
  const reportsRes = await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  const body = (await page.textContent('body')) ?? '';
  const hasMoney = /\$[\d,]+/.test(body);
  check(
    'the income/spending totals that a wrong transfer flag would move still render',
    (reportsRes?.status() ?? 0) < 400 && hasMoney,
    `status=${reportsRes?.status()} money-rendered=${hasMoney}`,
  );

  // 4 — THE SYNC-OWNING PAGE. Both providers now read a third field off
  // refreshTransferFlags' return value; a shape mismatch would 500 this route.
  const dash = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  check(
    'the dashboard still renders after the sync-path return-shape change',
    (dash?.status() ?? 0) < 400,
    `status=${dash?.status()}`,
  );

  // 5 — NO CLIENT-SIDE EXPLOSION on any route read above.
  check('no uncaught client errors on the routes read', pageErrors.length === 0, pageErrors[0] ?? 'none');
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
