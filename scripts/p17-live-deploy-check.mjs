/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for mortgage extra-principal (DECISIONS #517), run against PRODUCTION.
 *
 * /accounts is auth-gated. Signs into the shared demo and checks the tile:
 * demo seed has no mortgage, so the empty sentence is the anti-vacuous marker.
 *
 *   node scripts/p17-live-deploy-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE ?? 'https://www.aimplifi.app';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 800 } });

async function signInDemo() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('demo-sign-in').click();
    try {
      await page.waitForURL('**/dashboard', { timeout: 10_000 });
      return;
    } catch {
      // Native/aborted submit — reload and click again once hydrated.
    }
  }
  throw new Error('demo sign-in never reached /dashboard in 3 attempts');
}

try {
  await signInDemo();
  check('signed into the shared demo on production', true, BASE);

  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('mortgage-early-payoff-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('accounts has mortgage-early-payoff-card', true);

  const empty = ((await page.getByTestId('mortgage-early-payoff-empty').textContent()) ?? '').trim();
  check('demo empty names no mortgage on file', /No mortgage with a rate and a minimum payment is on file/.test(empty), empty.slice(0, 160));
  check('empty names the debt planner', /debt planner/.test(empty));
  check('empty says a missing rate is not 0%', /not treated as 0%/.test(empty));
  check('empty does not say the tile', !/\bthe tile\b/i.test(empty));
  check('empty has no slider', (await page.getByTestId('mortgage-early-payoff-slider').count()) === 0);
  check('empty has no shame', !/\b(wasted|stop buying|guilty|shame)\b/i.test(empty));
  check('empty has no this-card/below', !/this card|\bbelow\b/i.test(empty));
  check('empty has no tickers', !/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/.test(empty));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
