/**
 * Deploy proof for C.15 (#433), run against PRODUCTION.
 *
 * The fixes are (1) the transaction detail's way back can name a TRANSACTION
 * or a named PAGE — F1 — and (2) three entry points hand the detail page a
 * named token so its way back names where the reader actually stood — F3:
 * the triage inbox (`_triage`), the dashboard recents (`_dashboard`), and the
 * breakdown expanders (`_budgets` etc). The encoders/decoders are proven by
 * the unit locks; live, what discriminates THIS build from the last is the
 * detail page rendering "Back to the triage inbox" after a triage drill-in —
 * the old build always said "Activity" (or, on an unfiltered register, nothing).
 *
 * Read-only: one-click demo sign-in, three page reads, writes nothing.
 *
 *   node scripts/c15-live-deploy-check.mjs
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
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  // F3 / triage: the queue's drill-in carries `_triage`, and the detail page
  // names it. The old build carried nothing and said "Activity".
  await page.goto(`${BASE}/triage`, { waitUntil: 'networkidle' });
  const openDetail = page.getByTestId('triage-open-detail').first();
  if (!(await openDetail.count())) {
    check('triage queue has a row to drill into', false, 'no triage-open-detail on live demo');
    throw new Error('abort: no triage row');
  }
  await openDetail.click();
  await page.waitForURL(/\/transactions\/[a-z0-9-]{6,}/, { timeout: 20000 });
  const url1 = new URL(page.url());
  check(
    'triage drill-in carries back=_triage',
    url1.searchParams.get('back') === '_triage',
    `got ${url1.searchParams.get('back') ?? 'nothing'}`,
  );
  const back = page.getByTestId('detail-back-link');
  await back.waitFor({ timeout: 20000 });
  check(
    'the way back names the triage inbox',
    /Back to the triage inbox/.test(await back.innerText()),
    `got: ${(await back.innerText()).slice(0, 60)}`,
  );

  // F3 / dashboard: the recents' drill-in carries `_dashboard` and the detail
  // page names the dashboard. The old build said "Activity".
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  const recentRow = page.getByTestId('dashboard-recent-row').first();
  if (!(await recentRow.count())) {
    check('dashboard recents has a row to drill into', false, 'no dashboard-recent-row on live demo');
    throw new Error('abort: no recent row');
  }
  // The first click after a load can land pre-hydration and drop silently
  // (#167); retry once if no navigation follows.
  for (let attempt = 0; attempt < 2; attempt++) {
    await recentRow.click();
    try {
      await page.waitForURL('**/transactions/*', { timeout: 8000 });
      break;
    } catch {
      if (attempt === 1) throw new Error(`dashboard drill-in never navigated (${page.url()})`);
    }
  }
  const url2 = new URL(page.url());
  check(
    'dashboard drill-in carries back=_dashboard',
    url2.searchParams.get('back') === '_dashboard',
    `got ${url2.searchParams.get('back') ?? 'nothing'}`,
  );
  const back2 = page.getByTestId('detail-back-link');
  await back2.waitFor({ timeout: 20000 });
  check(
    'the way back names the dashboard',
    /Back to your dashboard/.test(await back2.innerText()),
    `got: ${(await back2.innerText()).slice(0, 60)}`,
  );

  // No page errors on either detail read.
  check('no page errors on the walked routes', pageErrors.length === 0, pageErrors.join(' | '));
} catch (e) {
  check('walk completed', false, String(e).slice(0, 200));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL CHECKS PASSED');
process.exit(failed.length ? 1 : 0);
