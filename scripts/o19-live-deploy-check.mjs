/**
 * Deploy proof for O.19 (#426), run against PRODUCTION.
 *
 * WHAT THIS SLICE CAN AND CANNOT PROVE LIVE — stated up front.
 *
 * The Account cleanup section renders ONLY for a reader who has something to clean up: a
 * duplicate connection, an advisory duplicate pair, a reconciliation candidate or an
 * already-combined account. The shared demo dataset has **zero** `PlaidItem` rows by
 * construction, so it can hold none of those. The visible half of this slice is therefore
 * unreachable on production by an anonymous visitor, and no amount of clicking will show it.
 *
 *  - What production CAN prove, and what this script checks:
 *      1. the new build serves for a signed-in user;
 *      2. THE REAL RISK OF THIS DEPLOY did not materialise. O.19 added imports across the
 *         lib/components boundary — `card-duplicate-view.ts` and `row-labels.ts` (both in
 *         src/lib/engine) now import a new module, and four component copy modules were
 *         re-pointed at it. A bad path or a cycle would blow up exactly the routes those
 *         modules render: /accounts, /cards, /calendar, /budgets, /spending-plan;
 *      3. the contract that an EMPTY cleanup set renders NOTHING — no stray disclosure on the
 *         page of a reader with no duplicates. This is the demo's correct state, asserted
 *         rather than assumed;
 *      4. ANTI-VACUITY, because check 3 would pass just as well against the OLD build: the
 *         JS actually served to the browser must CONTAIN the new heading string. If the
 *         deploy had not landed, this fails while everything else still passes.
 *
 *  - NOT PROVEN HERE, proven by the unit gate + the e2e suite instead: the summary line's
 *    wording and ranking (18 unit assertions, one sabotage reddening four at once) and the
 *    collapsed-by-default behaviour with its sticky open state (family e2e 22/22). Those need
 *    two live connections at one bank, which the demo — by design — can never hold.
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/o19-live-deploy-check.mjs
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

// Every script the browser actually loaded — the material for the anti-vacuity check.
const scriptUrls = new Set();
page.on('response', (r) => {
  const u = r.url();
  if (u.endsWith('.js') || u.includes('/_next/static/chunks/')) scriptUrls.add(u);
});

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // 1 — /accounts renders after the new cross-boundary imports.
  const accountsRes = await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('accounts-net-worth-amount').waitFor({ timeout: 30_000 });
  check(
    'the accounts page renders after the O.19 import re-point',
    (accountsRes?.status() ?? 0) < 400,
    `status=${accountsRes?.status()}`,
  );

  // 2 — the empty-set contract, live: a reader with nothing to clean up gets no disclosure.
  const section = await page.getByTestId('account-cleanup').count();
  const summary = await page.getByTestId('account-cleanup-summary').count();
  check(
    'a reader with nothing to clean up sees NO cleanup section at all',
    section === 0 && summary === 0,
    `section=${section} summary=${summary}`,
  );

  // 3 — ANTI-VACUITY. Check 2 passes against the old build too, so prove the new code is the
  // code being served: the heading string must exist in the JS the browser just loaded.
  let headingInBundle = false;
  let scanned = 0;
  for (const url of scriptUrls) {
    try {
      const res = await page.request.get(url);
      if (!res.ok()) continue;
      scanned += 1;
      if ((await res.text()).includes('Account cleanup')) {
        headingInBundle = true;
        break;
      }
    } catch {
      /* a chunk that will not re-fetch proves nothing either way */
    }
  }
  check(
    'the JS served to the browser CONTAINS the new section heading (deploy really landed)',
    headingInBundle,
    `scanned ${scanned} chunks of ${scriptUrls.size}`,
  );

  // 4 — every other route whose copy modules O.19 touched still renders.
  for (const [route, testid] of [
    ['/cards', null],
    ['/calendar', null],
    ['/budgets', null],
    ['/spending-plan', null],
  ]) {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    if (testid) await page.getByTestId(testid).waitFor({ timeout: 30_000 });
    check(`${route} renders after the copy-module changes`, (res?.status() ?? 0) < 400, `status=${res?.status()}`);
  }

  // 5 — no uncaught client errors anywhere above.
  check(
    'no uncaught client errors on the routes read',
    pageErrors.length === 0,
    pageErrors.join(' | ').slice(0, 160) || 'none',
  );
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
