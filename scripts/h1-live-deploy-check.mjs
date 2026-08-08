/**
 * Deploy proof for H.1(b), run against PRODUCTION. Read-only: one-click demo
 * sign-in, reads /accounts and /transactions, writes nothing.
 *
 * The honest problem this script has to solve. Production's only reachable
 * account is the shared demo, and the demo has NO bank connections at all
 * (measured, not assumed: `scripts/audit-probes/h1-connection-depth.mts` buckets
 * its 9 accounts under `none:demo`, and Q4 reports 0 plaid accounts). So the new
 * per-connection line CANNOT render on any page this script can reach, and
 * "grep the HTML for the new testid" — the marker technique every previous
 * slice's proof used — is unavailable here.
 *
 * What it proves instead:
 *  1. the new BUILD is serving — the depth copy lives in a pure module imported
 *     by two 'use client' components, so it ships in public /_next/static chunks
 *     whether or not it renders. The sentence "No history of its own" exists
 *     nowhere else in the app (one source occurrence, verified), so finding it in
 *     a chunk production served is a marker unique to this change.
 *  2. the new LOADER runs — every /accounts render now calls
 *     getReconciliationTxnKeep and the depth engine, so a page that answers 200
 *     with its own testids proves the added code path executes on PostgreSQL
 *     rather than throwing;
 *  3. /transactions still prints its global "History available from" line, which
 *     this slice deliberately left alone — the per-connection line is additive;
 *  4. no uncaught client errors.
 *
 * NOT proven here, and recorded rather than glossed: the LINKED path — the
 * `distinct` read plus the keep-rule MIN that only executes for a user with at
 * least one active AccountReconciliation. The demo has none, so on production
 * this script exercises only the zero-links fast path. That branch is covered by
 * the unit gate (tests/unit/connection-history-depth-server.test.ts, five
 * link-bearing fixtures) and by tests/e2e/connection-history-depth.spec.ts, both
 * on SQLite. The owner's own account is the only place the PostgreSQL linked
 * path runs, and it is not reachable from here.
 *
 *   node scripts/h1-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MARKER = 'No history of its own';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

// Collect every script URL the browser actually fetches, so check 1 reads the
// chunks production served rather than a path this script guessed at.
const scriptUrls = new Set();
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/_next/static/') && u.endsWith('.js')) scriptUrls.add(u);
});

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo on production', true, BASE);

  // 2 — /accounts renders through the rewritten loader.
  const res = await page.goto(`${BASE}/accounts`, { waitUntil: 'networkidle' });
  await page.getByTestId('accounts-net-worth').waitFor({ timeout: 30_000 });
  check('/accounts renders through the new getAccountsView', res?.status() === 200, `HTTP ${res?.status()}`);

  // 1 — the marker, in a chunk production actually served for this page.
  let found = null;
  for (const url of scriptUrls) {
    const body = await page.request.get(url).then((r) => r.text()).catch(() => '');
    if (body.includes(MARKER)) {
      found = url;
      break;
    }
  }
  check('the new build is serving — this slice\'s copy is in a live chunk', found !== null, found ?? `${scriptUrls.size} chunks scanned, marker absent`);

  // 3 — the register's own global line is untouched by this slice.
  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
  const span = page.getByTestId('txn-history-span');
  const spanText = (await span.count()) ? ((await span.first().textContent()) ?? '').trim() : '';
  check('the register still prints its global history line', /^History available from /.test(spanText), spanText || 'absent');

  // The demo genuinely has no connections, so the new surface must be absent
  // here — an empty connections block is the CORRECT render, and a depth line
  // appearing over zero connections would mean the surface invented one.
  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  const depthLines = await page.getByTestId('plaid-item-history').count();
  const sfDepth = await page.getByTestId('simplefin-history').count();
  check(
    'no depth line is invented for a user with no connections',
    depthLines === 0 && sfDepth === 0,
    `plaid=${depthLines} simplefin=${sfDepth}`,
  );

  check('no uncaught client errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
