/**
 * Node type: live-probe (GRAPH.md §6 — proves one shipped claim against production).
 * Deploy proof for Giving YTD on /reports (DECISIONS #520), run against PRODUCTION.
 *
 * /reports is auth-gated. Signs into the shared demo and checks the tile:
 * the card must name the two leaves and refuse a target or opportunity cost.
 *
 *   node scripts/p20-live-deploy-check.mjs
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
  await page.getByTestId('giving-ytd-card').waitFor({ state: 'visible', timeout: 30_000 });
  check('reports has giving-ytd-card', true);

  const card = ((await page.getByTestId('giving-ytd-card').textContent()) ?? '').trim();
  const empty = ((await page.getByTestId('giving-ytd-empty').textContent()) ?? '').trim();
  check('title is the lens name', /Giving so far in 2026/.test(card));
  check('demo is empty (no gifts or charity filed)', empty.length > 0, empty.slice(0, 160));
  check('empty title does not claim already on file', !/already on file/i.test(card));
  check('names Gifts', /Gifts/.test(empty));
  check('names Charity & Donations', /Charity & Donations/.test(empty));
  check('empty does not deny custom giving-group spend', !/No gifts or donations are filed/.test(empty));
  check('has no this-card/below', !/this card|\bbelow\b/i.test(empty));
  check('has no shame', !/\b(wasted|stop buying|guilty|shame)\b/i.test(empty));
  check('has no tithe or target', !/\b(tithe|10%|should give|generously)\b/i.test(empty));
  check('has no opportunity-cost lecture', !/\b(invested|30 years|today's money|compound)\b/i.test(empty));
  check('speaking sentence absent', (await page.getByTestId('giving-ytd-sentence').count()) === 0);
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.ok === false);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
