/**
 * Deploy proof for DECISIONS #789 (Investment & Savings is never spending), run against
 * PRODUCTION. Node type: live probe (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: the shared demo holds no row filed
 * Investment & Savings, so no demo figure moves. But the merchant lens's scope note is
 * printed for any merchant filter, and #789 changed its words ("…nothing pending, and no
 * transfer or money moved into investing."). And the `/_next/static` files `/sign-in`
 * serves must be the ones the deployment for this commit serves (`DEPLOY_URL`, read from
 * the GitHub deployment record for the sha).
 *
 * WHAT IT ALSO PROVES — NOTHING ELSE MOVED. The demo's guilt-free and cash-needed figures
 * on Home (`DEMO_GUILT_FREE`, `DEMO_CASH_NEEDED`, read with MODE=read before the deploy)
 * are unchanged.
 *
 * WHAT IT CANNOT PROVE: the rule on a real Investment & Savings row. That is proven by the
 * unit locks and the e2e throwaway user (tests/e2e/investment-not-spending.spec.ts).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   MODE=read node scripts/investment-not-spending-live-deploy-check.mjs
 *   DEPLOY_URL=https://<deployment>.vercel.app DEMO_GUILT_FREE='$…' DEMO_CASH_NEEDED='$…' \
 *     node scripts/investment-not-spending-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MODE = process.env.MODE ?? 'check';
const DEPLOY_URL = process.env.DEPLOY_URL;
const DEMO_GUILT_FREE = process.env.DEMO_GUILT_FREE;
const DEMO_CASH_NEEDED = process.env.DEMO_CASH_NEEDED;
const MERCHANT = 'Blue Bottle Coffee';
const NEW_SCOPE_WORDS = 'and no transfer or money moved into investing';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** The sorted `/_next/static` script and stylesheet paths a page serves. */
async function staticFiles(request, url) {
  const html = await (await request.get(url)).text();
  return [...new Set([...html.matchAll(/\/_next\/static\/[^"'\s)]+/g)].map((m) => m[0]))].sort();
}

/** Home's cash-needed figure: the amount when one is due, else the headline. */
async function cashNeeded(page) {
  const card = page.getByTestId('cash-needed-card');
  await card.waitFor({ timeout: 30_000 });
  const amount = card.getByTestId('cash-needed-amount');
  if ((await amount.count()) > 0) return (await amount.first().textContent())?.trim() ?? '';
  return (await card.getByTestId('cash-needed-headline').first().textContent())?.trim() ?? '';
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  if (MODE !== 'read' && (!DEPLOY_URL || !DEMO_GUILT_FREE || !DEMO_CASH_NEEDED)) {
    throw new Error('set DEPLOY_URL, DEMO_GUILT_FREE and DEMO_CASH_NEEDED (or MODE=read)');
  }
  if (MODE !== 'read') {
    const live = await staticFiles(page.context().request, `${BASE}/sign-in`);
    const built = await staticFiles(page.context().request, `${DEPLOY_URL}/sign-in`);
    check(
      `${BASE} serves this commit's build (its /_next/static files on /sign-in match ${DEPLOY_URL})`,
      live.length > 0 && JSON.stringify(live) === JSON.stringify(built),
      `${live.length} files live, ${built.length} in the deployment`,
    );
  }

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo', true, BASE);
  const guiltFree = (await page.getByTestId('dashboard-safe-to-spend-amount').textContent())?.trim() ?? '';
  const needed = await cashNeeded(page);

  await page.goto(`${BASE}/transactions?merchant=${encodeURIComponent(MERCHANT)}`, { waitUntil: 'domcontentloaded' });
  const scope = page.getByTestId('merchant-lens-scope');
  await scope.waitFor({ timeout: 30_000 });
  const scopeText = (await scope.textContent())?.trim() ?? '';

  if (MODE === 'read') {
    console.log(`DEMO_GUILT_FREE='${guiltFree}'`);
    console.log(`DEMO_CASH_NEEDED='${needed}'`);
    console.log(`lens scope note now: ${scopeText}`);
  } else {
    check(`Home: the demo's guilt-free is unchanged (${DEMO_GUILT_FREE})`, guiltFree === DEMO_GUILT_FREE, guiltFree);
    check(`Home: the demo's cash-needed figure is unchanged (${DEMO_CASH_NEEDED})`, needed === DEMO_CASH_NEEDED, needed);
    check(`/transactions?merchant=${MERCHANT}: the lens names what it leaves out ("${NEW_SCOPE_WORDS}")`, scopeText.includes(NEW_SCOPE_WORDS), scopeText.slice(0, 120));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('/transactions: no horizontal scroll at 380px', overflow <= 0, `${overflow}px`);
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
