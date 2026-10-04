/**
 * Deploy proof for DECISIONS #785 (regular pay plans the month, only when
 * steady paychecks clearly explain the household's pay), run against
 * PRODUCTION. Node type: live probe (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST:
 *
 *  1. A CLIENT-BUNDLE LITERAL. The plan-figures form (a client component loaded
 *     by /spending-plan) now says where the suggested income comes from as
 *     "From your income data:" — the previous build said "From categorized
 *     paychecks:", which stopped being true once the figure could be regular pay
 *     at its yearly rate. The demo cannot edit figures, so the form renders its
 *     read-only branch and the label is not in the demo's HTML; the literal is
 *     in the served chunk either way (a local dry run found exactly this).
 *  2. THE FAIL-CLOSED DEFAULT. The shared demo's payroll is filed generic
 *     Income, so no steady paycheck forms and the demo must still read the
 *     three-month median — "Income (median of last 3 months)". A build that
 *     moved the demo off the median would be the rule failing open.
 *
 * WHAT IT CANNOT PROVE: the regular-pay figure itself has no demo household to
 * render on. It is proven by the unit locks over invented households, the e2e
 * throwaway user, and the owner's read-only replay on their own account.
 *
 * Read-only throughout: one-click demo sign-in, reads one page, writes nothing.
 *
 *   node scripts/regular-pay-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const NEW_MARKER = 'From your income data:';
const OLD_MARKER = 'From categorized paychecks:';
const DEMO_BASIS = 'Income (median of last 3 months)';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo', true, BASE);

  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('spending-plan-hero').waitFor({ timeout: 30_000 });
  check('/spending-plan renders its hero', true);
  const html = await page.content();
  check(`the demo still plans on the median ("${DEMO_BASIS}")`, html.includes(DEMO_BASIS));

  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map((s) => s.src),
  );
  let blobs = '';
  for (const src of scripts) {
    try {
      blobs += `${await (await page.context().request.get(src)).text()}\n`;
    } catch {
      /* a chunk that 404s cannot hold the marker */
    }
  }
  check(`served client bundle carries "${NEW_MARKER}" (new in #785)`, blobs.includes(NEW_MARKER), `${scripts.length} chunks`);
  check(`served client bundle no longer carries "${OLD_MARKER}"`, !blobs.includes(OLD_MARKER));
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
