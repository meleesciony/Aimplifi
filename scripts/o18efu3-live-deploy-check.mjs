/**
 * Deploy proof for O.18e-FU3 (TASKS), run against PRODUCTION.
 *
 * O.18e-FU3 scoped the /ask loan-payment answer copy: the engine's three
 * "…not as spending" sites became "…not in these figures" (beside figures) /
 * "…counted on the loan instead" (the count-0 branches), and the server
 * append (server/assistant.ts) now renders the composer's new 'answer' scope
 * ("this answer") instead of a hand-rolled sixth copy. The demo corpus has NO
 * loan-payment exclusions (C.25: "Empty when no merchant qualifies (demo …)"),
 * so none of the sentences render on demo in either build — page-level greps
 * cannot discriminate.
 *
 * DISCRIMINATOR, and the premise correction this check records: the answer
 * ENGINE is server-side by construction — ask-view.tsx imports it TYPE-ONLY
 * (its own comment: "doesn't pull the engine into the client bundle") and the
 * answer text is computed in the 'use server' askAssistant action, so none of
 * the engine strings ever ship in the /ask client bundle (on EITHER deploy —
 * the earlier "old universal gone from /ask" marker was vacuous). The one
 * client-visible artifact the slice changed is the composer's where-map: the
 * new 'answer' scope inlines as `answer:"this answer"` in the /reports client
 * bundle (reports-view imports the composer at runtime), and NO pre-FU3
 * bundle can contain that fragment — the composer had five scopes and no
 * other /reports module carries the string. /ask's own role here is page load
 * + zero page errors; the /ask server copy is proven by the same build CI
 * green proved (the strings ARE in the .next/server SSR chunk of the deployed
 * commit — verified locally by grep before shipping).
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

  // /ask: the engine copy is server-side by construction (type-only import),
  // so the page-level proof here is load + zero errors only.
  await page.goto(`${BASE}/ask`, { waitUntil: 'networkidle' });
  await page.getByTestId('ask-input').waitFor({ timeout: 30000 });
  check('/ask loads', true, 'ask-input');

  const reportsBundle = await bundleOf('/reports');
  await page.getByTestId('income-expense-chart').waitFor({ timeout: 30000 });
  check('/reports loads', true, 'income-expense-chart');
  check(
    'the /reports bundle ships the composer\'s new \'answer\' scope (fragment `answer:"this answer"`) — the FU3 discriminator',
    reportsBundle.includes('answer:"this answer"'),
    `${reportsBundle.length.toLocaleString()} bytes`,
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
