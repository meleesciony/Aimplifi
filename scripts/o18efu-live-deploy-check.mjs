/**
 * Deploy proof for O.18e-FU (#441), run against PRODUCTION.
 *
 * O.18e-FU replaced the universal C.25 sentence ("loan payments are not
 * spending", hand-rolled in five surfaces) with one scoped composer
 * (`loanPaymentBasisSentence(fact, scope)`), imported by every surface. The
 * demo corpus has NO loan-payment exclusions (C.25: "Empty when no merchant
 * qualifies (demo …)"), so the sentence never renders on demo in either
 * build — a page-level grep cannot discriminate. The discriminating marker is
 * the CLIENT BUNDLE of /reports: reports-view is a 'use client' component
 * that imports the composer, so its shipped chunk previously contained the
 * hand-rolled universal and now contains the scoped page-figures sentence
 * ("an escrow change, say" — unique to that scope). The other four surfaces
 * are server components (sentence composed at SSR time, absent on demo), so
 * they are covered here by page-load markers + the zero page errors sweep.
 *
 * Read-only: one-click demo sign-in, five page reads, writes nothing.
 *
 *   node scripts/o18efu-live-deploy-check.mjs
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

  // The five surfaces load with their stable markers.
  await page.getByTestId('net-worth-card').waitFor({ timeout: 30000 });
  check('/dashboard loads', true, 'net-worth-card');

  await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' });
  await page.getByTestId('money-review-card').waitFor({ timeout: 30000 });
  check('/coach loads', true, 'money-review-card');

  await page.goto(`${BASE}/budgets`, { waitUntil: 'networkidle' });
  await page.getByTestId('budget-list').waitFor({ timeout: 30000 });
  check('/budgets loads', true, 'budget-list');

  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.getByTestId('income-expense-chart').waitFor({ timeout: 30000 });
  check('/reports loads', true, 'income-expense-chart');

  // The discriminating marker: the client bundle of /reports. Collect every
  // same-origin script the page references and grep the concatenated bytes.
  const scriptSrcs = await page
    .locator('script[src]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('src')).filter((s) => s && s.startsWith('/')));
  const chunks = await Promise.all(
    scriptSrcs.map(async (src) => {
      const res = await page.request.get(`${BASE}${src}`);
      return res.ok() ? res.text() : '';
    }),
  );
  const bundle = chunks.join('\n');
  check(
    'the /reports bundle ships the scoped page-figures sentence',
    bundle.includes('an escrow change, say'),
    `${bundle.length.toLocaleString()} bytes across ${scriptSrcs.length} chunks`,
  );
  check(
    'the old universal "loan payments are not spending" is GONE from the bundle',
    !bundle.includes('loan payments are not spending'),
  );

  await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' });
  await page.getByTestId('trends-new-merchants').waitFor({ timeout: 30000 });
  check('/trends loads', true, 'trends-new-merchants');

  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 120));
} catch (err) {
  check('script completed', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
