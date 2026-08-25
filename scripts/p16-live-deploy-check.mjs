/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for Reports Interest & fees YTD (DECISIONS #516), run against PRODUCTION.
 *
 * /reports is auth-gated. Signs into the shared demo and checks the tile:
 * demo seed files no fee/interest spend, so the empty sentence is the
 * anti-vacuous marker (pre-#516 has no `interest-fees-ytd-card` testid).
 *
 *   node scripts/p16-live-deploy-check.mjs
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

  await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('interest-fees-ytd-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('reports has interest-fees-ytd-card', true);

  const title = ((await page.getByTestId('interest-fees-ytd-card').textContent()) ?? '').trim();
  check('title is Interest & fees so far in 2026', /Interest & fees so far in 2026/.test(title), title.slice(0, 80));

  const empty = ((await page.getByTestId('interest-fees-ytd-empty').textContent()) ?? '').trim();
  check('demo empty names no charges filed', /No interest or fee charges are filed so far in 2026/.test(empty), empty.slice(0, 160));
  check('empty names Fees & Charges', /Fees & Charges/.test(empty), empty.slice(0, 80));
  check('empty names Interest & Finance Charges', /Interest & Finance Charges/.test(empty), empty.slice(0, 80));
  check('empty names ATM Fee', /ATM Fee/.test(empty));
  check('empty names Late Fee', /Late Fee/.test(empty));
  check('empty names the scan set as a count, not a composition', /This figure counts/.test(empty));
  check('empty does not say the tile', !/\bthe tile\b/i.test(empty));
  check('empty is not a $0.00 invested claim', !/today's money/.test(empty) && !/\$0\.00/.test(empty), empty.slice(0, 80));
  check('empty has no shame', !/\b(wasted|stop buying|guilty|shame)\b/i.test(empty));
  check('empty has no this-card/below', !/this card|\bbelow\b/i.test(empty));
  check('empty has no tickers', !/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/.test(empty));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
