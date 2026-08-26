/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for the idle-cash note (DECISIONS #519), run against PRODUCTION.
 *
 * /dashboard is auth-gated. Signs into the shared demo and checks the tile:
 * the card must name the 6-month cushion and refuse a nudge.
 *
 *   node scripts/p19-live-deploy-check.mjs
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

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('idle-cash-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('dashboard has idle-cash-card', true);

  const idle = ((await page.getByTestId('idle-cash-idle').textContent()) ?? '').trim();
  check('title is a lens, not a surplus claim', /Cash vs a 6-month cushion/.test(
    (await page.getByTestId('idle-cash-card').textContent()) ?? '',
  ));
  check('demo is idle (under the far gate)', idle.length > 0, idle.slice(0, 160));
  check('names the runway expense basis', /same expense average the runway figure uses/.test(idle));
  check('says never moves money', /never moves money/.test(idle));
  check('says not a recommendation', /not a recommendation/i.test(idle));
  check('has no this-card/below/here', !/this card|\bbelow\b|\bhere\b/i.test(idle));
  check('has no shame', !/\b(wasted|stop buying|guilty|shame)\b/i.test(idle));
  check('has no tickers or HYSA lecture', !/\b(VTSAX|VTI|VOO|SPY|AAPL|high-yield|HYSA|pays little)\b/i.test(idle));
  check('empty and speaking sentences absent', (await page.getByTestId('idle-cash-empty').count()) === 0
    && (await page.getByTestId('idle-cash-sentence').count()) === 0);
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
