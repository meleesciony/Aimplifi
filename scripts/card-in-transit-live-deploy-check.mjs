/**
 * Deploy proof for DECISIONS #791 (a card payment counts once it leaves checking,
 * before the card company shows it), run against PRODUCTION. Node type: live probe
 * (GRAPH.md §6).
 *
 * WHAT DISCRIMINATES THIS BUILD FROM THE LAST: the sentence speaks only when a
 * payment is in transit, and the shared demo has none (the cycle-3 critic replayed
 * the demo dataset on 101 days: nothing in transit, every figure unchanged). But
 * /cards is a client component that imports the one sentence author, so the new
 * words ship in a `/_next/static` chunk /cards loads — present on this build,
 * absent on the last. And the `/_next/static` files `/sign-in` serves must be the
 * ones the deployment for this commit serves (`DEPLOY_URL`, read from the GitHub
 * deployment record for the sha).
 *
 * WHAT IT ALSO PROVES — NOTHING ELSE MOVED. The demo's Home cash-needed figure
 * (`DEMO_CASH_NEEDED`, read with MODE=read before the deploy) is unchanged, and
 * neither Home nor /cards names a payment in transit.
 *
 * WHAT IT CANNOT PROVE: the sentence on a real payment. That is proven by the unit
 * locks over invented households and the e2e throwaway users
 * (tests/e2e/card-payment-in-transit.spec.ts).
 *
 * Read-only throughout: one-click demo sign-in, reads pages, writes nothing.
 *
 *   MODE=read node scripts/card-in-transit-live-deploy-check.mjs
 *   DEPLOY_URL=https://<deployment>.vercel.app DEMO_CASH_NEEDED='<figure>' \
 *     node scripts/card-in-transit-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const MODE = process.env.MODE ?? 'check';
const DEPLOY_URL = process.env.DEPLOY_URL;
const DEMO_CASH_NEEDED = process.env.DEMO_CASH_NEEDED;
const SENTENCE = 'Counted as paid before the card company shows it';

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
async function homeFigure(page) {
  const card = page.getByTestId('cash-needed-card');
  await card.waitFor({ timeout: 30_000 });
  const amount = card.getByTestId('cash-needed-amount');
  if ((await amount.count()) > 0) return (await amount.first().textContent())?.trim() ?? '';
  return (await card.getByTestId('cash-needed-headline').first().textContent())?.trim() ?? '';
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

try {
  if (MODE !== 'read' && (!DEPLOY_URL || !DEMO_CASH_NEEDED)) throw new Error('set DEPLOY_URL and DEMO_CASH_NEEDED (or MODE=read)');
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
  const figure = await homeFigure(page);
  if (MODE === 'read') {
    console.log(`DEMO_CASH_NEEDED='${figure}'`);
  } else {
    check(`Home: the demo's cash-needed figure is unchanged (${DEMO_CASH_NEEDED})`, figure === DEMO_CASH_NEEDED, figure);
    check('Home: no payment named in transit (the demo has none)', (await page.getByTestId('cash-needed-in-transit').count()) === 0);

    await page.goto(`${BASE}/cards`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('scenario-summary').waitFor({ timeout: 30_000 });
    check('/cards: no payment named in transit (the demo has none)', (await page.getByTestId('cards-in-transit').count()) === 0);
    const chunks = (await staticFiles(page.context().request, `${BASE}/cards`)).filter((p) => p.endsWith('.js'));
    let carrying = 0;
    for (const path of chunks) {
      const body = await (await page.context().request.get(`${BASE}${path}`)).text();
      if (body.includes(SENTENCE)) carrying++;
    }
    check(`/cards: a client chunk carries the new sentence ("${SENTENCE}")`, carrying > 0, `${carrying} of ${chunks.length} chunks`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('/cards: no horizontal scroll at 380px', overflow <= 0, `${overflow}px`);
  }
} catch (err) {
  check('script completed without error', false, String(err).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nDEPLOY PROOF: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
process.exit(failed === 0 ? 0 : 1);
