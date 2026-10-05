/**
 * Deploy proof for DECISIONS #787 (bonuses that land pay this month's savings
 * first, on their own line), run against PRODUCTION. Node type: live probe
 * (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: the change is server-rendered
 * and speaks only when bonus money landed this month — the shared demo has
 * none, and no client chunk imports the new copy (every client import of the
 * trace is type-only). So, as for #786, the discriminator is the BUILD: the
 * `/_next/static` files `/sign-in` serves must be exactly the ones the
 * deployment for this commit serves (`DEPLOY_URL`, read from the GitHub
 * deployment record for the sha).
 *
 * WHAT IT ALSO PROVES — THE FAIL-CLOSED DEFAULT. A household with no bonus
 * money is untouched: the shared demo (on the median, no Bonus rows) must
 * still print the same guilt-free figure on Home, Guilt-free and /budgets
 * (`DEMO_GUILT_FREE`, read before the deploy), three plan lines (no bonus
 * row), and no bonus note.
 *
 * WHAT IT CANNOT PROVE: the bonus line itself has no demo household to render
 * on. It is proven by the unit locks over invented households and the e2e
 * throwaway users (tests/e2e/bonus-pays-savings-first.spec.ts).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   DEPLOY_URL=https://<deployment>.vercel.app DEMO_GUILT_FREE='$1,309.08' \
 *     node scripts/bonus-line-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const DEPLOY_URL = process.env.DEPLOY_URL;
const DEMO_GUILT_FREE = process.env.DEMO_GUILT_FREE;
const BONUS_ROW = 'Bonus this month, toward savings first';

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  if (!DEPLOY_URL || !DEMO_GUILT_FREE) throw new Error('set DEPLOY_URL and DEMO_GUILT_FREE');
  const live = await staticFiles(page.context().request, `${BASE}/sign-in`);
  const built = await staticFiles(page.context().request, `${DEPLOY_URL}/sign-in`);
  check(
    `${BASE} serves this commit's build (its /_next/static files on /sign-in match ${DEPLOY_URL})`,
    live.length > 0 && JSON.stringify(live) === JSON.stringify(built),
    `${live.length} files live, ${built.length} in the deployment`,
  );

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  check('signed into the shared demo', true, BASE);
  const home = (await page.getByTestId('dashboard-safe-to-spend-amount').textContent())?.trim();
  check(`Home: the demo's guilt-free is unchanged (${DEMO_GUILT_FREE})`, home === DEMO_GUILT_FREE, home);
  check('Home: no bonus note without a bonus', (await page.getByTestId('safe-to-spend-bonus-note').count()) === 0);

  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('spending-plan-hero').waitFor({ timeout: 30_000 });
  const hero = (await page.getByTestId('safe-to-spend').textContent())?.trim();
  check(`Guilt-free: the demo's figure is unchanged (${DEMO_GUILT_FREE})`, hero === DEMO_GUILT_FREE, hero);
  const labels = await page.getByTestId('plan-row-label').allTextContents();
  check(
    'Guilt-free: three plan lines and no bonus row without a bonus',
    labels.length === 3 && !labels.some((l) => l.includes(BONUS_ROW)),
    labels.map((l) => l.split(' (')[0]).join(' / '),
  );

  await page.goto(`${BASE}/budgets`, { waitUntil: 'domcontentloaded' });
  const budgets = (await page.getByTestId('budgeting-guilt-free').textContent())?.trim();
  check(`/budgets: the demo's figure is unchanged (${DEMO_GUILT_FREE})`, budgets === DEMO_GUILT_FREE, budgets);
  check('/budgets: no bonus line or note without a bonus', (await page.getByTestId('budgeting-bonus').count()) === 0 && (await page.getByTestId('conscious-bonus-note').count()) === 0);
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
