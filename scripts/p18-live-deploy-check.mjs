/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the PAW expected-NW lens (DECISIONS #518), run against PRODUCTION.
 *
 * /accounts is auth-gated. Signs into the shared demo and checks the tile:
 * demo has income and no stored age, so the idle sentence is the anti-vacuous marker.
 *
 *   node scripts/p18-live-deploy-check.mjs
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
  await page.getByTestId('paw-lens-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('accounts has paw-lens-card', true);

  const idle = ((await page.getByTestId('paw-lens-idle').textContent()) ?? '').trim();
  check('demo idle names the age × income ÷ 10 formula', /age × yearly income ÷ 10/.test(idle), idle.slice(0, 160));
  check('idle names the FI-card income basis', /same income the FI card uses/.test(idle));
  check('idle says not a grade', /not a grade/.test(idle));
  check('idle does not grade PAW/UAW', !/\b(PAW|UAW|prodigious|under-accumul)\b/i.test(idle));
  check('idle has a slider', (await page.getByTestId('paw-lens-slider').count()) === 1);
  check('idle has no empty sentence', (await page.getByTestId('paw-lens-empty').count()) === 0);
  check('idle has no shame', !/\b(wasted|stop buying|guilty|shame)\b/i.test(idle));
  check('idle has no this-card/below', !/this card|\bbelow\b/i.test(idle));
  check('idle has no tickers', !/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/.test(idle));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
