/**
 * Deploy proof for O.18e-FU3 (TASKS), run against PRODUCTION.
 *
 * O.18e-FU3 scoped the /ask loan-payment answer copy: the three
 * "…not as spending" strings in the answer engine became "…not in these
 * figures" (the clause beside figures) / "…counted on the loan instead" (the
 * count-0 branches), and the server-appended sentence (server/assistant.ts)
 * now renders the composer's new 'answer' scope instead of a hand-rolled
 * sixth copy. The demo corpus has NO loan-payment exclusions (C.25: "Empty
 * when no merchant qualifies (demo …)"), so none of the sentences render on
 * demo in either build — page-level greps cannot discriminate.
 *
 * The discriminating marker is the CLIENT BUNDLE of /ask: ask-view is a
 * 'use client' component that imports the answer engine, so its shipped
 * chunk previously contained "not as spending" and now contains the two
 * scoped replacements. The composer's new 'answer' scope ("not in this
 * answer") ships via /reports (reports-view imports the composer), which is
 * also checked. The server append itself is 'use server' — never in client
 * bytes; it is covered by the composer lock + the absence of the old
 * hand-rolled string anywhere in the shipped bundles.
 *
 * Read-only: one-click demo sign-in, two page reads, writes nothing.
 *
 *   node scripts/o18efu3-live-deploy-check.mjs
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

  const askBundle = await bundleOf('/ask');
  await page.getByTestId('ask-input').waitFor({ timeout: 30000 });
  check('/ask loads', true, 'ask-input');
  check(
    'the /ask bundle ships the scoped "counted on the loan instead" (count-0 branches)',
    askBundle.includes('counted on the loan instead'),
    `${askBundle.length.toLocaleString()} bytes`,
  );
  check(
    'the /ask bundle ships the scoped "not in these figures" (clause beside figures)',
    askBundle.includes('not in these figures'),
  );
  check(
    'the old universal "not as spending" is GONE from the /ask bundle',
    !askBundle.includes('not as spending'),
  );

  const reportsBundle = await bundleOf('/reports');
  await page.getByTestId('income-expense-chart').waitFor({ timeout: 30000 });
  check('/reports loads', true, 'income-expense-chart');
  check(
    'the /reports bundle ships the composer\'s new \'answer\' scope ("not in this answer")',
    reportsBundle.includes('not in this answer'),
  );
  check(
    'the /reports bundle still ships the page-figures scope ("an escrow change, say")',
    reportsBundle.includes('an escrow change, say'),
  );
  check(
    'the old universal "not as spending" is GONE from the /reports bundle',
    !reportsBundle.includes('not as spending'),
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
