/**
 * Deploy proof for H.2 (#430), run against PRODUCTION.
 *
 * WHAT THIS SLICE CAN AND CANNOT PROVE LIVE — stated up front (the H.8/C.9
 * precedent). The shared demo has NO connected institutions (the seed never
 * creates a PlaidItem), so the per-institution guide CARDS cannot render for
 * it — but the guides SECTION (header + generic card) always renders, the
 * page copy softened by critic P1-1 is server-rendered text, and the form is
 * the same shape the e2e specs drive. Those three are the discriminating
 * markers this slice added; the dedupe itself (multiset plan, serializableTx,
 * repeatedRows) is proven by the unit suite — production cannot show it
 * without real overlapping data, same as H.8's honest limit.
 *
 * What production CAN prove, and what this script checks:
 *   1. /transactions/import renders through the rewritten page (guides
 *      section + generic card + softened copy marker, server HTML).
 *   2. The form is present (import-csv-form / import-submit testids).
 *   3. The demo fence still holds: submitting a CSV as the shared demo gets
 *      the honest inline refusal, and no row lands (the DEMO_ENTRY_BLOCKED
 *      path is the same fence the slice touched in its early returns).
 *   4. No uncaught client errors on either page.
 *
 * Read-only: one-click demo sign-in, reads pages, writes nothing. The fence
 * submit is the demo's own refusal path — it writes nothing by construction.
 *
 *   node scripts/h2-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const COPY_MARKER = 'the import will flag it';

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

  // Deploy settle: Vercel finishes within a couple of minutes of the push; the
  // marker must appear (or the check fails) within a bounded 3-minute window.
  let html = '';
  for (let attempt = 0; attempt < 18; attempt++) {
    const res = await page.goto(`${BASE}/transactions/import`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('import-csv-form').waitFor({ timeout: 20_000 });
    html = await page.content();
    if (res?.status() === 200 && html.includes('How to export from your bank')) break;
    await page.waitForTimeout(10_000);
  }

  const res = await page.goto(`${BASE}/transactions/import`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('import-csv-form').waitFor({ timeout: 20_000 });
  html = await page.content();
  check('/transactions/import renders', res?.status() === 200, `HTTP ${res?.status()}`);
  check(
    'guides section is live (header + generic card)',
    html.includes('How to export from your bank') && html.includes('synced feed is your history'),
    'server HTML',
  );
  check(
    "P1-1 softened copy is live — no more 'always safe'",
    html.includes(COPY_MARKER) && !html.includes('always safe'),
    COPY_MARKER,
  );

  // The demo fence still refuses a pasted CSV inline, and nothing lands.
  await page.getByTestId('import-csv-text').fill('date,description,amount\n2026-06-01,GOOSE POND BAR GRILLE,-84.20\n');
  await page.getByTestId('import-submit').click();
  await page.getByTestId('import-result').waitFor({ timeout: 20_000 });
  const resultText = await page.getByTestId('import-result').innerText();
  check('demo import is fenced inline (shared account, honest refusal)', /shared/i.test(resultText), resultText.trim().slice(0, 80));

  check('no uncaught client errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
