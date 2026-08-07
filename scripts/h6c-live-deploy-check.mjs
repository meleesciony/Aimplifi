/**
 * Deploy proof for H.6c + H.6b(b) (#425), run against PRODUCTION.
 *
 * WHAT THIS SLICE CAN AND CANNOT PROVE LIVE — stated up front, because like H.7
 * this slice has NO client-visible discriminator: `keepRank`'s depth rule and the
 * no-loss guard's bank-shape read are server/engine decisions whose sentences
 * were already on the page before the change.
 *
 *  - What production CAN prove, and what this script checks:
 *      1. the new build serves for a signed-in user;
 *      2. THE REAL RISK OF THIS DEPLOY did not materialise: `getAccountsView`
 *         now builds the per-account earliest-txn map and calls the WIDENED
 *         `combinableConnectionsFor` / `uncombinableConnectionsFor` signatures,
 *         and the combine action's transaction gained a groupBy — a bad import,
 *         arity mismatch or query error would 500 exactly /accounts;
 *      3. the negative direction that IS observable on the shared demo: the
 *         demo fence still returns no combine offer, so no combine card renders
 *         for the anonymous visitor;
 *      4. the register still renders real history (transactions.ts is the
 *         module the /accounts changes live in);
 *      5. no uncaught client errors on the routes read.
 *
 *  - NOT PROVEN HERE, proven by the unit gate instead (with three executed
 *    sabotages): that the recommended direction keeps the deeper connection,
 *    that a starved depth map fails its lock, and that a hand-split row no
 *    longer refuses the combine while a genuinely missing charge still does.
 *    Those need two live Plaid connections at one bank, which the demo — by
 *    design — can never hold.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/h6c-live-deploy-check.mjs
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

  // 1 — /accounts renders after the widened combine signatures + the new depth map.
  const accountsRes = await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const accountsOk = (accountsRes?.status() ?? 0) < 400;
  check('the accounts page renders after the depth-map + signature change', accountsOk, `status=${accountsRes?.status()}`);

  // 2 — the demo fence still holds: no combine card for the anonymous visitor.
  const combineCards = await page.getByTestId('combine-connections-card').count();
  check('the shared demo is still offered NO combine card (fence unchanged)', combineCards === 0, `count=${combineCards}`);

  // 3 — the register renders real history (same server module as the /accounts change).
  const txnRes = await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const span = page.getByTestId('txn-history-span');
  await span.waitFor({ timeout: 30_000 });
  const spanText = ((await span.textContent()) ?? '').trim();
  check(
    'the register renders and reads real transaction history',
    (txnRes?.status() ?? 0) < 400 && /\b(19|20)\d{2}\b/.test(spanText),
    spanText.slice(0, 60),
  );

  // 4 — no uncaught client errors anywhere above.
  check('no uncaught client errors on the routes read', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 120) || 'none');
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
