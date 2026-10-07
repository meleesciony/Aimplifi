/**
 * Deploy proof for DECISIONS #790 (Money you set aside: measured savings against the
 * plan's savings line), run against PRODUCTION. Node type: live probe (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: Guilt-free (/spending-plan) renders a new
 * server-rendered section, `measured-savings` (`#money-set-aside`), and the plan's Savings
 * legend links to it — absent on the last build. And the `/_next/static` files `/sign-in`
 * serves must be the ones the deployment for this commit serves (`DEPLOY_URL`, read from
 * the GitHub deployment record for the sha).
 *
 * WHAT IT ALSO PROVES: the section reads the shared demo's own rows — a lead that measures
 * this month against the plan's line, the average over complete months, the rule note —
 * and the page still fits a 380px phone. It prints the demo's figures for the record (the
 * demo's data is invented).
 *
 * WHAT IT CANNOT PROVE: the tracing rules on a real reader's rows (money from an unlinked
 * bank left out, returns, debt-free goals). Those are proven by the unit locks over
 * invented households (tests/unit/measured-savings.test.ts) and the e2e throwaway user
 * (tests/e2e/measured-savings.spec.ts).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   MODE=read node scripts/measured-savings-live-deploy-check.mjs
 *   DEPLOY_URL=https://<deployment>.vercel.app node scripts/measured-savings-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MODE = process.env.MODE ?? 'check';
const DEPLOY_URL = process.env.DEPLOY_URL;

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
  if (MODE !== 'read' && !DEPLOY_URL) throw new Error('set DEPLOY_URL (or MODE=read)');
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

  await page.goto(`${BASE}/spending-plan`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('plan-legend-savings').first().waitFor({ timeout: 30_000 });
  const section = page.getByTestId('measured-savings');
  const present = (await section.count()) > 0;
  if (MODE === 'read') {
    console.log(`measured-savings section present: ${present}`);
  } else {
    check('/spending-plan: the "Money you set aside" section renders', present);
    const lead = present ? ((await page.getByTestId('measured-lead').textContent()) ?? '').trim() : '';
    check(
      '/spending-plan: the lead measures this month against the plan',
      // The three lead shapes, in #790's final words (critic cycle 5, P2-1: never the cycle-4 P1 sentence).
      /^(So far this month you’ve set aside \$[\d,]+\.\d{2}|Nothing counted as set aside so far this month|So far this month you’ve taken out \$[\d,]+\.\d{2} more than you set aside)/.test(lead) &&
        !/more has come out/.test(lead),
      lead,
    );
    const average = present && (await page.getByTestId('measured-average').count()) > 0 ? ((await page.getByTestId('measured-average').textContent()) ?? '').trim() : '';
    check('/spending-plan: the average over complete months is stated', /complete month/.test(average), average);
    check('/spending-plan: the rule note is there', (await page.getByTestId('measured-rule').count()) === 1);
    // The legend item is the link itself when it has an href (it had none before #790).
    const legendHref = await page.getByTestId('plan-legend-savings').first().getAttribute('href');
    check('/spending-plan: the plan’s Savings legend links to the section', (legendHref ?? '').endsWith('#money-set-aside'), String(legendHref));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('/spending-plan: no horizontal scroll at 380px', overflow <= 0, `${overflow}px`);
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
