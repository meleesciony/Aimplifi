/**
 * Deploy proof for DECISIONS #783 (charges filed as taxes leave the guilt-free
 * plan), run against PRODUCTION. Node type: live probe (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST:
 *
 *  1. A SERVER-RENDERED SENTENCE. /spending-plan's "How we got there" basis
 *     list now states the tax rule (`taxRuleSentence`, tax-copy.ts) on every
 *     history-derived Fixed basis — for every reader, the shared demo included.
 *     The previous build had no such sentence anywhere.
 *  2. A CLIENT-BUNDLE LITERAL. `spend-class-badge.tsx` is a client component
 *     that imports `outOfScopeExplanation`, whose new `taxes` reason text is
 *     compiled into a served chunk on the register.
 *
 * WHAT IT CANNOT PROVE: the demo dataset holds no charge filed as taxes, so the
 * "Not counted here: …" sentence and the money change itself have nothing to
 * render on the demo. Those are proven by the unit locks over invented
 * households and the e2e throwaway user, not by a demo figure that cannot move.
 * The owner's own figure is checked by the owner on their account.
 *
 * Read-only throughout: one-click demo sign-in, reads two pages, writes nothing.
 *
 *   node scripts/tax-out-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const RULE_MARKER = 'never counted here — income tax paid to the government directly is not a monthly cost in this plan';
const BUNDLE_MARKER = 'how to count a tax you pay from your regular income';

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
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('spending-plan-hero').waitFor({ timeout: 30_000 });
  check('/spending-plan renders its hero', true);
  const html = await page.content();
  check('the basis list states the tax rule (server-rendered, new in #783)', html.includes(RULE_MARKER));

  await page.goto(`${BASE}/transactions`, { waitUntil: 'domcontentloaded' });
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
  check(`served client bundle carries "${BUNDLE_MARKER}"`, blobs.includes(BUNDLE_MARKER), `${scripts.length} chunks`);
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
