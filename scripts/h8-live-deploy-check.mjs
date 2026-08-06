/**
 * Deploy proof for H.8 (#416), run against PRODUCTION.
 *
 * WHAT THIS SLICE CAN AND CANNOT PROVE LIVE — stated up front (the H.7/C.9
 * precedent): H.8 threads the R1 reconciliation keep through seven server read
 * or write sites. The shared demo has NO reconciliation links (the seed never
 * creates one), so on the demo every keep is the constant-true fast path and
 * every count is byte-identical to the old build — there is no discriminating
 * number this script can read. There is also no schema change.
 *
 * What production CAN prove, and what this script checks: the real deploy risk
 * is the new import graph. Seven modules now pull `getReconciliationTxnKeep`
 * from the reconciliation server module inside routes that never imported it —
 * /settings (self-audit card), /rules (preview + source-transaction read),
 * /triage (items + group actions), and the backfill action reachable from
 * /triage. A bad import, a circular-init failure, or a shape mismatch would
 * 500 exactly those routes, so each is loaded signed-in and must answer < 400
 * with no uncaught client error. /transactions and /reports ride along as the
 * canary the H.7 proof established.
 *
 * NOT PROVEN HERE, proven by the unit gate instead: that a disowned duplicate
 * is excluded from the self-audit tally, the keyword preview/apply, the
 * backfill, and all four merchant-batch writers — those need a reconciled
 * pair, which only the unit suite seeds (10 locks, 7 executed sabotages).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   node scripts/h8-live-deploy-check.mjs
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

  // 1 — /settings renders the AI-trust card whose self-audit read now imports
  // the reconciliation keep.
  const settings = await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  check(
    'settings (self-audit card) renders after the keep import',
    (settings?.status() ?? 0) < 400,
    `status=${settings?.status()}`,
  );

  // 2 — /rules: previewKeywordRule + getRuleSourceTransaction both changed.
  const rules = await page.goto(`${BASE}/rules`, { waitUntil: 'domcontentloaded' });
  check(
    'the rules builder renders after the matchableHistory change',
    (rules?.status() ?? 0) < 400,
    `status=${rules?.status()}`,
  );

  // 3 — /triage: getTriageItems was restructured (keep joined the Promise.all)
  // and the batch actions changed; the page must still build its queue.
  const triage = await page.goto(`${BASE}/triage`, { waitUntil: 'domcontentloaded' });
  check(
    'the triage inbox renders after the similarCount/getTriageItems restructure',
    (triage?.status() ?? 0) < 400,
    `status=${triage?.status()}`,
  );

  // 4 — the register canary: real transaction history still reads.
  const txnRes = await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const span = page.getByTestId('txn-history-span');
  await span.waitFor({ timeout: 30_000 });
  const spanText = (await span.textContent()) ?? '';
  check(
    'the register renders and reads real transaction history',
    (txnRes?.status() ?? 0) < 400 && /\b(19|20)\d{2}\b/.test(spanText),
    spanText.trim().slice(0, 60),
  );

  // 5 — the money canary: /reports still renders real totals.
  const reportsRes = await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  const body = (await page.textContent('body')) ?? '';
  const hasMoney = /\$[\d,]+/.test(body);
  check(
    'the reports totals still render',
    (reportsRes?.status() ?? 0) < 400 && hasMoney,
    `status=${reportsRes?.status()} money-rendered=${hasMoney}`,
  );

  // 6 — no client-side explosion on any route read above.
  check('no uncaught client errors on the routes read', pageErrors.length === 0, pageErrors[0] ?? 'none');
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
