/**
 * Deploy proof for O.18e-FU2 (TASKS), run against PRODUCTION.
 *
 * O.18e-FU2 closes the O.18e-FU re-review's P2-1: /reports and /trends gated
 * the scoped C.25 loan-payment sentence behind the figure it describes, so a
 * cash account whose ONLY activity is the excluded payment (a dedicated
 * mortgage/house account) got a non-empty exclusion set and NO sentence —
 * "No spending counted yet this month" / "No income or spending recorded…"
 * while money DID move. The fix: a new 'figureless' scope on the composer
 * ("Payments to {payee} at {amount}/mo are counted on {loanName} instead." —
 * no figure claim, because the abstain state renders no figure), rendered by
 * BOTH views' empty branches when the exclusion set is non-empty.
 *
 * Honest marker scope, per the FU3 premise-correction lesson: the demo corpus
 * has NO loan-payment exclusions (C.25), so the figureless sentence never
 * RENDERS on demo in either build — page-level greps cannot discriminate.
 * The one client-visible artifact the slice changed is the composer's
 * figureless branch + the two render sites, all in 'use client' bundles:
 * the word `figureless` (the scope literal in `"figureless"===t` and the two
 * `loanPaymentBasisSentence(e, 'figureless')` calls) is unique to this slice
 * — no module outside it carries the string, so NO pre-FU2 bundle can contain
 * it. The RENDER decision itself (which branch prints which sentence) is
 * proven by the jsdom locks in tests/unit/o18e-fu2-render.test.tsx and the
 * VERIFY_E2E=1 CI gate on the shipped sha.
 *
 * Read-only: one-click demo sign-in, two page reads, writes nothing.
 *
 *   node scripts/o18efu2-live-deploy-check.mjs
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

/** Fetch every same-origin script a page references and concatenate the bytes. */
async function bundleOf(path) {
  const res = await page.request.get(`${BASE}${path}`, {});
  if (!res.ok()) throw new Error(`route ${path} → ${res.status()}`);
  // waitUntil networkidle guarantees the route's chunks are referenced in the HTML.
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const scriptSrcs = await page
    .locator('script[src]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('src')).filter((s) => s && s.startsWith('/')));
  const chunks = await Promise.all(
    scriptSrcs.map(async (src) => {
      const r = await page.request.get(`${BASE}${src}`);
      return r.ok() ? r.text() : '';
    }),
  );
  return chunks.join('\n');
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  // /reports: the composer (and the figureless render site) ships in this
  // 'use client' view's bundles.
  const reportsBundle = await bundleOf('/reports');
  await page.getByTestId('income-expense-chart').waitFor({ timeout: 30000 });
  check('/reports loads', true, 'income-expense-chart');
  check(
    'the /reports bundle ships the figureless scope (fragment `figureless`) — the FU2 discriminator',
    reportsBundle.includes('figureless'),
    `${reportsBundle.length.toLocaleString()} bytes`,
  );
  check(
    'the /reports bundle ships the figureless render site (testid `reports-loan-payment-basis-empty`)',
    reportsBundle.includes('reports-loan-payment-basis-empty'),
  );
  check(
    'the /reports bundle still ships the page-figures scope ("an escrow change, say")',
    reportsBundle.includes('an escrow change, say'),
  );
  check(
    'the old universal "not as spending" is GONE from the /reports bundle',
    !reportsBundle.includes('not as spending'),
  );

  // /trends: the same composer + the pace-empty render site.
  const trendsBundle = await bundleOf('/trends');
  await page.getByTestId('trends-new-merchants').waitFor({ timeout: 30000 });
  check('/trends loads', true, 'trends-new-merchants');
  check(
    'the /trends bundle ships the figureless scope too',
    trendsBundle.includes('figureless'),
    `${trendsBundle.length.toLocaleString()} bytes`,
  );
  check(
    'the /trends bundle ships the figureless render site (testid `trends-loan-payment-basis-empty`)',
    trendsBundle.includes('trends-loan-payment-basis-empty'),
  );

  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 120));
} catch (err) {
  check('script completed', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
